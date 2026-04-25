import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
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
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(@InjectConnection() private readonly _sequelize: Sequelize) {}

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
      `SELECT id, instructor_id, name, description, tags, city, logo_url,
              is_active, is_public, member_count
         FROM "group"
        WHERE id = :id AND deleted_at IS NULL`,
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

  // ────── Session ──────

  async upsertSession(sessionId: string, tx?: Transaction): Promise<void> {
    const rows = await this._sequelize.query<{
      id: string;
      instructor_id: string;
      group_id: string | null;
      title: string;
      description: string | null;
      location: string | null;
      visibility: string;
      status: string;
      scheduled_at: Date;
    }>(
      `SELECT id, instructor_id, group_id, title, description, location,
              visibility, status, scheduled_at
         FROM session
        WHERE id = :id AND deleted_at IS NULL`,
      {
        replacements: { id: sessionId },
        transaction: tx,
        type: QueryTypes.SELECT,
      },
    );

    const s = rows[0];
    // Drafts and cancelled sessions never appear in search.
    if (!s || s.status === 'DRAFT' || s.status === 'CANCELLED') {
      await this.removeIfExists('session', sessionId, tx);
      return;
    }

    await this._upsert(
      {
        entityType: 'session',
        entityId: s.id,
        title: s.title,
        subtitle: s.location ?? null,
        body: s.description ?? null,
        tags: [],
        city: null,
        // Only PUBLIC sessions are open-search; group/clients/private
        // visibility is enforced in the read-side WHERE clause via the
        // viewer's relationships, not by leaving them out of the index.
        isPublic: s.visibility === 'PUBLIC',
        ownerId: s.instructor_id,
        avatarUrl: null,
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
  }> {
    this.logger.log('reindexAll: starting full search-index rebuild');

    const result = { users: 0, instructors: 0, groups: 0, sessions: 0 };

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

    const sessions = await this._sequelize.query<{ id: string }>(
      `SELECT id FROM session WHERE deleted_at IS NULL AND status NOT IN ('DRAFT', 'CANCELLED')`,
      { type: QueryTypes.SELECT },
    );
    for (const s of sessions) {
      await this.upsertSession(s.id);
      result.sessions += 1;
    }

    this.logger.log(
      `reindexAll: done — ${result.users} users, ${result.instructors} instructors, ${result.groups} groups, ${result.sessions} sessions`,
    );
    return result;
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
    await this._sequelize.query(
      `INSERT INTO search_doc
         (entity_type, entity_id, title, subtitle, body, tags, city,
          is_public, owner_id, avatar_url,
          search_vector, search_text, updated_at)
       VALUES (
         :entityType, :entityId, :title, :subtitle, :body, :tags, :city,
         :isPublic, :ownerId, :avatarUrl,
         (
           setweight(to_tsvector('simple', coalesce(:title::text, '')),    'A') ||
           setweight(to_tsvector('simple', array_to_string(coalesce(:tags::text[], '{}'::text[]), ' ')), 'B') ||
           setweight(to_tsvector('simple', coalesce(:subtitle::text, '')), 'B') ||
           setweight(to_tsvector('simple', coalesce(:body::text, '')),     'C')
         ),
         lower(
           coalesce(:title::text, '') || ' ' ||
           coalesce(:subtitle::text, '') || ' ' ||
           coalesce(:body::text, '') || ' ' ||
           array_to_string(coalesce(:tags::text[], '{}'::text[]), ' ')
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
        replacements: {
          entityType: payload.entityType,
          entityId: payload.entityId,
          title: payload.title,
          subtitle: payload.subtitle,
          body: payload.body,
          tags: payload.tags,
          city: payload.city,
          isPublic: payload.isPublic,
          ownerId: payload.ownerId,
          avatarUrl: payload.avatarUrl,
        },
        transaction: tx,
        type: QueryTypes.INSERT,
      },
    );
  }
}
