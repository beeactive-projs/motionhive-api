import { Test } from '@nestjs/testing';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { SearchIndexService } from './search-index.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for SearchIndexService — the write-side of global search.
 *
 * The service is raw-SQL by design (Sequelize associations are noisy
 * for a denormalised index + we lean on the GENERATED columns from
 * migration 029). We can't assert SQL correctness without a real
 * Postgres, but we CAN guarantee:
 *   - Boots.
 *   - upsertUser does a SELECT then an INSERT … ON CONFLICT to
 *     search_doc with the correct positional bind params (UPSERT
 *     semantics, not duplicate rows).
 *   - Re-running upsertUser issues another ON CONFLICT statement
 *     with the same (entity_type, entity_id) → update-not-insert
 *     semantics.
 *   - When the source row is missing / inactive, removeIfExists fires
 *     instead (cleanup contract).
 *   - removeIfExists writes a parametrised DELETE keyed on
 *     (entity_type, entity_id).
 *   - The caller's transaction is forwarded to every query (so the
 *     index write rolls back with the source write).
 */
describe('SearchIndexService (smoke — not exhaustive)', () => {
  let service: SearchIndexService;

  // The service uses `query()` for everything (SELECT, INSERT … ON
  // CONFLICT, DELETE). The first call in each upsert* is the SELECT
  // against the source table; the second is the search_doc INSERT.
  const sequelize = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SearchIndexService,
        { provide: Sequelize, useValue: sequelize },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(SearchIndexService);
  });

  // ─── boots ────────────────────────────────────────────────────────

  it('constructs', () => {
    expect(service).toBeDefined();
  });

  // ─── upsertUser: SELECT then UPSERT round-trip ────────────────────

  describe('upsertUser', () => {
    it('selects from "user", then writes to search_doc with positional binds', async () => {
      // 1st query — SELECT from "user"
      sequelize.query.mockResolvedValueOnce([
        {
          id: 'u-1',
          first_name: 'Dan',
          last_name: 'Member',
          city: 'Bucharest',
          avatar_url: 'a.jpg',
          is_active: true,
        },
      ]);
      // 2nd query — INSERT … ON CONFLICT into search_doc
      sequelize.query.mockResolvedValueOnce([]);

      await service.upsertUser('u-1');

      expect(sequelize.query).toHaveBeenCalledTimes(2);

      // SELECT call
      const [selectSql, selectOpts] = sequelize.query.mock.calls[0];
      expect(selectSql).toContain('FROM "user"');
      expect(selectSql).toContain('deleted_at IS NULL');
      expect(selectOpts.replacements).toEqual({ id: 'u-1' });
      expect(selectOpts.type).toBe(QueryTypes.SELECT);

      // INSERT call
      const [insertSql, insertOpts] = sequelize.query.mock.calls[1];
      expect(insertSql).toContain('INSERT INTO search_doc');
      expect(insertSql).toContain('ON CONFLICT (entity_type, entity_id)');
      expect(insertSql).toContain('DO UPDATE SET');
      expect(insertOpts.type).toBe(QueryTypes.INSERT);
      // Uses positional `bind` (NOT `replacements`) — empty arrays
      // would otherwise blow up tags column. See service-level comment.
      expect(insertOpts.bind).toBeDefined();
      // bind[0]=entity_type, bind[1]=entity_id, bind[2]=title
      expect(insertOpts.bind[0]).toBe('user');
      expect(insertOpts.bind[1]).toBe('u-1');
      expect(insertOpts.bind[2]).toBe('Dan Member');
      // tags array is bind[5] — empty for users, but provided as []
      // (not undefined → would break the array_to_string coalesce path)
      expect(Array.isArray(insertOpts.bind[5])).toBe(true);
      // ownerId at bind[8] — users own themselves in the index
      expect(insertOpts.bind[8]).toBe('u-1');
      // Stored folded, as the query folds its term (migration 077): the
      // title's tsvector and the similarity text both lose accents and case.
      expect(insertSql).toContain(
        "to_tsvector('simple', fold_for_search(coalesce($3::text, '')))",
      );
      expect(insertSql).not.toMatch(/\blower\(/);
    });

    it('falls back to "Member" when both names are null', async () => {
      sequelize.query.mockResolvedValueOnce([
        {
          id: 'u-2',
          first_name: null,
          last_name: null,
          city: null,
          avatar_url: null,
          is_active: true,
        },
      ]);
      sequelize.query.mockResolvedValueOnce([]);

      await service.upsertUser('u-2');
      // title is the 3rd positional bind
      expect(sequelize.query.mock.calls[1][1].bind[2]).toBe('Member');
    });

    it('removes the row instead of inserting when the user is inactive', async () => {
      sequelize.query.mockResolvedValueOnce([
        {
          id: 'u-3',
          first_name: 'Dan',
          last_name: null,
          city: null,
          avatar_url: null,
          is_active: false,
        },
      ]);
      // The follow-up DELETE
      sequelize.query.mockResolvedValueOnce([]);

      await service.upsertUser('u-3');

      const [deleteSql, deleteOpts] = sequelize.query.mock.calls[1];
      expect(deleteSql).toContain('DELETE FROM search_doc');
      expect(deleteOpts.replacements).toEqual({ t: 'user', id: 'u-3' });
      expect(deleteOpts.type).toBe(QueryTypes.DELETE);
    });

    it('removes the row when the user does not exist in the source table', async () => {
      sequelize.query.mockResolvedValueOnce([]); // SELECT returns no rows
      sequelize.query.mockResolvedValueOnce([]); // DELETE

      await service.upsertUser('u-ghost');
      const [deleteSql] = sequelize.query.mock.calls[1];
      expect(deleteSql).toContain('DELETE FROM search_doc');
    });

    it('forwards the caller transaction to both the SELECT and the INSERT', async () => {
      sequelize.query.mockResolvedValueOnce([
        {
          id: 'u-tx',
          first_name: 'Dan',
          last_name: null,
          city: null,
          avatar_url: null,
          is_active: true,
        },
      ]);
      sequelize.query.mockResolvedValueOnce([]);

      await service.upsertUser('u-tx', fakeTx as never);

      expect(sequelize.query.mock.calls[0][1].transaction).toBe(fakeTx);
      expect(sequelize.query.mock.calls[1][1].transaction).toBe(fakeTx);
    });
  });

  // ─── Re-index is UPSERT, not duplicate (smoke) ────────────────────

  describe('upsertUser called twice — relies on ON CONFLICT, not row duplication', () => {
    it('issues an ON CONFLICT statement on every call (same row, no duplicate insert)', async () => {
      const sourceRow = {
        id: 'u-5',
        first_name: 'Dan',
        last_name: 'Member',
        city: 'Bucharest',
        avatar_url: null,
        is_active: true,
      };
      // First round-trip
      sequelize.query.mockResolvedValueOnce([sourceRow]);
      sequelize.query.mockResolvedValueOnce([]);
      // Second round-trip
      sequelize.query.mockResolvedValueOnce([sourceRow]);
      sequelize.query.mockResolvedValueOnce([]);

      await service.upsertUser('u-5');
      await service.upsertUser('u-5');

      // 2 SELECTs + 2 INSERTs
      expect(sequelize.query).toHaveBeenCalledTimes(4);
      const firstInsertSql = sequelize.query.mock.calls[1][0];
      const secondInsertSql = sequelize.query.mock.calls[3][0];
      // Both write paths go through the same UPSERT statement.
      expect(firstInsertSql).toContain('ON CONFLICT (entity_type, entity_id)');
      expect(secondInsertSql).toContain('ON CONFLICT (entity_type, entity_id)');
      // Both target the same (entity_type, entity_id) pair → DB-level
      // UPSERT updates the existing row instead of duplicating.
      const firstBind = sequelize.query.mock.calls[1][1].bind;
      const secondBind = sequelize.query.mock.calls[3][1].bind;
      expect(firstBind[0]).toBe(secondBind[0]); // entity_type
      expect(firstBind[1]).toBe(secondBind[1]); // entity_id
    });
  });

  // ─── removeIfExists ───────────────────────────────────────────────

  describe('removeIfExists', () => {
    it('writes a parametrised DELETE keyed on (entity_type, entity_id)', async () => {
      sequelize.query.mockResolvedValueOnce([]);

      await service.removeIfExists('group', 'g-1');

      expect(sequelize.query).toHaveBeenCalledTimes(1);
      const [sql, opts] = sequelize.query.mock.calls[0];
      expect(sql).toContain('DELETE FROM search_doc');
      expect(sql).toContain('entity_type = :t');
      expect(sql).toContain('entity_id = :id');
      expect(opts.replacements).toEqual({ t: 'group', id: 'g-1' });
      expect(opts.type).toBe(QueryTypes.DELETE);
    });

    it('forwards the caller transaction', async () => {
      sequelize.query.mockResolvedValueOnce([]);
      await service.removeIfExists('session', 'ses-1', fakeTx as never);
      expect(sequelize.query.mock.calls[0][1].transaction).toBe(fakeTx);
    });
  });

  // ─── upsertSession: post-migration-046 template path ──────────────

  describe('upsertSession', () => {
    it('reads from session_template (NOT the legacy session table) — migration 046', async () => {
      sequelize.query.mockResolvedValueOnce([
        {
          id: 't-1',
          instructor_id: 'ins-1',
          group_id: null,
          title: 'Vinyasa Flow',
          description: 'Morning class.',
          access: 'OPEN',
          location_kind: 'STUDIO',
          venue_city: 'Bucharest',
          status: 'ACTIVE',
        },
      ]);
      sequelize.query.mockResolvedValueOnce([]);

      await service.upsertSession('t-1');

      const selectSql = sequelize.query.mock.calls[0][0];
      expect(selectSql).toContain('FROM session_template');
      // The bind payload encodes `session` as entity_type with the
      // template id as entity_id (instances inherit, see service docs).
      const insertBind = sequelize.query.mock.calls[1][1].bind;
      expect(insertBind[0]).toBe('session');
      expect(insertBind[1]).toBe('t-1');
      // OPEN access → publicly discoverable
      expect(insertBind[7]).toBe(true);
    });

    it('removes the doc when the template is not ACTIVE (ENDED / CANCELLED drop out)', async () => {
      sequelize.query.mockResolvedValueOnce([
        {
          id: 't-2',
          instructor_id: 'ins-1',
          group_id: null,
          title: 'Dead class',
          description: null,
          access: 'OPEN',
          location_kind: 'STUDIO',
          venue_city: null,
          status: 'ENDED',
        },
      ]);
      sequelize.query.mockResolvedValueOnce([]); // DELETE

      await service.upsertSession('t-2');
      const [deleteSql, deleteOpts] = sequelize.query.mock.calls[1];
      expect(deleteSql).toContain('DELETE FROM search_doc');
      expect(deleteOpts.replacements).toEqual({ t: 'session', id: 't-2' });
    });
  });
});
