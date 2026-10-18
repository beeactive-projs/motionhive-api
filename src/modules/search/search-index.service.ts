import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { QueryTypes, Sequelize, Transaction } from 'sequelize';
import { SearchEntityType } from './entities/search-doc.entity';

/**
 * Owns writes to the `search_doc` index. Source-entity services call
 * the appropriate `upsert*` method on every create/update; soft
 * deletes call `removeIfExists`. Hard deletes are rare in this app
 * (paranoid models) but the method exists for completeness.
 *
 * Each method is idempotent and safe to retry. They run inside the
 * caller's transaction when one is provided; otherwise they run on
 * their own connection. The caller decides — search index drift is
 * preferable to the source-of-truth write rolling back because of
 * an indexing failure.
 *
 * Implemented with raw SQL because:
 *   1. The index is a single denormalized table whose query shape we
 *      tune outside of any model relationships (Sequelize associations
 *      are noisy here).
 *   2. We rely on the GENERATED columns (`search_vector`, `search_text`)
 *      which Sequelize's INSERT ... ON CONFLICT support cannot express
 *      cleanly via the model API.
 */
@Injectable()
export class SearchIndexService {
  constructor(
    @InjectConnection() private readonly _sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────── User ──────

  async upsertUser(userId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      city: string | null;
      avatar_url: string | null;
      is_active: boolean;
    }>(
      `SELECT id, first_name, last_name, city, avatar_url, is_active
         FROM "user"
        WHERE id = :id AND deleted_at IS NULL`,
      {
        replacements: { id: userId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      await this.removeIfExists('user', userId, tx);
      return;
    }

    const title =
      `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || 'Member';

    await this._upsert(
      {
        entityType: 'user',
        entityId: user.id,
        title,
        subtitle: user.city ?? null,
        body: null,
        tags: [],
        city: user.city ?? null,
        // Plain users (non-instructors) are not search-discoverable
        // by default — only instructors and groups should surface
        // in global search to non-friends.
        isPublic: false,
        ownerId: user.id,
        avatarUrl: user.avatar_url ?? null,
      },
      tx,
    );
  }

  // ────── Instructor profile ──────

  async upsertInstructor(userId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      user_id: string;
      first_name: string | null;
      last_name: string | null;
      city: string | null;
      avatar_url: string | null;
      is_active: boolean;
      display_name: string | null;
      bio: string | null;
      specializations: string[] | null;
      years_of_experience: number | null;
      is_accepting_clients: boolean;
    }>(
      `SELECT
         u.id            AS user_id,
         u.first_name,
         u.last_name,
         u.city,
         u.avatar_url,
         u.is_active,
         ip.display_name,
         ip.bio,
         ip.specializations,
         ip.years_of_experience,
         ip.is_accepting_clients
       FROM instructor_profile ip
       INNER JOIN "user" u ON u.id = ip.user_id
       WHERE ip.user_id = :id
         AND u.deleted_at IS NULL`,
      {
        replacements: { id: userId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const ins = rows[0];
    if (!ins || !ins.is_active) {
      await this.removeIfExists('instructor', userId, tx);
      return;
    }

    const fullName = `${ins.first_name ?? ''} ${ins.last_name ?? ''}`.trim();
    const title = ins.display_name?.trim() || fullName || 'Instructor';
    const subtitleParts: string[] = [];
    if (ins.specializations?.length) subtitleParts.push(ins.specializations[0]);
    if (ins.years_of_experience)
      subtitleParts.push(`${ins.years_of_experience} yrs`);
    if (ins.city) subtitleParts.push(ins.city);

    await this._upsert(
      {
        entityType: 'instructor',
        entityId: ins.user_id,
        title,
        subtitle: subtitleParts.join(' · ') || null,
        body: ins.bio ?? null,
        tags: ins.specializations ?? [],
        city: ins.city ?? null,
        // Instructors are publicly discoverable by default; the
        // service layer can override per-instructor later (e.g. a
        // private-coaching-only flag).
        isPublic: true,
        ownerId: ins.user_id,
        avatarUrl: ins.avatar_url ?? null,
      },
      tx,
    );
  }

  // ────── Group ──────

  async upsertGroup(groupId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      id: string;
      instructor_id: string;
      name: string;
      description: string | null;
      tags: string[] | null;
      city: string | null;
      logo_url: string | null;
      is_active: boolean;
      is_public: boolean;
      member_count: number;
    }>(
      `SELECT g.id,
              g.instructor_id,
              g.name,
              g.description,
              g.tags,
              g.city,
              g.logo_url,
              g.is_active,
              g.is_public,
              (SELECT COUNT(*)::int
                 FROM group_member gm
                WHERE gm.group_id = g.id
                  AND gm.left_at IS NULL) AS member_count
         FROM "group" g
        WHERE g.id = :id AND g.deleted_at IS NULL`,
      {
        replacements: { id: groupId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const g = rows[0];
    if (!g || !g.is_active) {
      await this.removeIfExists('group', groupId, tx);
      return;
    }

    const subtitleParts: string[] = [];
    if (g.member_count) subtitleParts.push(`${g.member_count} members`);
    if (g.city) subtitleParts.push(g.city);

    await this._upsert(
      {
        entityType: 'group',
        entityId: g.id,
        title: g.name,
        subtitle: subtitleParts.join(' · ') || null,
        body: g.description ?? null,
        tags: g.tags ?? [],
        city: g.city ?? null,
        isPublic: g.is_public,
        ownerId: g.instructor_id,
        avatarUrl: g.logo_url ?? null,
      },
      tx,
    );
  }

  // ────── Session (template-driven post migration 046) ──────

  /**
   * Index a `session_template` row. Migration 046 rewrote the legacy
   * single-table session model into template + instance — the search
   * index uses templates as the "session" entity because instances
   * inherit everything searchable (title, description, location_kind)
   * from their template. Indexing per-instance would multiply the
   * index by the recurrence count for zero added query value.
   *
   * The `entity_id` we write is the template id; the search read
   * path resolves it back to the template detail page or first
   * upcoming instance.
   */
  async upsertSession(templateId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      id: string;
      instructor_id: string;
      group_id: string | null;
      title: string;
      description: string | null;
      access: string;
      location_kind: string;
      venue_city: string | null;
      status: string;
    }>(
      `SELECT t.id, t.instructor_id, t.group_id, t.title, t.description,
              t.access, t.location_kind, t.status,
              v.city AS venue_city
         FROM session_template t
         LEFT JOIN venue v ON v.id = t.venue_id AND v.deleted_at IS NULL
        WHERE t.id = :id AND t.deleted_at IS NULL`,
      {
        replacements: { id: templateId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const s = rows[0];
    // Only ACTIVE templates surface in search; ENDED + CANCELLED drop out.
    if (!s || s.status !== 'ACTIVE') {
      await this.removeIfExists('session', templateId, tx);
      return;
    }

    // Subtitle prefers a city when present (in-person) else the
    // location-kind label so "ONLINE" still gives the searcher a hint.
    const subtitle =
      s.venue_city ?? (s.location_kind === 'ONLINE' ? 'Online' : null);

    await this._upsert(
      {
        entityType: 'session',
        entityId: s.id,
        title: s.title,
        subtitle,
        body: s.description ?? null,
        tags: [],
        city: s.venue_city ?? null,
        // OPEN/FREE access is publicly discoverable; CLIENTS_ONLY and
        // GROUP_ONLY are gated server-side by the read query (not by
        // dropping out of the index — same pattern as posts).
        isPublic: s.access === 'OPEN' || s.access === 'FREE',
        ownerId: s.instructor_id,
        avatarUrl: null,
      },
      tx,
    );
  }

  // ────── Post ──────

  /**
   * A post is indexed iff the row is alive (deleted_at IS NULL) AND its
   * approval_state is APPROVED. PENDING / REJECTED posts stay out of
   * the index until approved.
   *
   * Visibility is enforced by the read-side WHERE on the viewer's group
   * membership (mirrors the SESSION pattern), so isPublic=false — V1
   * has no public posts.
   */
  async upsertPost(postId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      id: string;
      author_id: string;
      content: string;
      visible: boolean;
    }>(
      `SELECT p.id,
              p.author_id,
              p.content,
              (p.approval_state = 'APPROVED') AS visible
         FROM post p
        WHERE p.id = :id AND p.deleted_at IS NULL`,
      {
        replacements: { id: postId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const p = rows[0];
    if (!p || !p.visible) {
      await this.removeIfExists('post', postId, tx);
      return;
    }

    // Title is a truncated lead so search results have something
    // scannable; full body lives in `body` for trigram + tsvector.
    const title =
      p.content.length > 80 ? `${p.content.slice(0, 77)}...` : p.content;

    await this._upsert(
      {
        entityType: 'post',
        entityId: p.id,
        title,
        subtitle: null,
        body: p.content,
        tags: [],
        city: null,
        isPublic: false,
        ownerId: p.author_id,
        avatarUrl: null,
      },
      tx,
    );
  }

  // ────── Exercise ──────

  /**
   * An exercise is indexed iff the row is alive (deleted_at IS NULL).
   * Visibility (PRIVATE / PUBLIC) is enforced by the read-side WHERE
   * on the viewer's owner_id; SYSTEM exercises are always public.
   *
   * `isPublic` here is the search-doc surface flag:
   *   - SYSTEM         → true (always discoverable)
   *   - PUBLIC custom  → true (any instructor can find)
   *   - PRIVATE custom → false (only the owner reads it from search)
   *
   * Subtitle = primary muscle slug list — gives the search row a
   * scannable "what is this for" hint without joining tables on read.
   */
  async upsertExercise(exerciseId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      id: string;
      name: string;
      description: string | null;
      instructions: string | null;
      source: string;
      visibility: string;
      owner_id: string | null;
      thumbnail_url: string | null;
      primary_muscles: string | null;
    }>(
      `SELECT e.id,
              e.name,
              e.description,
              e.instructions,
              e.source,
              e.visibility,
              e.owner_id,
              e.thumbnail_url,
              (
                SELECT string_agg(m.common_name, ', ' ORDER BY m.display_order)
                  FROM exercise_muscle em
                  JOIN muscle m ON m.id = em.muscle_id
                 WHERE em.exercise_id = e.id AND em.role = 'PRIMARY'
              ) AS primary_muscles
         FROM exercise e
        WHERE e.id = :id AND e.deleted_at IS NULL`,
      {
        replacements: { id: exerciseId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const e = rows[0];
    if (!e) {
      await this.removeIfExists('exercise', exerciseId, tx);
      return;
    }

    const isPublic = e.source === 'SYSTEM' || e.visibility === 'PUBLIC';
    // Body fuses description + instructions so a single trigram search
    // hits either form text.
    const body =
      [e.description, e.instructions].filter(Boolean).join('\n\n') || null;

    await this._upsert(
      {
        entityType: 'exercise',
        entityId: e.id,
        title: e.name,
        subtitle: e.primary_muscles,
        body,
        tags: [],
        city: null,
        isPublic,
        ownerId: e.owner_id,
        avatarUrl: e.thumbnail_url,
      },
      tx,
    );
  }

  // ────── Generic remove ──────

  async removeIfExists(
    entityType: SearchEntityType,
    entityId: string,
    tx?: Transaction,
  ): Promise<void> {
    await this._sequelize.query(
      `DELETE FROM search_doc WHERE entity_type = :t AND entity_id = :id`,
      {
        replacements: { t: entityType, id: entityId },
        transaction: tx,
        type: QueryTypes.DELETE,
      },
    );
  }

  /**
   * Every doc a person appears in or owns: their user and coach rows, and
   * the groups, sessions, posts and exercises they own. Used when an account
   * is deactivated for deletion; `upsertUser` / `upsertInstructor` put the
   * person back if they keep it.
   */
  async removeAllForUser(userId: string, tx?: Transaction): Promise<void> {
    await this._sequelize.query(
      `DELETE FROM search_doc
        WHERE owner_id = :id
           OR (entity_type IN ('user', 'instructor') AND entity_id = :id)`,
      {
        replacements: { id: userId },
        transaction: tx,
        type: QueryTypes.DELETE,
      },
    );
  }

  // ────── Backfill ──────

  /**
   * Idempotent full reindex. Run once after the migration ships; can
   * also be wired to a future scheduled job as a drift backstop.
   *
   * Intentionally serial: it runs against production-sized tables so
   * we want predictable load, not parallelism.
   */
  async reindexAll(): Promise<{
    users: number;
    instructors: number;
    groups: number;
    sessions: number;
    orphansPurged: number;
  }> {
    this.logger.log(
      'reindexAll: starting full search-index rebuild',
      'SearchIndexService',
    );

    const result = {
      users: 0,
      instructors: 0,
      groups: 0,
      sessions: 0,
      orphansPurged: 0,
    };

    // Users — only those active and non-deleted
    const users = await this._sequelize.query<{ id: string }>(
      `SELECT id FROM "user" WHERE deleted_at IS NULL AND is_active = TRUE`,
      { type: QueryTypes.SELECT },
    );
    for (const u of users) {
      await this.upsertUser(u.id);
      result.users += 1;
    }

    const instructors = await this._sequelize.query<{ user_id: string }>(
      `SELECT user_id FROM instructor_profile`,
      { type: QueryTypes.SELECT },
    );
    for (const i of instructors) {
      await this.upsertInstructor(i.user_id);
      result.instructors += 1;
    }

    const groups = await this._sequelize.query<{ id: string }>(
      `SELECT id FROM "group" WHERE deleted_at IS NULL`,
      { type: QueryTypes.SELECT },
    );
    for (const g of groups) {
      await this.upsertGroup(g.id);
      result.groups += 1;
    }

    // Migration 046 replaced the `session` table with template +
    // instance. We index TEMPLATES (one searchable row per series
    // or one-off) — instances are derivatives and don't add lookup
    // value for the user typing "yoga".
    const templates = await this._sequelize.query<{ id: string }>(
      `SELECT id FROM session_template
        WHERE deleted_at IS NULL AND status = 'ACTIVE'`,
      { type: QueryTypes.SELECT },
    );
    for (const t of templates) {
      await this.upsertSession(t.id);
      result.sessions += 1;
    }

    // Purge orphans — index rows whose source entity no longer exists
    // (deleted without a removeIfExists hook, or by raw SQL / migration).
    // Without this, reindexAll only ADDS, so a "repair" run can't clean
    // drift. Tag rows aren't generated here yet, so they're left alone.
    result.orphansPurged = await this._purgeOrphans({
      user: users.map((u) => u.id),
      instructor: instructors.map((i) => i.user_id),
      group: groups.map((g) => g.id),
      session: templates.map((t) => t.id),
    });

    this.logger.log(
      `reindexAll: done — ${result.users} users, ${result.instructors} instructors, ${result.groups} groups, ${result.sessions} sessions, ${result.orphansPurged} orphans purged`,
      'SearchIndexService',
    );
    return result;
  }

  /**
   * Delete index rows whose source entity is no longer live. For each
   * type, keep only rows whose `entity_id` is in the supplied live set;
   * an empty live set purges every row of that type (nothing qualifies).
   * Returns the number of rows removed.
   */
  private async _purgeOrphans(live: {
    user: string[];
    instructor: string[];
    group: string[];
    session: string[];
  }): Promise<number> {
    let purged = 0;
    for (const [type, ids] of Object.entries(live)) {
      const removed = await this._sequelize.query<{ id: string }>(
        `DELETE FROM search_doc
          WHERE entity_type = :type
            AND NOT (entity_id = ANY(:ids::text[]))
          RETURNING id`,
        {
          replacements: { type, ids },
          type: QueryTypes.SELECT,
        },
      );
      purged += removed.length;
    }
    return purged;
  }

  // ────── Internals ──────

  private async _upsert(
    payload: {
      entityType: SearchEntityType;
      entityId: string;
      title: string;
      subtitle: string | null;
      body: string | null;
      tags: string[];
      city: string | null;
      isPublic: boolean;
      ownerId: string | null;
      avatarUrl: string | null;
    },
    tx?: Transaction,
  ): Promise<void> {
    // search_vector / search_text are normally derived from the other
    // columns. Postgres can't have them as GENERATED (the text-search
    // config and array_to_string aren't immutable for the planner), so
    // we compute them inside the INSERT instead.
    //   - setweight A  → title (highest boost)
    //   - setweight B  → tags + subtitle
    //   - setweight C  → body
    //   - search_text  → lowercase concat for trigram similarity()
    //
    // Uses positional `bind` ($1, $2, …) instead of `replacements`
    // because Sequelize's replacement engine string-joins JS arrays and
    // an empty array becomes literally nothing — producing the broken
    // SQL "VALUES (..., ,...)". The `pg` driver's native parameter
    // binding handles text[] arrays correctly, including empty ones.
    await this._sequelize.query(
      `INSERT INTO search_doc
         (entity_type, entity_id, title, subtitle, body, tags, city,
          is_public, owner_id, avatar_url,
          search_vector, search_text, updated_at)
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         (
           setweight(to_tsvector('simple', coalesce($3::text, '')),    'A') ||
           setweight(to_tsvector('simple', array_to_string(coalesce($6::text[], '{}'::text[]), ' ')), 'B') ||
           setweight(to_tsvector('simple', coalesce($4::text, '')), 'B') ||
           setweight(to_tsvector('simple', coalesce($5::text, '')),     'C')
         ),
         lower(
           coalesce($3::text, '') || ' ' ||
           coalesce($4::text, '') || ' ' ||
           coalesce($5::text, '') || ' ' ||
           array_to_string(coalesce($6::text[], '{}'::text[]), ' ')
         ),
         NOW()
       )
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         title         = EXCLUDED.title,
         subtitle      = EXCLUDED.subtitle,
         body          = EXCLUDED.body,
         tags          = EXCLUDED.tags,
         city          = EXCLUDED.city,
         is_public     = EXCLUDED.is_public,
         owner_id      = EXCLUDED.owner_id,
         avatar_url    = EXCLUDED.avatar_url,
         search_vector = EXCLUDED.search_vector,
         search_text   = EXCLUDED.search_text,
         updated_at    = NOW()`,
      {
        bind: [
          payload.entityType,
          payload.entityId,
          payload.title,
          payload.subtitle,
          payload.body,
          payload.tags ?? [],
          payload.city,
          payload.isPublic,
          payload.ownerId,
          payload.avatarUrl,
        ],
        transaction: tx,
        type: QueryTypes.INSERT,
      },
    );
  }
}
