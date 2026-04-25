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
}

export interface SearchResultItem {
  type: 'user' | 'instructor' | 'group' | 'session' | 'tag';
  id: string;
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  score: number;
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

    const rows = await this._runQuery(q, wantedTypes, opts.viewerId, limit);

    return {
      query: q,
      tookMs: Date.now() - t0,
      byCategory: this._bucketize(rows, limit),
    };
  }

  // ─────────────────────────────────────────────────────────────────

  private async _runQuery(
    q: string,
    types: string[],
    viewerId: string | null,
    perCategoryLimit: number,
  ): Promise<SearchQueryRow[]> {
    // Two SQL fragments OR'd:
    //   1. tsvector @@ websearch_to_tsquery — precise match
    //   2. similarity(search_text, q) > 0.25 — fuzzy fallback for typos
    // and a single composite score that combines both signals.

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
            COALESCE(ts_rank_cd(search_vector, websearch_to_tsquery('simple', :q)), 0) * 1.0
            + similarity(search_text, :q) * 0.4
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
              COALESCE(ts_rank_cd(search_vector, websearch_to_tsquery('simple', :q)), 0)
              + similarity(search_text, :q) * 0.4
            ) DESC
          ) AS rn
        FROM search_doc
        WHERE entity_type IN (${typePlaceholders})
          AND (
            search_vector @@ websearch_to_tsquery('simple', :q)
            OR similarity(search_text, :q) > 0.25
          )
          AND (
            is_public = TRUE
            OR (:viewerId::text IS NOT NULL AND owner_id = :viewerId)
          )
      )
      SELECT entity_type, entity_id, title, subtitle, avatar_url, score
      FROM ranked
      WHERE rn <= :perCategoryLimit
      ORDER BY score DESC
    `;

    const rows = await this._sequelize.query<SearchQueryRow>(sql, {
      replacements: {
        q,
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
