import { Test } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';

import { SearchService, SearchQueryRow } from './search.service';

/**
 * Smoke tests for SearchService — the read-side of global search.
 *
 * We don't run real SQL here; we assert that the service:
 *   - Boots.
 *   - Short-circuits empty / 1-char queries (no DB hit, empty shape).
 *   - Hits `search_doc` via `websearch_to_tsquery` + `similarity()` —
 *     NOT raw `LIKE`/`iLike` (this is the trigram contract from
 *     migration 029; LIKE would skip the GIN indexes).
 *   - Honours the per-entity `type` filter by passing only that entity
 *     into the IN (...) list.
 *   - Returns the FE contract `byCategory` shape with `items`,
 *     `total`, `nextCursor`.
 *   - Bucketizes raw rows back to per-category lists keyed by
 *     entity_type (and surfaces score as a number).
 */
describe('SearchService (smoke — not exhaustive)', () => {
  let service: SearchService;

  // We only need .query() on the connection — the service builds raw
  // SQL and calls it directly.
  const sequelize = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [SearchService, { provide: Sequelize, useValue: sequelize }],
    }).compile();
    service = module.get(SearchService);
  });

  // ─── boots ────────────────────────────────────────────────────────

  it('constructs', () => {
    expect(service).toBeDefined();
  });

  // ─── empty / short queries don't touch the DB ─────────────────────

  describe('short-circuit on empty / 1-char query', () => {
    it('returns the empty response shape for a blank query and never queries', async () => {
      const out = await service.search({
        query: '',
        type: 'all',
        limit: 5,
        viewerId: null,
      });

      expect(sequelize.query).not.toHaveBeenCalled();
      expect(out.query).toBe('');
      expect(out.byCategory.instructors.items).toEqual([]);
      expect(out.byCategory.groups.items).toEqual([]);
      expect(out.byCategory.sessions.items).toEqual([]);
      expect(out.byCategory.tags.items).toEqual([]);
      expect(out.byCategory.users.items).toEqual([]);
      // Every category has the FE-contract `nextCursor: null`.
      expect(out.byCategory.users.nextCursor).toBeNull();
    });

    it('treats a 1-char query (after trim) the same as empty', async () => {
      const out = await service.search({
        query: '  a  ',
        type: 'all',
        limit: 5,
        viewerId: 'me',
      });
      expect(sequelize.query).not.toHaveBeenCalled();
      // Trimmed query is echoed back.
      expect(out.query).toBe('a');
    });
  });

  // ─── builds tsquery + trigram SQL (NOT raw LIKE) ──────────────────

  describe('runQuery — uses prefix tsvector + similarity (the index path)', () => {
    it('builds a prefix to_tsquery + similarity() SQL — never LIKE', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.search({
        query: 'yoga',
        type: 'all',
        limit: 5,
        viewerId: 'viewer-1',
      });

      expect(sequelize.query).toHaveBeenCalledTimes(1);
      const [sql, opts] = sequelize.query.mock.calls[0];

      // Reads from the dedicated index — not the source tables.
      expect(sql).toContain('FROM search_doc');
      // Prefix full-text path (typeahead) + trigram fuzzy fallback.
      expect(sql).toContain('to_tsquery');
      expect(sql).not.toContain('websearch_to_tsquery');
      expect(sql).toContain('similarity(search_text');
      // CRITICAL: no raw LIKE / iLike — that would bypass the GIN
      // indexes. CLAUDE.md spells this out for Postgres.
      expect(sql).not.toMatch(/\bLIKE\b/i);
      expect(sql).not.toMatch(/\biLike\b/i);
      // Folded like the index (migration 077): "bucuresti" finds "București".
      expect(sql).toContain("to_tsquery('simple', fold_for_search(:tsQuery))");
      expect(sql).toContain('similarity(search_text, fold_for_search(:q))');
      expect(sql).not.toContain("to_tsquery('simple', :tsQuery)");

      // Parametrised — never string-interpolated. The tsquery is a
      // prefix query so partial words match incrementally.
      expect(opts.type).toBe(QueryTypes.SELECT);
      expect(opts.replacements.q).toBe('yoga');
      expect(opts.replacements.tsQuery).toBe('yoga:*');
      expect(opts.replacements.viewerId).toBe('viewer-1');
    });

    it('builds a multi-term prefix query (AND-ed, each :*)', async () => {
      sequelize.query.mockResolvedValueOnce([]);
      await service.search({
        query: 'yoga coach',
        type: 'all',
        limit: 5,
        viewerId: null,
      });
      expect(sequelize.query.mock.calls[0][1].replacements.tsQuery).toBe(
        'yoga:* & coach:*',
      );
    });

    it('strips tsquery operators so they cannot break parsing', async () => {
      sequelize.query.mockResolvedValueOnce([]);
      await service.search({
        query: "yo'ga & (coach):*",
        type: 'all',
        limit: 5,
        viewerId: null,
      });
      // Operators stripped from each term, prefix re-applied.
      expect(sequelize.query.mock.calls[0][1].replacements.tsQuery).toBe(
        'yoga:* & coach:*',
      );
    });

    it('short-circuits (no DB hit) when the query is only punctuation', async () => {
      const out = await service.search({
        query: '!@#$%',
        type: 'all',
        limit: 5,
        viewerId: null,
      });
      expect(sequelize.query).not.toHaveBeenCalled();
      expect(out.byCategory.instructors.items).toEqual([]);
    });
  });

  // ─── per-entity scoping (type filter honoured) ────────────────────

  describe('runQuery — honours the type filter', () => {
    it('scopes to a single entity_type when type=instructors', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.search({
        query: 'jane',
        type: 'instructors',
        limit: 5,
        viewerId: 'viewer-1',
      });

      const opts = sequelize.query.mock.calls[0][1];
      // Per-value replacements are emitted as t0, t1, …
      const typeValues = Object.entries(opts.replacements)
        .filter(([k]) => /^t\d+$/.test(k))
        .map(([, v]) => v);
      expect(typeValues).toEqual(['instructor']);
    });

    it('scopes to the full five-entity set when type=all', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.search({
        query: 'core',
        type: 'all',
        limit: 5,
        viewerId: 'viewer-1',
      });

      const opts = sequelize.query.mock.calls[0][1];
      const typeValues = Object.entries(opts.replacements)
        .filter(([k]) => /^t\d+$/.test(k))
        .map(([, v]) => v)
        .sort();
      expect(typeValues).toEqual(
        ['group', 'instructor', 'session', 'tag', 'user'].sort(),
      );
    });

    it('maps the people filter to the user entity (not "people")', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.search({
        query: 'dan',
        type: 'people',
        limit: 5,
        viewerId: null,
      });

      const opts = sequelize.query.mock.calls[0][1];
      const typeValues = Object.entries(opts.replacements)
        .filter(([k]) => /^t\d+$/.test(k))
        .map(([, v]) => v);
      expect(typeValues).toEqual(['user']);
    });
  });

  // ─── limit clamp ──────────────────────────────────────────────────

  describe('runQuery — limit clamp', () => {
    it('clamps a huge limit down to the 20 ceiling', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.search({
        query: 'core',
        type: 'all',
        limit: 9999,
        viewerId: null,
      });

      const opts = sequelize.query.mock.calls[0][1];
      expect(opts.replacements.perCategoryLimit).toBe(20);
    });

    it('clamps a 0 / negative limit up to the 1 floor', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.search({
        query: 'core',
        type: 'all',
        limit: 0,
        viewerId: null,
      });

      const opts = sequelize.query.mock.calls[0][1];
      expect(opts.replacements.perCategoryLimit).toBe(1);
    });
  });

  // ─── response shape + bucketization ───────────────────────────────

  describe('byCategory bucketization', () => {
    it('routes each row to its category, snake_case → camelCase, score → number', async () => {
      const rows: SearchQueryRow[] = [
        {
          entity_type: 'instructor',
          entity_id: 'ins-1',
          title: 'Coach Jane',
          subtitle: 'Pilates · 3 yrs',
          avatar_url: 'a.jpg',
          score: 4.2,
        },
        {
          entity_type: 'group',
          entity_id: 'grp-1',
          title: 'Morning Yogis',
          subtitle: '12 members',
          avatar_url: null,
          score: 2.1,
        },
        {
          entity_type: 'session',
          entity_id: 'ses-1',
          title: 'Vinyasa Flow',
          subtitle: 'Bucharest',
          avatar_url: null,
          score: 1.8,
        },
        {
          entity_type: 'tag',
          entity_id: 'tag-1',
          title: 'yoga',
          subtitle: null,
          avatar_url: null,
          score: 0.9,
        },
        {
          entity_type: 'user',
          entity_id: 'usr-1',
          title: 'Dan Member',
          subtitle: 'Bucharest',
          avatar_url: null,
          score: 0.4,
        },
      ];
      sequelize.query.mockResolvedValueOnce(rows);

      const out = await service.search({
        query: 'yoga',
        type: 'all',
        limit: 5,
        viewerId: 'viewer-1',
      });

      expect(out.query).toBe('yoga');
      expect(typeof out.tookMs).toBe('number');

      // The hit lands in its dedicated category with camelCase keys.
      expect(out.byCategory.instructors.items).toHaveLength(1);
      expect(out.byCategory.instructors.items[0]).toEqual({
        type: 'instructor',
        id: 'ins-1',
        title: 'Coach Jane',
        subtitle: 'Pilates · 3 yrs',
        avatarUrl: 'a.jpg',
        score: 4.2,
        // Enrichment fields default when absent from the mock row.
        handle: null,
        slug: null,
        viewerIsMember: false,
      });
      expect(out.byCategory.instructors.total).toBe(1);
      // Cursor is always null in this slice — pagination is in the
      // roadmap, FE contract is just `nextCursor: null`.
      expect(out.byCategory.instructors.nextCursor).toBeNull();

      expect(out.byCategory.groups.items[0].id).toBe('grp-1');
      expect(out.byCategory.sessions.items[0].id).toBe('ses-1');
      expect(out.byCategory.tags.items[0].id).toBe('tag-1');
      expect(out.byCategory.users.items[0].id).toBe('usr-1');
    });

    it('coerces a non-numeric score to 0 instead of NaN-ing the FE', async () => {
      sequelize.query.mockResolvedValueOnce([
        {
          entity_type: 'tag',
          entity_id: 'tag-1',
          title: 'yoga',
          subtitle: null,
          avatar_url: null,
          // Postgres returns numerics as strings via pg by default.
          score: 'not-a-number' as unknown as number,
        },
      ]);

      const out = await service.search({
        query: 'yoga',
        type: 'tags',
        limit: 5,
        viewerId: null,
      });
      expect(out.byCategory.tags.items[0].score).toBe(0);
    });

    it('returns the empty shape when the DB returns no rows', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      const out = await service.search({
        query: 'nothing',
        type: 'all',
        limit: 5,
        viewerId: null,
      });
      expect(out.byCategory.instructors.items).toEqual([]);
      expect(out.byCategory.instructors.total).toBe(0);
    });
  });
});
