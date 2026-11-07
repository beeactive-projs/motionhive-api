import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { Exercise } from '../exercise/entities/exercise.entity';
import { CoachAccessService } from '../workout/coach-access.service';
import { streakFromWeeks } from '../workout/training-streak';
import { ProgressService } from './progress.service';
import { RosterWindow } from './dto/roster.query.dto';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

/**
 * Streak math is the part worth pinning down: it is pure, it has real
 * edge cases, and getting it wrong is the kind of bug someone notices
 * emotionally before they notice it factually.
 *
 * Weeks are Monday-based ISO dates, newest first, matching what
 * `_activeWeeks` returns from Postgres `DATE_TRUNC('week', …)`.
 */
describe('ProgressService — streaks', () => {
  let service: ProgressService;
  let query: jest.Mock;
  // The pure helper the overview (and the workout summary) call; going
  // through `overview()` would mean mocking six queries to assert on
  // arithmetic.
  const streak = (weeks: string[]) => streakFromWeeks(weeks);

  /** Monday of the current week, then N weeks back, as ISO dates. */
  const mondayOffsetWeeks = (n: number): string => {
    const now = new Date();
    const daysSinceMonday = (now.getUTCDay() + 6) % 7;
    const t = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday - n * 7,
    );
    return new Date(t).toISOString().slice(0, 10);
  };

  beforeEach(async () => {
    query = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        ProgressService,
        { provide: getModelToken(Exercise), useValue: { findByPk: jest.fn() } },
        {
          provide: CoachAccessService,
          useValue: { readableAssignmentIds: jest.fn() },
        },
        { provide: Sequelize, useValue: { query } },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(ProgressService);
  });

  // ─── roster: why a client needs attention ────────────────────────

  describe('roster — the attention reason', () => {
    const reason = (input: Record<string, unknown>) =>
      (
        service as unknown as {
          _attentionReason(i: Record<string, unknown>): string | null;
        }
      )._attentionReason({
        activePlans: 1,
        lastWorkoutAt: new Date(),
        daysSince: 0,
        adherencePercent: 100,
        previousAdherencePercent: 100,
        ...input,
      });

    it('flags someone with no active plan ahead of every other reason', () => {
      // Nothing assigned means nothing to be behind on — which used to
      // return null and file them under "On track", beside people who are
      // actually training. It is the coach's omission, and the one thing
      // on the screen they can fix outright, so it outranks the rest.
      expect(reason({ activePlans: 0, lastWorkoutAt: null })).toBe('NO_PLAN');
      expect(reason({ activePlans: 0, daysSince: 30 })).toBe('NO_PLAN');
    });

    it('flags an assigned client who has never logged anything', () => {
      expect(reason({ lastWorkoutAt: null })).toBe('NEVER_STARTED');
    });

    it('flags two weeks of silence ahead of any adherence maths', () => {
      // Someone who has gone quiet matters more than someone whose
      // percentage dipped, so silence wins even on perfect adherence.
      expect(reason({ daysSince: 14 })).toBe('SILENT');
    });

    it('does not call thirteen days silent', () => {
      expect(reason({ daysSince: 13 })).toBeNull();
    });

    it('flags a twenty-point drop even while adherence is still decent', () => {
      expect(
        reason({ adherencePercent: 70, previousAdherencePercent: 90 }),
      ).toBe('DROPPED');
    });

    it('ignores a drop smaller than the threshold', () => {
      expect(
        reason({ adherencePercent: 75, previousAdherencePercent: 90 }),
      ).toBeNull();
    });

    it('flags being behind when there is no prior window to compare', () => {
      expect(
        reason({ adherencePercent: 40, previousAdherencePercent: null }),
      ).toBe('BEHIND');
    });

    it('says nothing about a client with no work due', () => {
      // Null adherence means the question does not apply; it is not 0%.
      expect(
        reason({ adherencePercent: null, previousAdherencePercent: null }),
      ).toBeNull();
    });
  });

  // ─── roster: how much it reads ───────────────────────────────────

  describe('roster — scope', () => {
    const run = async (clientId?: string) => {
      query.mockResolvedValue([]);
      await service.roster(
        'coach-1',
        RosterWindow.FourWeeks,
        '2026-10-29',
        clientId,
      );
      const [sql, options] = query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      return { sql, replacements: options.replacements };
    };

    it("narrows to one client's row when a page asks about one person", async () => {
      const { sql, replacements } = await run('client-1');
      expect(sql).toContain('AND ic.client_id = :clientId');
      expect(replacements.clientId).toBe('client-1');
    });

    it('reads the whole roster when no client is named', async () => {
      const { sql, replacements } = await run();
      expect(sql).not.toContain(':clientId');
      expect(replacements).not.toHaveProperty('clientId');
    });

    it("reads only the coach's own clients' workouts for last seen", async () => {
      const { sql } = await run();
      const lastSeen = sql.slice(
        sql.indexOf('last_seen AS'),
        sql.indexOf('plan_counts AS'),
      );
      expect(lastSeen).toContain('user_id IN (SELECT client_id FROM clients)');
    });

    // A private workout said "trained 2 days ago" on the coach's Home
    // while the log itself stayed closed to them.
    it('dates last seen only from workouts the coach may read', async () => {
      const { sql } = await run();
      const lastSeen = sql.slice(
        sql.indexOf('last_seen AS'),
        sql.indexOf('plan_counts AS'),
      );
      expect(lastSeen).toContain("wl.visibility IN ('COACHES_ONLY', 'PUBLIC')");
      expect(lastSeen).toContain('pa.instructor_id = :instructorId');
      expect(lastSeen).toContain('pa.deleted_at IS NULL');
      expect(lastSeen).not.toContain('ONLY_ME');
    });

    it('asks for no activity totals when there is nobody to count', async () => {
      await run();
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  // ─── roster: how much the clients trained ────────────────────────

  describe('roster — activity totals', () => {
    const clientRow = {
      clientId: 'client-1',
      firstName: 'Anna',
      lastName: 'Popescu',
      avatarUrl: null,
      handle: null,
      due: '3',
      completed: '2',
      skipped: '0',
      prevDue: '3',
      prevCompleted: '2',
      lastWorkoutAt: new Date('2026-10-28T16:20:00Z'),
      activePlans: '1',
    };

    it('adds workouts, the window before and records to the totals', async () => {
      query
        .mockResolvedValueOnce([clientRow])
        .mockResolvedValueOnce([
          { workouts: '5', previousWorkouts: '3', records: '2' },
        ]);
      const roster = await service.roster(
        'coach-1',
        RosterWindow.OneWeek,
        '2026-10-31',
      );
      expect(roster.totals).toMatchObject({
        clients: 1,
        workouts: 5,
        previousWorkouts: 3,
        records: 2,
      });
    });

    it('counts only what the coach may read, in both windows', async () => {
      query
        .mockResolvedValueOnce([clientRow])
        .mockResolvedValueOnce([
          { workouts: '0', previousWorkouts: '0', records: '0' },
        ]);
      await service.roster(
        'coach-1',
        RosterWindow.OneWeek,
        '2026-10-31',
        'client-1',
      );
      const [sql, options] = query.mock.calls[1] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      expect(sql).toContain("wl.visibility IN ('COACHES_ONLY', 'PUBLIC')");
      expect(sql).toContain('pa.instructor_id = :instructorId');
      expect(sql).toContain('AND ic.client_id = :clientId');
      expect(sql).toContain("x.source = 'ESTIMATED_EPLEY'");
      expect(sql).toContain('x.recorded_at > x.first_at');
      expect(options.replacements).toMatchObject({
        days: 7,
        today: '2026-10-31',
        clientId: 'client-1',
      });
    });
  });

  // ─── the coach's activity feed ───────────────────────────────────

  describe('activity', () => {
    it("reads only active clients' workouts the coach may read, newest first", async () => {
      query.mockResolvedValue([]);
      await service.activity('coach-1', 5);
      const [sql, options] = query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      expect(sql).toContain("ic.status = 'ACTIVE'");
      expect(sql).toContain("wl.visibility IN ('COACHES_ONLY', 'PUBLIC')");
      expect(sql).toContain('pa.deleted_at IS NULL');
      expect(sql).toContain('ORDER BY wl.completed_at DESC');
      expect(sql).toContain('LIMIT :limit');
      expect(options.replacements).toMatchObject({
        instructorId: 'coach-1',
        limit: 5,
      });
    });

    it('counts a first time on an exercise as no record', async () => {
      query.mockResolvedValue([]);
      await service.activity('coach-1', 5);
      const [sql] = query.mock.calls[0] as [string];
      expect(sql).toContain('PARTITION BY orm.user_id, orm.exercise_id');
      expect(sql).toContain('x.recorded_at > x.first_at');
      expect(sql).toContain('BETWEEN wl.started_at AND wl.completed_at');
    });

    it('names the client and turns the counts into numbers', async () => {
      query.mockResolvedValue([
        {
          workoutLogId: 'log-1',
          clientId: 'client-1',
          firstName: 'Anna',
          lastName: 'Popescu',
          avatarUrl: null,
          handle: 'anna',
          workoutName: 'Upper A',
          completedAt: new Date('2026-10-28T16:20:00Z'),
          durationSeconds: 3120,
          recordCount: '2',
        },
      ]);
      const [item] = await service.activity('coach-1', 5);
      expect(item).toEqual({
        workoutLogId: 'log-1',
        clientId: 'client-1',
        name: 'Anna Popescu',
        avatarUrl: null,
        handle: 'anna',
        workoutName: 'Upper A',
        completedAt: '2026-10-28T16:20:00.000Z',
        durationSeconds: 3120,
        recordCount: 2,
      });
    });
  });

  // ─── the Progress list: every exercise trained ───────────────────
  describe('trained exercises', () => {
    const row = {
      exerciseId: 'ex-1',
      exerciseName: 'Împins la piept',
      kind: 'STRENGTH',
      sessionCount: '7',
      lastPerformedAt: new Date('2026-10-28T16:20:00Z'),
      recent: [
        {
          workoutLogId: 'log-2',
          performedAt: '2026-10-28T16:20:00Z',
          topWeightKg: '62.50',
          topReps: 7,
          bestDurationSeconds: null,
          bestDistanceMeters: null,
        },
      ],
    };

    it("reads the caller's completed sets, one row per exercise, in their language", async () => {
      query.mockResolvedValue([row]);
      const [item] = await service.trainedExercises('user-1', 'ro');
      const [sql, options] = query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      expect(sql).toContain("wl.status = 'COMPLETED'");
      expect(sql).toContain('ls.is_completed = TRUE');
      expect(sql).toContain('r.rn <= :recentSessions');
      expect(sql).not.toContain('visibility');
      expect(options.replacements).toMatchObject({
        userId: 'user-1',
        locale: 'ro',
        recentSessions: 6,
      });
      expect(item).toEqual({
        exerciseId: 'ex-1',
        exerciseName: 'Împins la piept',
        kind: 'STRENGTH',
        sessionCount: 7,
        lastPerformedAt: row.lastPerformedAt,
        recent: [
          {
            workoutLogId: 'log-2',
            performedAt: new Date('2026-10-28T16:20:00Z'),
            topWeightKg: 62.5,
            topReps: 7,
            bestDurationSeconds: null,
            bestDistanceMeters: null,
          },
        ],
      });
    });

    it('gives a coach only the workouts they may read', async () => {
      const access = (
        service as unknown as {
          coachAccess: { readableAssignmentIds: jest.Mock };
        }
      ).coachAccess;
      access.readableAssignmentIds.mockResolvedValue(['pa-1']);
      query.mockResolvedValue([]);
      await service.trainedExercisesForCoach('coach-1', 'client-1', 'en');
      const [sql, options] = query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      expect(access.readableAssignmentIds).toHaveBeenCalledWith(
        'coach-1',
        'client-1',
      );
      expect(sql).toContain('wl.program_assignment_id IN (:assignmentIds)');
      expect(sql).toContain("wl.visibility IN ('COACHES_ONLY', 'PUBLIC')");
      expect(options.replacements).toMatchObject({
        userId: 'client-1',
        assignmentIds: ['pa-1'],
      });
    });
  });

  it('reports nothing for someone who has never trained', () => {
    expect(streak([])).toEqual({ currentWeeks: 0, bestWeeks: 0 });
  });

  it('counts consecutive weeks ending this week', () => {
    const weeks = [0, 1, 2].map(mondayOffsetWeeks);
    expect(streak(weeks)).toEqual({ currentWeeks: 3, bestWeeks: 3 });
  });

  it('keeps the streak alive when the current week has no workout yet', () => {
    // Someone who trains Mon-Fri should not watch their streak die on a
    // Sunday before they have had the chance to train.
    const weeks = [1, 2, 3].map(mondayOffsetWeeks);
    expect(streak(weeks).currentWeeks).toBe(3);
  });

  it('breaks the current streak once two weeks have been missed', () => {
    const weeks = [2, 3, 4].map(mondayOffsetWeeks);
    const res = streak(weeks);
    expect(res.currentWeeks).toBe(0);
    // The run still happened, so the personal best survives.
    expect(res.bestWeeks).toBe(3);
  });

  it('remembers the best run even when the current one is shorter', () => {
    // Trained this week and last, then a gap, then a 4-week block.
    const weeks = [0, 1, 5, 6, 7, 8].map(mondayOffsetWeeks);
    expect(streak(weeks)).toEqual({ currentWeeks: 2, bestWeeks: 4 });
  });

  it('treats a single lonely week as a streak of one', () => {
    expect(streak([mondayOffsetWeeks(0)])).toEqual({
      currentWeeks: 1,
      bestWeeks: 1,
    });
  });
});
