import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes, Sequelize } from 'sequelize';

export type SearchEntityFilter =
  | 'all'
  | 'people'
  | 'instructors'
  | 'groups'
  | 'sessions'
  | 'tags';

export interface SearchQueryRow {
  entity_type: 'user' | 'instructor' | 'group' | 'session' | 'tag';
  entity_id: string;
  title: string;
  subtitle: string | null;
  avatar_url: string | null;
  score: number;
  // Enrichment for access-aware FE routing (joined at query time on the
  // small result set; the ranking still runs on search_doc alone).
  // Optional on the raw row so test fixtures can omit them; the mapping
  // coalesces to null/false.
  handle?: string | null; // user/instructor handle, or a session's instructor handle
  slug?: string | null; // session template slug (for the public-by-slug lookup)
  viewer_is_member?: boolean; // group rows: is the viewer an active member?
}

export interface SearchResultItem {
  type: 'user' | 'instructor' | 'group' | 'session' | 'tag';
  id: string;
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  score: number;
  /** `/@handle` target for user/instructor; instructor handle for sessions. */
  handle?: string | null;
  /** Session template slug — with `handle`, resolves the public showcase. */
  slug?: string | null;
  /** Group rows only: the viewer is an active member → route them inside. */
  viewerIsMember?: boolean;
}

export interface SearchCategoryResult {
  items: SearchResultItem[];
  total: number;
  nextCursor: string | null;
}

export interface SearchResponse {
  query: string;
  tookMs: number;
  byCategory: {
    instructors: SearchCategoryResult;
    groups: SearchCategoryResult;
    sessions: SearchCategoryResult;
    tags: SearchCategoryResult;
    users: SearchCategoryResult;
  };
}

/**
 * Read-side of global search. Hits `search_doc` directly; never touches
 * source-entity tables. Visibility filtering is enforced in the WHERE
 * clause (not post-filter) so the planner uses the indexes.
 *
 * Ranking strategy (from research recommendations doc):
 *   ts_rank_cd(search_vector, to_tsquery)         — base relevance
 *   * entity_boost                                — type-level priority
 *   + similarity(search_text, query) * 0.4        — fuzzy fallback bonus
 *   - epsilon * date diff                         — tiebreaker (only if needed)
 *
 * Personalization (city match, followed-instructor boost) is left to
 * day-30 — see recommendations doc §3.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  /**
   * Per-entity boost — instructor is the most "valuable" hit on a
   * typeahead search since it's the rarest and most actionable result;
   * users are de-prioritized to avoid drowning out coaches.
   */
  private readonly _entityBoost: Record<string, number> = {
    instructor: 1.5,
    tag: 1.3,
    group: 1.0,
    session: 0.9,
    user: 0.7,
  };

  constructor(@InjectConnection() private readonly _sequelize: Sequelize) {}

  async search(opts: {
    query: string;
    type: SearchEntityFilter;
    limit: number;
    viewerId: string | null;
  }): Promise<SearchResponse> {
    const t0 = Date.now();
    const q = opts.query.trim();

    // Empty / 1-char queries return an empty shape — the FE already
    // gates this but we double-guard so the BE never runs an unbounded
    // wildcard scan.
    if (q.length < 2) {
      return this._emptyResponse(q, Date.now() - t0);
    }

    const wantedTypes = this._typesFor(opts.type);
    const limit = Math.max(1, Math.min(20, opts.limit ?? 5));

    // Prefix tsquery for typeahead: 'mot' -> 'mot:*' matches 'motionhive'.
    // If the query is nothing but punctuation, there's nothing to match.
    const tsQuery = this._buildPrefixTsQuery(q);
    if (!tsQuery) {
      return this._emptyResponse(q, Date.now() - t0);
    }

    const rows = await this._runQuery(
      q,
      tsQuery,
      wantedTypes,
      opts.viewerId,
      limit,
    );

    return {
      query: q,
      tookMs: Date.now() - t0,
      byCategory: this._bucketize(rows, limit),
    };
  }

  // ─────────────────────────────────────────────────────────────────

  /**
   * Build a prefix tsquery for typeahead. Each whitespace-separated term
   * is stripped of tsquery operators, suffixed with `:*` (lexeme prefix
   * match), and AND-ed together:
   *
   *   'mot'        -> 'mot:*'             (matches 'motionhive')
   *   'tes'        -> 'tes:*'             (matches 'test')
   *   'yoga coach' -> 'yoga:* & coach:*'
   *
   * This is the fix for incremental typing: `websearch_to_tsquery` only
   * matched whole lexemes, so a partial word returned nothing until the
   * word was complete. Returns '' when the query has no usable terms
   * (e.g. all punctuation) — the caller short-circuits to empty.
   */
  private _buildPrefixTsQuery(q: string): string {
    return (
      q
        .split(/\s+/)
        // Allowlist: keep only Unicode letters/digits per term (drops
        // tsquery operators &|!():*'" AND any other punctuation so
        // `to_tsquery` can never choke or have an operator smuggled in).
        // Accent-aware via \p{L} so 'București' survives.
        .map((term) => term.replace(/[^\p{L}\p{N}]+/gu, ''))
        .filter((term) => term.length > 0)
        .map((term) => `${term}:*`)
        .join(' & ')
    );
  }

  private async _runQuery(
    q: string,
    tsQuery: string,
    types: string[],
    viewerId: string | null,
    perCategoryLimit: number,
  ): Promise<SearchQueryRow[]> {
    // Two SQL fragments OR'd:
    //   1. tsvector @@ to_tsquery('<term>:*') — prefix/full-text match
    //      (carries typeahead; partial words match by lexeme prefix)
    //   2. similarity(search_text, q) > 0.3 — fuzzy fallback for typos
    //      ('yga' -> 'yoga'); threshold kept tight to cut weak noise
    // and a single composite score that combines both signals.
    // Both sides are folded (`fold_for_search`, unaccent + lower): the
    // index stores folded text (migration 077), and the term is folded
    // here, so "bucuresti" finds "București" and "Brașov" finds "Brasov".

    // Sequelize's `:name` replacement does NOT auto-expand arrays into
    // an IN-list (it stringifies as 'a, b'). So we build per-value
    // placeholders for `entity_type IN (...)` ourselves.
    const typeReplacements: Record<string, string> = {};
    const typePlaceholders = types
      .map((t, i) => {
        const key = `t${i}`;
        typeReplacements[key] = t;
        return `:${key}`;
      })
      .join(', ');

    const sql = `
      WITH ranked AS (
        SELECT
          entity_type,
          entity_id,
          title,
          subtitle,
          avatar_url,
          (
            COALESCE(ts_rank_cd(search_vector, to_tsquery('simple', fold_for_search(:tsQuery))), 0) * 1.0
            + similarity(search_text, fold_for_search(:q)) * 0.4
          ) * (
            CASE entity_type
              WHEN 'instructor' THEN 1.5
              WHEN 'tag'        THEN 1.3
              WHEN 'group'      THEN 1.0
              WHEN 'session'    THEN 0.9
              WHEN 'user'       THEN 0.7
              ELSE 1.0
            END
          ) AS score,
          ROW_NUMBER() OVER (
            PARTITION BY entity_type
            ORDER BY (
              COALESCE(ts_rank_cd(search_vector, to_tsquery('simple', fold_for_search(:tsQuery))), 0)
              + similarity(search_text, fold_for_search(:q)) * 0.4
            ) DESC
          ) AS rn
        FROM search_doc
        WHERE entity_type IN (${typePlaceholders})
          AND (
            search_vector @@ to_tsquery('simple', fold_for_search(:tsQuery))
            OR similarity(search_text, fold_for_search(:q)) > 0.3
          )
          AND (
            is_public = TRUE
            OR (:viewerId::text IS NOT NULL AND owner_id = :viewerId)
          )
          -- Don't surface sessions that aren't bookable anymore: a session
          -- (template) only shows if it still has an upcoming SCHEDULED
          -- instance. Filtered live so a series that just ran out drops out
          -- without waiting for a reindex. (Matches findNextUpcoming.)
          AND (
            entity_type <> 'session'
            OR EXISTS (
              SELECT 1 FROM session_instance si
              WHERE si.template_id = search_doc.entity_id
                AND si.status = 'SCHEDULED'
                AND si.start_at >= NOW()
            )
          )
          -- Don't surface groups that aren't viewable anymore: re-check the
          -- LIVE group (search_doc.is_public can be stale). It must exist,
          -- be active and not deleted, and be public OR one the viewer is a
          -- member of — matching what the preview / detail can actually open.
          AND (
            entity_type <> 'group'
            OR EXISTS (
              SELECT 1 FROM "group" g
              WHERE g.id = search_doc.entity_id
                AND g.deleted_at IS NULL
                AND g.is_active = TRUE
                AND (
                  g.is_public = TRUE
                  OR EXISTS (
                    SELECT 1 FROM group_member gm
                    WHERE gm.group_id = g.id
                      AND gm.user_id = :viewerId
                      AND gm.left_at IS NULL
                  )
                )
            )
          )
      )
      SELECT
        r.entity_type, r.entity_id, r.title, r.subtitle, r.avatar_url, r.score,
        -- handle: instructor/user own handle, or a session's instructor handle
        CASE WHEN r.entity_type = 'session' THEN su.handle ELSE u.handle END AS handle,
        st.slug AS slug,
        -- group rows: is the viewer an active member (route them inside)?
        CASE WHEN r.entity_type = 'group' THEN EXISTS (
          SELECT 1 FROM group_member gm
          WHERE gm.group_id = r.entity_id
            AND gm.user_id = :viewerId
            AND gm.left_at IS NULL
        ) ELSE FALSE END AS viewer_is_member
      FROM ranked r
      LEFT JOIN "user" u
        ON u.id = r.entity_id AND r.entity_type IN ('user', 'instructor')
      LEFT JOIN session_template st
        ON st.id = r.entity_id AND r.entity_type = 'session'
      LEFT JOIN "user" su ON su.id = st.instructor_id
      WHERE r.rn <= :perCategoryLimit
      ORDER BY r.score DESC
    `;

    const rows = await this._sequelize.query<SearchQueryRow>(sql, {
      replacements: {
        q,
        tsQuery,
        viewerId,
        perCategoryLimit,
        ...typeReplacements,
      },
      type: QueryTypes.SELECT,
    });

    return rows;
  }

  private _typesFor(filter: SearchEntityFilter): string[] {
    switch (filter) {
      case 'instructors':
        return ['instructor'];
      case 'groups':
        return ['group'];
      case 'sessions':
        return ['session'];
      case 'tags':
        return ['tag'];
      case 'people':
        return ['user'];
      case 'all':
      default:
        return ['instructor', 'group', 'session', 'tag', 'user'];
    }
  }

  private _bucketize(
    rows: SearchQueryRow[],
    limit: number,
  ): SearchResponse['byCategory'] {
    const empty = (): SearchCategoryResult => ({
      items: [],
      total: 0,
      nextCursor: null,
    });
    const result = {
      instructors: empty(),
      groups: empty(),
      sessions: empty(),
      tags: empty(),
      users: empty(),
    };

    const byType: Record<string, SearchQueryRow[]> = {
      instructor: [],
      group: [],
      session: [],
      tag: [],
      user: [],
    };
    for (const row of rows) {
      byType[row.entity_type]?.push(row);
    }

    const fill = (
      bucket: keyof SearchResponse['byCategory'],
      rows: SearchQueryRow[],
    ) => {
      const items = rows.slice(0, limit).map<SearchResultItem>((r) => ({
        type: r.entity_type,
        id: r.entity_id,
        title: r.title,
        subtitle: r.subtitle,
        avatarUrl: r.avatar_url,
        score: Number(r.score) || 0,
        handle: r.handle ?? null,
        slug: r.slug ?? null,
        viewerIsMember: r.viewer_is_member ?? false,
      }));
      result[bucket] = {
        items,
        total: rows.length,
        nextCursor: null,
      };
    };

    fill('instructors', byType.instructor);
    fill('groups', byType.group);
    fill('sessions', byType.session);
    fill('tags', byType.tag);
    fill('users', byType.user);

    return result;
  }

  private _emptyResponse(q: string, tookMs: number): SearchResponse {
    const empty = (): SearchCategoryResult => ({
      items: [],
      total: 0,
      nextCursor: null,
    });
    return {
      query: q,
      tookMs,
      byCategory: {
        instructors: empty(),
        groups: empty(),
        sessions: empty(),
        tags: empty(),
        users: empty(),
      },
    };
  }
}
