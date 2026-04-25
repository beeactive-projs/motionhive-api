# MotionHive Global Search — Recommendations

## Executive summary

**Build it on Postgres. Don't add a search service.** At <10k users, with a single Neon Postgres and Railway-hosted NestJS, a properly-built `tsvector` + `pg_trgm` solution will be faster, cheaper, and operationally simpler than Meilisearch/Typesense/Algolia for the next 18–24 months. The right shape is a single denormalized `search_doc` table (one row per indexable entity) with a generated `tsvector` column for full-text ranking, a `text` column for trigram fuzzy match, per-entity weight multipliers applied at query time, and refresh via application-level write hooks. One endpoint — `GET /search?q=...&type=...` — returns category-grouped results with a per-row score.

The reason not to reach for Meilisearch/Algolia is not capability; it is the operational tax (second datastore, dual-writes, drift reconciliation, secrets, deploys) for a problem you do not yet have. Postgres FTS comfortably scales to several million rows on a single Neon instance with sub-100ms p95 for these query shapes. When you cross ~250k searchable rows or need multi-language stemming beyond `simple`/`english`/`romanian`, migrate. Until then, two migrations and one service get you a credible Facebook/LinkedIn-style global search.

---

## 1. Search backend technology

**Ranked:**

1. **Postgres `tsvector` + `pg_trgm` combined (DO THIS).** ~1 day setup, $0 incremental, <50ms p95 with proper GIN indexes. Typo tolerance via trigram similarity. Ranking via `ts_rank_cd` + `setweight`. Heterogeneous entities handled by a denormalized `search_doc` table.
2. **Meilisearch self-hosted on Railway.** ~3 days (deploy, dual-write, reindex). ~$5–10/mo + memory pressure. <20ms latency, excellent typo tolerance, very good ranking defaults. Reasonable second choice; not necessary today.
3. **Typesense self-hosted.** Same shape, slightly less mature ecosystem in 2026. Pick Meilisearch over this.

**Reject:** Algolia (free tier runs out on searches not records; paid tier becomes the most expensive line item, plus vendor lock-in on ranking). ElasticSearch/OpenSearch (managed minimum ~$70/mo, 5% utilization for years). Postgres FTS without trigram ("yga" returns nothing — don't ship without `pg_trgm`).

## 2. Indexing strategy

**Recommendation:** one denormalized `search_doc` table, refreshed via application-level write hooks.

```
search_doc(
  id uuid pk,
  entity_type text,        -- 'user' | 'instructor' | 'group' | 'session' | 'tag'
  entity_id uuid,
  title text,              -- primary display field, weight A
  subtitle text,           -- secondary, weight B
  body text,               -- description/bio, weight C
  tags text[],             -- weight B
  city text,               -- weight C
  is_public boolean,
  owner_id uuid,           -- for visibility filtering
  search_vector tsvector,  -- GENERATED, indexed with GIN
  search_text text,        -- concatenated lowercase, indexed with GIN(gin_trgm_ops)
  updated_at timestamptz,
  unique(entity_type, entity_id)
)
```

**Why denormalized over per-entity indexes joined at query time:** a single `search_doc` sorts and paginates across all categories with one index scan. Joining four indexes means four sub-queries, four rank-normalization steps, and a UNION ALL the planner cannot pre-sort. Dual-write cost is the price of a unified relevance score.

**Refresh, ranked:**

1. **Application-level hooks in services (DO THIS).** Each create/update/soft-delete in `UserService`, `InstructorProfileService`, `GroupService`, `SessionService` calls `SearchIndexService.upsert(entityType, entityId)` in the same transaction. Predictable, debuggable, no schema-level magic.
2. **Postgres triggers.** Cannot drift, but hide behavior, painful to test, and JSON-column flattening (specializations[], tags[]) is ugly in PL/pgSQL. Skip.
3. **Scheduled full reindex.** Required as a *backstop* (nightly, once the jobs module exists), not the primary mechanism. Catches drift from raw SQL/migrations.

**`tsvector` auto-update:** `GENERATED ALWAYS AS (...) STORED` column — no trigger needed. The `pg_trgm` index goes on the lowercased concatenated `search_text` column.

## 3. Ranking across heterogeneous entities

**Recommendation:** field-level `setweight` inside `tsvector`, multiplied by a per-entity-type boost at query time.

```sql
-- in the generated tsvector:
setweight(to_tsvector('simple', coalesce(title, '')), 'A')
|| setweight(to_tsvector('simple', array_to_string(tags, ' ')), 'B')
|| setweight(to_tsvector('simple', coalesce(body, '')), 'C')

-- at query time:
SELECT *,
  ts_rank_cd(search_vector, q) * entity_boost AS score
FROM search_doc, plainto_tsquery('simple', $1) q
WHERE search_vector @@ q OR similarity(search_text, $1) > 0.3
ORDER BY score DESC
```

`entity_boost` is a `CASE`: instructor 1.5, tag 1.3, group 1.0, session 0.9, user 0.7. Store in a `search_weight` table to tune without redeploy.

**Personalization (day 30+):** `+0.5` when `owner_id` is in the viewer's followed set, `+0.3` when `city = currentUser.city`. `LEFT JOIN instructor_client` and pass current city as a parameter. Don't put personalization in the tsvector — it is per-viewer, not per-document.

**Algolia/Meilisearch model:** ordered "ranking rules" (typo count, word proximity, attribute weight, custom ranking like memberCount). Postgres equivalent is multi-term `ORDER BY` with `ts_rank_cd` first, `member_count DESC` as tiebreaker. You will not match Meili's typo quality in v1; fine for v1.

## 4. Query latency & UX

- **p95 target: <200ms server, <300ms perceived.** With the index above and Neon's connection pooling, you'll be at 30–80ms server-side for queries < 4 chars and <150ms for full queries. Do not ship if p95 > 250ms; that's a sign your GIN index is not being used.
- **Debounce: 250ms.** 150ms fires too often on slow typists, 300ms feels laggy on fast ones. 250ms is the sweet spot industry-wide (Slack, GitHub).
- **Show partial results as the user types** — fire on every debounce tick, cancel in-flight requests with `AbortController`. The first useful query is at 2 characters; below that, show "Recents" + "Trending" only.
- **FE cache: yes, LRU of last 10 query → result pairs in memory** (an Angular signal-backed Map is fine). Invalidate on modal close. Do not persist to localStorage — stale results feel broken.
- **Minimum query length: 2 characters.** Below that the result set is too noisy to rank.

## 5. Recents — store where?

**Recommendation: localStorage only, for now.** Cap at 10 entries, FIFO. Zero backend cost, zero schema, ships in a day.

**Ranked:**
1. **localStorage** — DO THIS. Recents are device-local 95% of the time anyway; a user searching from their phone vs laptop genuinely wants different recents.
2. **Both (write-through)** — the right answer at 100k users when product wants cross-device sync. Add `recent_search(user_id, query, last_searched_at, count)` table with a 50-row cap per user, dedupe on lowercase query, write async (fire-and-forget from the controller).
3. **`recent_search` table only** — never. Forces a network round-trip to render the empty modal state, which is the worst possible perceived-performance hit.

## 6. Trending searches

**Recommendation: hardcoded curated list in v1, real trending in v2 (day 30+) via a counter table refreshed by cron (requires the jobs module — see `project_jobs_module_pending.md`).**

Real trending is fiddly: decay (today > last week), synonym dedup ("yoga"/"YOGA"/"yog"), abuse filtering. Not a v1 problem at <10k users. V2: `search_query_log(query_normalized, searched_at, user_id)` written async on every search. Nightly job computes top 20 over the last 7 days with exponential decay, materialized to `trending_search`.

## 7. Security & abuse

- **Rate limit: 30 req/min per IP, 60 req/min per authenticated user.** Apply via existing `@Throttle()` decorator. The default global 100/60s is too generous for a typeahead.
- **Logged-out users:** allow search of public entities only (instructors with `isPublic = true`, groups with `isPublic = true`, public sessions, tags). This matters for SEO and growth — do not gate it behind auth.
- **Permissions filtering at query time** — embed the rules in the WHERE clause of the search query, not in post-filter:
  - `instructor`: only rows where `is_public = true` OR `owner_id = currentUserId`
  - `group`: only rows where `is_public = true` OR viewer is a member (subquery against `group_member`) OR viewer is the owner
  - `session`: only rows where `visibility = 'PUBLIC'` OR (visibility = 'GROUP' AND member of group) OR (visibility = 'CLIENTS' AND viewer is a client) OR owner. **Drafts (`status = 'DRAFT'`) never appear in search.** Index this via a partial index: `WHERE status != 'DRAFT' AND deleted_at IS NULL`.
  - `user`: never search by email (PII leak). Search firstName + lastName + city only. Surface only verified, non-locked accounts.
- **Scraping:** rate limit + don't return more than 10 results per category per request. Pagination is the natural friction.

## 8. What I'd build day 1 vs day 30 vs day 90

**Day 1 (MVP, ~3 days work):**
- Migration 029: create `search_doc` table with generated `tsvector`, GIN index on vector, GIN index on `search_text` with `gin_trgm_ops`.
- `SearchIndexService` with `upsert(entityType, id)` / `delete(entityType, id)`.
- Wire into existing `UserService`, `InstructorProfileService`, `GroupService` write paths.
- One-off backfill script.
- `SearchService.search(q, type, viewer)` returning `{ items, byCategory }`.
- `SearchController` with `GET /search`, `@Public()`, throttled at 30/min.
- FE modal: debounce 250ms, category tabs, localStorage recents, hardcoded trending list.

**Day 30 (real feature):**
- Personalization boosts: city match, followed instructors, member-of group.
- "Did you mean" suggestion using `pg_trgm` similarity when zero results.
- Saved searches per user (small table).
- `search_query_log` table (write-only) — feeds analytics and future trending.
- Tag autocomplete: dedicated endpoint `GET /search/tags?q=` reading from a materialized `tag` view derived from instructor.specializations + group.tags.
- A11y/keyboard nav in the modal.

**Day 90 (scale-aware, when you cross ~50k users / ~250k search_doc rows):**
- Real trending via nightly job (requires jobs module — build it first per existing tech debt).
- Move query logs to a separate Neon database or to S3 cold storage.
- Add Romanian-language `tsvector` config alongside `simple` for stemming.
- Re-evaluate Meilisearch only if p95 > 200ms persists or product wants advanced typo tolerance. The migration is straightforward because `search_doc` is already a denormalized index — Meili just becomes a different consumer of the same upsert.

## 9. Concrete API shape

**Single endpoint, category-grouped response:**

```
GET /search?q=yoga&type=all&limit=10&cursor=
GET /search?q=yoga&type=instructors&limit=20&cursor=eyJzY29yZSI6MC44LCJpZCI6Ii4uLiJ9
```

**Why one endpoint, not `/search/instructors` + `/search/all`:** the modal almost always wants all categories on first render. A single endpoint is one network round-trip and one cache key. When the user clicks a tab, the FE re-issues with `type=instructors`. No aggregator needed.

**Response shape:**

```json
{
  "query": "yoga",
  "tookMs": 38,
  "byCategory": {
    "instructors": {
      "items": [
        {
          "type": "instructor",
          "id": "uuid",
          "title": "Mia Popescu",
          "subtitle": "Yoga · Bucharest · 8 yrs",
          "avatarUrl": "https://...",
          "score": 0.92,
          "matchedFields": ["specializations", "displayName"]
        }
      ],
      "total": 14,
      "nextCursor": "eyJzY29yZSI6MC44LCJpZCI6Ii4uLiJ9"
    },
    "groups": { "items": [...], "total": 3, "nextCursor": null },
    "sessions": { "items": [...], "total": 7, "nextCursor": null },
    "tags": { "items": [...], "total": 2, "nextCursor": null },
    "users": { "items": [...], "total": 5, "nextCursor": null }
  }
}
```

**Pagination per category:** opaque cursor (base64 of `{score, id}`). Cursor pagination, not page/offset, because relevance order is not stable across writes — offsets drift. This *breaks* the PrimeNG-compatible `{ items, total, page, pageSize }` shape used elsewhere in the API; that is fine. Search is not a tabular list, and the contract callout in `CLAUDE.md` is about list endpoints. Document the divergence in Swagger.

**Score + matchedFields in response:** yes. Score is useful for FE A/B'ing of result presentation. `matchedFields` lets the UI bold/highlight the matched substring without the FE re-running the match itself.

## 10. References / inspiration

- **Postgres FTS, the canonical write-up** — Rachid Belaid, *"Postgres full-text search is good enough!"* (`rachbelaid.com/postgres-full-text-search-is-good-enough`). Production-grade, covers `setweight`, ranking, `pg_trgm` combination. Old (2015) but the patterns have not changed.
- **GitLab's switch to Postgres FTS** — GitLab engineering blog, *"Troubleshooting GitLab.com's Search"*. They run Postgres FTS at hundreds of millions of documents. If they can, you certainly can at 10k–100k. (`about.gitlab.com/blog`, search "advanced search PostgreSQL".)
- **Supabase's pattern for combined FTS + trigram** — `supabase.com/docs/guides/database/full-text-search`. Closest direct analogue to your stack: Postgres + a Node API + a reactive frontend.
- **NestJS-specific:** there is no dominant "NestJS search library" worth adopting. The official `@nestjs/elasticsearch` exists but pulls in the ES client (huge). For Postgres, you write the SQL via Sequelize's `sequelize.literal()` or, cleaner, raw queries through `sequelize.query()` — there is no abstraction worth introducing. For Meili, `meilisearch` npm package is enough; ignore the community NestJS wrappers (thin and stale).
- **Bonus — Meilisearch's "Tips for ranking"** (`docs.meilisearch.com/learn/core_concepts/relevancy`). Worth reading even if you stay on Postgres, because it codifies the heuristics you'll re-derive yourself when tuning weights.

---

## What to do this week

1. **Write migration 029** creating `search_doc` with the schema in §2, generated `tsvector` column, GIN index on vector, GIN index on `search_text` with `gin_trgm_ops`. Enable `pg_trgm` extension in the same migration.
2. **Build `SearchIndexService`** in a new `src/modules/search/` module: `upsert(entityType, id)`, `delete(entityType, id)`, `reindexAll()` (one-off, idempotent). Service-only at this stage — no controller yet.
3. **Wire write hooks** into `UserService.update`, `InstructorProfileService.update`, `GroupService.create/update/delete`, `SessionService.create/update/delete`. Same transaction as the entity write. Add tests that assert the upsert fires.
4. **Run a backfill** via `reindexAll()` on a staging DB; eyeball the result counts per `entity_type` against the source tables. Then run on prod.
5. **Build `SearchController` + FE modal**: single `GET /search?q=&type=&limit=` endpoint with `@Public()` and `@Throttle({ default: { limit: 30, ttl: 60_000 } })`; Angular modal with 250ms debounce, category tabs, localStorage recents, three hardcoded trending pills. Ship behind a feature flag, dogfood for a week, then turn on.

Do not, under any circumstances, start by spinning up Meilisearch. The trap is that it feels like progress; it is actually a second system to operate before you have proven the first one is insufficient.
