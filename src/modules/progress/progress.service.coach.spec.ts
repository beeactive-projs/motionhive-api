import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import { CoachAccessService } from '../workout/coach-access.service';
import { ProgramAssignment } from '../workout/entities/program-assignment.entity';
import { ProgressRange } from './dto/progress-range.enum';
import { ProgressService } from './progress.service';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

/**
 * A coach reading a client's Progress screen.
 *
 * The rule under test is CoachAccessService's, used for real here with
 * its two models faked: 404 unless the coach link is ACTIVE, and only
 * logs of the coach's own assignments count, plus any the client set to
 * COACHES_ONLY or PUBLIC.
 *
 * `sequelize.query` is a small in-memory stand-in for Postgres. It knows
 * each progress query by a marker in its SQL and answers it from the
 * fixture logs, applying the scope exactly as SQL would: rows pass
 * `program_assignment_id IN (:assignmentIds)` only when their assignment
 * is in the bound list, and `visibility IN ('COACHES_ONLY', 'PUBLIC')` when the client
 * shared them. So a query that forgot the scope would count every log,
 * and one that forgot the visibility half would miss a shared one; the
 * numbers below would catch either.
 */

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

const BENCH = 'ex-bench';
const SQUAT = 'ex-squat';
const EXERCISE_NAMES: Record<string, { en: string; ro: string }> = {
  [BENCH]: { en: 'Bench press', ro: 'Împins la piept' },
  [SQUAT]: { en: 'Back squat', ro: 'Genuflexiuni' },
};

interface FakeLog {
  id: string;
  userId: string;
  programAssignmentId: string | null;
  at: Date;
  durationSeconds: number;
  name: string;
  sets: Array<{ exerciseId: string; reps: number; weightKg: number }>;
  /** Absent means ONLY_ME, the column default. */
  visibility?: 'ONLY_ME' | 'COACHES_ONLY' | 'PUBLIC';
}

interface FakeOneRepMax {
  userId: string;
  exerciseId: string;
  weightKg: number;
  recordedAt: Date;
  source: string;
}

// ── The client's training ───────────────────────────────────────────

/** On plan, coach-1's assignment. */
const logPlanOld: FakeLog = {
  id: 'log-plan-old',
  userId: 'client-1',
  programAssignmentId: 'asg-mine',
  at: daysAgo(10),
  durationSeconds: 2000,
  name: 'Push A',
  sets: [{ exerciseId: BENCH, reps: 5, weightKg: 70 }],
};
/** On plan, coach-1's assignment. */
const logPlan: FakeLog = {
  id: 'log-plan',
  userId: 'client-1',
  programAssignmentId: 'asg-mine',
  at: daysAgo(1),
  durationSeconds: 3000,
  name: 'Push A',
  sets: [
    { exerciseId: BENCH, reps: 5, weightKg: 80 },
    // Lighter at the same rep count: never the session's best.
    { exerciseId: BENCH, reps: 5, weightKg: 75 },
  ],
};
/** Freestyle: no assignment at all. */
const logFree: FakeLog = {
  id: 'log-free',
  userId: 'client-1',
  programAssignmentId: null,
  at: daysAgo(2),
  durationSeconds: 1800,
  name: 'Solo',
  sets: [
    { exerciseId: BENCH, reps: 3, weightKg: 100 },
    { exerciseId: SQUAT, reps: 5, weightKg: 120 },
  ],
};
/** Another coach's plan. */
const logOther: FakeLog = {
  id: 'log-other',
  userId: 'client-1',
  programAssignmentId: 'asg-other',
  at: daysAgo(3),
  durationSeconds: 2400,
  name: 'Coach two',
  sets: [{ exerciseId: BENCH, reps: 5, weightKg: 90 }],
};

/**
 * What the completion flow wrote: a row only when a session beat the
 * best so far across everything (so log-plan wrote none, 93.33 < 110),
 * plus one MANUAL entry from no log at all.
 */
const storedOneRepMaxes: FakeOneRepMax[] = [
  {
    userId: 'client-1',
    exerciseId: BENCH,
    weightKg: 81.67,
    recordedAt: logPlanOld.at,
    source: 'ESTIMATED_EPLEY',
  },
  {
    userId: 'client-1',
    exerciseId: BENCH,
    weightKg: 105,
    recordedAt: logOther.at,
    source: 'ESTIMATED_EPLEY',
  },
  {
    userId: 'client-1',
    exerciseId: BENCH,
    weightKg: 110,
    recordedAt: logFree.at,
    source: 'ESTIMATED_EPLEY',
  },
  {
    userId: 'client-1',
    exerciseId: SQUAT,
    weightKg: 140,
    recordedAt: logFree.at,
    source: 'ESTIMATED_EPLEY',
  },
  {
    userId: 'client-1',
    exerciseId: BENCH,
    weightKg: 120,
    recordedAt: new Date(Date.now() - DAY_MS / 2),
    source: 'MANUAL',
  },
];

// ── A fake Postgres for the progress queries ────────────────────────

type Replacements = Record<string, unknown>;

const mondayOf = (d: Date) => {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      daysSinceMonday * DAY_MS,
  );
};
const dayOf = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function fakeQuery(logs: FakeLog[], oneRepMaxes: FakeOneRepMax[]) {
  return jest.fn((sql: string, opts: { replacements: Replacements }) => {
    const r = opts.replacements;

    // Named replacements must be bound, as Sequelize insists.
    for (const [, name] of sql.matchAll(/(?<![:\w]):([a-zA-Z]\w*)/g)) {
      if (!(name in r)) throw new Error(`unbound :${name}`);
    }

    const visible = logs.filter((l) => {
      if (l.userId !== r.userId) return false;
      if (/\bAND FALSE\b/.test(sql)) return false;
      const own =
        /program_assignment_id IN \(:assignmentIds\)/.test(sql) &&
        (r.assignmentIds as string[]).includes(l.programAssignmentId ?? '');
      if (/visibility IN \('COACHES_ONLY', 'PUBLIC'\)/.test(sql)) {
        return own || (l.visibility ?? 'ONLY_ME') !== 'ONLY_ME';
      }
      if (/program_assignment_id IN \(:assignmentIds\)/.test(sql)) return own;
      return true;
    });
    const since = (days: unknown) =>
      visible.filter((l) => l.at >= daysAgo(Number(days)));
    const volume = (ls: FakeLog[]) =>
      ls.reduce(
        (sum, l) => sum + l.sets.reduce((v, s) => v + s.reps * s.weightKg, 0),
        0,
      );

    let rows: unknown[];
    if (sql.includes('"trainingSeconds"')) {
      const w = visible.filter(
        (l) =>
          l.at >= daysAgo(Number(r.fromDays)) &&
          l.at < daysAgo(Number(r.toDays)),
      );
      rows = [
        {
          workouts: String(w.length),
          trainingSeconds: String(w.reduce((s, l) => s + l.durationSeconds, 0)),
          volumeKg: String(volume(w)),
          setsCompleted: String(w.reduce((s, l) => s + l.sets.length, 0)),
        },
      ];
    } else if (
      sql.includes('SELECT DISTINCT') &&
      !sql.includes('DISTINCT ON')
    ) {
      const weeks = [...new Set(visible.map((l) => +mondayOf(l.at)))];
      rows = weeks
        .sort((a, b) => b - a)
        .map((t) => ({ weekStart: new Date(t) }));
    } else if (sql.includes('AS "volumeKg"') && sql.includes('"weekStart"')) {
      const byWeek = new Map<number, FakeLog[]>();
      for (const l of since(r.days)) {
        const k = +mondayOf(l.at);
        byWeek.set(k, [...(byWeek.get(k) ?? []), l]);
      }
      rows = [...byWeek]
        .sort(([a], [b]) => a - b)
        .map(([k, ls]) => ({
          weekStart: new Date(k),
          volumeKg: String(volume(ls)),
          workouts: String(ls.length),
        }));
    } else if (sql.includes('AS "day"')) {
      const byDay = new Map<number, number>();
      for (const l of since(r.days)) {
        const k = +dayOf(l.at);
        byDay.set(k, (byDay.get(k) ?? 0) + 1);
      }
      rows = [...byDay]
        .sort(([a], [b]) => a - b)
        .map(([k, n]) => ({ day: new Date(k), workouts: String(n) }));
    } else if (sql.includes('AS "total"')) {
      rows = [{ total: String(visible.length) }];
    } else if (sql.includes('AS "setCount"')) {
      rows = visible
        .filter((l) => l.sets.some((s) => s.exerciseId === r.exerciseId))
        .sort((a, b) => +b.at - +a.at)
        .map((l) => {
          const sets = l.sets
            .filter((s) => s.exerciseId === r.exerciseId)
            .sort((a, b) => b.weightKg - a.weightKg);
          return {
            workoutLogId: l.id,
            performedAt: l.at,
            workoutName: l.name,
            setCount: String(sets.length),
            topWeightKg: String(sets[0].weightKg),
            topReps: sets[0].reps,
            bestDurationSeconds: null,
            bestDistanceMeters: null,
          };
        });
    } else if (sql.includes('AS "reps"')) {
      // The best set per (log, exercise) by weight × (30 + reps), kept
      // only when it beats every earlier log's: the query's own filter,
      // so the records below come from the reduced rows it returns.
      const out: Array<Record<string, unknown>> = [];
      const prior = new Map<string, number>();
      for (const l of [...visible].sort((a, b) => +a.at - +b.at)) {
        const best = new Map<string, { reps: number; weightKg: number }>();
        for (const s of l.sets) {
          if (
            sql.includes('le.exercise_id = :exerciseId') &&
            s.exerciseId !== r.exerciseId
          ) {
            continue;
          }
          if (s.reps < 1 || s.reps > 12 || s.weightKg <= 0) continue;
          const cur = best.get(s.exerciseId);
          if (
            !cur ||
            s.weightKg * (30 + s.reps) > cur.weightKg * (30 + cur.reps)
          ) {
            best.set(s.exerciseId, { reps: s.reps, weightKg: s.weightKg });
          }
        }
        for (const [exerciseId, set] of best) {
          const strength = set.weightKg * (30 + set.reps);
          const before = prior.get(exerciseId);
          prior.set(exerciseId, Math.max(before ?? 0, strength));
          if (before !== undefined && strength <= before) continue;
          out.push({
            workoutLogId: l.id,
            exerciseId,
            performedAt: l.at,
            reps: set.reps,
            weightKg: String(set.weightKg),
          });
        }
      }
      rows = out;
    } else if (sql.includes('FROM one_rep_max orm')) {
      const mine = oneRepMaxes
        .filter((o) => o.userId === r.userId)
        .sort((a, b) => +a.recordedAt - +b.recordedAt);
      const latest = new Map<
        string,
        { row: FakeOneRepMax; prior: number | null }
      >();
      for (const o of mine) {
        const prev = latest.get(o.exerciseId);
        latest.set(o.exerciseId, {
          row: o,
          prior: prev ? prev.row.weightKg : null,
        });
      }
      rows = [...latest.values()]
        .sort((a, b) => +b.row.recordedAt - +a.row.recordedAt)
        .map(({ row, prior }) => ({
          exerciseId: row.exerciseId,
          exerciseName: EXERCISE_NAMES[row.exerciseId][r.locale as 'en' | 'ro'],
          weightKg: String(row.weightKg),
          recordedAt: row.recordedAt,
          priorKg: prior == null ? null : String(prior),
        }));
    } else if (sql.includes('FROM one_rep_max')) {
      rows = oneRepMaxes
        .filter((o) => o.userId === r.userId && o.exerciseId === r.exerciseId)
        .sort((a, b) => +a.recordedAt - +b.recordedAt)
        .map((o) => ({
          weightKg: String(o.weightKg),
          recordedAt: o.recordedAt,
          source: o.source,
        }));
    } else if (sql.includes('FROM exercise')) {
      rows = (r.ids as string[]).map((id) => ({
        id,
        name: EXERCISE_NAMES[id][r.locale as 'en' | 'ro'],
      }));
    } else {
      throw new Error(`unexpected query: ${sql}`);
    }
    return Promise.resolve(rows);
  });
}

// ── Coaching relationships ──────────────────────────────────────────

interface FakeLink {
  instructorId: string;
  clientId: string;
  status: InstructorClientStatus;
}
interface FakeAssignment {
  id: string;
  instructorId: string;
  clientId: string;
  shareOffPlan: boolean;
}

describe('ProgressService — a coach reading a client', () => {
  let service: ProgressService;
  let query: ReturnType<typeof fakeQuery>;
  let links: FakeLink[];
  let assignments: FakeAssignment[];

  const exerciseModel = { findByPk: jest.fn() };
  const instructorClientModel = {
    findOne: jest.fn(
      ({ where }: { where: FakeLink }) =>
        links.find(
          (l) =>
            l.instructorId === where.instructorId &&
            l.clientId === where.clientId &&
            l.status === where.status,
        ) ?? null,
    ),
  };
  const assignmentModel = {
    findAll: jest.fn(
      ({ where }: { where: { instructorId: string; clientId: string } }) =>
        assignments.filter(
          (a) =>
            a.instructorId === where.instructorId &&
            a.clientId === where.clientId,
        ),
    ),
  };

  const allLogs = [logPlanOld, logPlan, logFree, logOther];
  /** Fresh copies per test, so one can share a workout without leaking. */
  let logs: FakeLog[];
  const logById = (id: string) => logs.find((l) => l.id === id)!;

  beforeEach(async () => {
    jest.clearAllMocks();
    logs = allLogs.map((l) => ({ ...l }));
    query = fakeQuery(logs, storedOneRepMaxes);
    links = [
      {
        instructorId: 'coach-1',
        clientId: 'client-1',
        status: InstructorClientStatus.ACTIVE,
      },
      {
        instructorId: 'coach-2',
        clientId: 'client-1',
        status: InstructorClientStatus.ACTIVE,
      },
    ];
    assignments = [
      {
        id: 'asg-mine',
        instructorId: 'coach-1',
        clientId: 'client-1',
        shareOffPlan: false,
      },
      {
        id: 'asg-other',
        instructorId: 'coach-2',
        clientId: 'client-1',
        shareOffPlan: false,
      },
    ];
    exerciseModel.findByPk.mockImplementation((id: string) =>
      Promise.resolve(
        EXERCISE_NAMES[id] ? { id, name: EXERCISE_NAMES[id].en } : null,
      ),
    );

    const module = await Test.createTestingModule({
      providers: [
        ProgressService,
        CoachAccessService,
        { provide: getModelToken(Exercise), useValue: exerciseModel },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        {
          provide: getModelToken(ProgramAssignment),
          useValue: assignmentModel,
        },
        { provide: Sequelize, useValue: { query } },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(ProgressService);
  });

  const sqlOf = () => query.mock.calls.map(([sql]) => sql);

  // ─── who may look ─────────────────────────────────────────────────

  describe('access', () => {
    it('404s a coach with no relationship to the person', async () => {
      const err = await service
        .overviewForCoach('coach-9', 'client-1', ProgressRange.FourWeeks)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toEqual(
        expect.objectContaining({ messageKey: 'workout.clientNotFound' }),
      );
      expect(query).not.toHaveBeenCalled();
    });

    it('404s once the relationship is archived, with nothing read', async () => {
      links[0].status = InstructorClientStatus.ARCHIVED;

      await expect(
        service.overviewForCoach(
          'coach-1',
          'client-1',
          ProgressRange.FourWeeks,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.exerciseHistoryForCoach('coach-1', 'client-1', BENCH),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(query).not.toHaveBeenCalled();
      expect(assignmentModel.findAll).not.toHaveBeenCalled();
    });

    it('404s a pending relationship the same way', async () => {
      links[0].status = InstructorClientStatus.PENDING;
      await expect(
        service.exerciseHistoryForCoach('coach-1', 'client-1', BENCH),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('checks the relationship before the exercise, so a stranger learns nothing', async () => {
      await expect(
        service.exerciseHistoryForCoach('coach-9', 'client-1', 'ex-missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(exerciseModel.findByPk).not.toHaveBeenCalled();
    });

    it('keeps the exercise.notFound answer for a real client', async () => {
      const err = await service
        .exerciseHistoryForCoach('coach-1', 'client-1', 'ex-missing')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toEqual(
        expect.objectContaining({ messageKey: 'exercise.notFound' }),
      );
    });
  });

  // ─── a coach the client has not shared off-plan work with ─────────

  describe("restricted to the coach's own plans", () => {
    it("counts only on-plan logs of this coach's assignments", async () => {
      const out = await service.overviewForCoach(
        'coach-1',
        'client-1',
        ProgressRange.FourWeeks,
      );

      // log-plan + log-plan-old. Not the freestyle session, not coach-2's.
      expect(out.totals).toEqual({
        workouts: 2,
        volumeKg: 5 * 80 + 5 * 75 + 5 * 70,
        setsCompleted: 3,
        trainingSeconds: 3000 + 2000,
      });
      expect(out.lifetimeWorkouts).toBe(2);
      expect(out.dailyActivity.reduce((n, d) => n + d.workouts, 0)).toBe(2);
      expect(out.weeklyVolume.reduce((n, w) => n + w.workouts, 0)).toBe(2);
    });

    it("binds every log query to this coach's assignment ids only", async () => {
      await service.overviewForCoach(
        'coach-1',
        'client-1',
        ProgressRange.FourWeeks,
      );

      const logQueries = query.mock.calls.filter(([sql]) =>
        sql.includes('workout_log'),
      );
      // _totals ×2, weekly, daily, active weeks, lifetime, derived records.
      expect(logQueries).toHaveLength(7);
      for (const [sql, opts] of logQueries) {
        expect(sql).toMatch(/program_assignment_id IN \(:assignmentIds\)/);
        expect(opts.replacements.assignmentIds).toEqual(['asg-mine']);
      }
    });

    it('rebuilds records from visible sets, never from one_rep_max', async () => {
      const out = await service.overviewForCoach(
        'coach-1',
        'client-1',
        ProgressRange.FourWeeks,
        'ro',
      );

      // Stored history would say 120 (a manual entry) up from 110 (the
      // freestyle session). The coach sees their own plan only: 5×80
      // ≈ 93.33, up from 5×70 ≈ 81.67. No squat, which was freestyle.
      expect(out.records).toEqual([
        {
          exerciseId: BENCH,
          exerciseName: 'Împins la piept',
          weightKg: 93.33,
          recordedAt: logPlan.at.toISOString(),
          deltaKg: 11.66,
        },
      ]);
      expect(sqlOf().some((s) => s.includes('one_rep_max'))).toBe(false);
    });

    it("scopes one exercise's sessions and 1RM series the same way", async () => {
      const out = await service.exerciseHistoryForCoach(
        'coach-1',
        'client-1',
        BENCH,
      );

      expect(out.sessions.map((s) => s.workoutLogId)).toEqual([
        'log-plan',
        'log-plan-old',
      ]);
      expect(out.oneRepMaxSeries).toEqual([
        {
          weightKg: 81.67,
          recordedAt: logPlanOld.at,
          source: 'ESTIMATED_EPLEY',
        },
        { weightKg: 93.33, recordedAt: logPlan.at, source: 'ESTIMATED_EPLEY' },
      ]);
      expect(sqlOf().some((s) => s.includes('one_rep_max'))).toBe(false);
    });

    it('shows a coach who assigned nothing an empty screen', async () => {
      assignments = assignments.filter((a) => a.instructorId !== 'coach-1');

      const out = await service.overviewForCoach(
        'coach-1',
        'client-1',
        ProgressRange.Year,
      );

      expect(out.totals).toEqual({
        workouts: 0,
        volumeKg: 0,
        setsCompleted: 0,
        trainingSeconds: 0,
      });
      expect(out.lifetimeWorkouts).toBe(0);
      expect(out.records).toEqual([]);
      expect(out.streak).toEqual({ currentWeeks: 0, bestWeeks: 0 });
      // `IN ()` is not valid SQL; with no plans of their own, the coach
      // is down to what the client shared, which here is nothing.
      expect(sqlOf().some((s) => s.includes('IN (:assignmentIds)'))).toBe(
        false,
      );
      expect(
        sqlOf().every((s) =>
          s.includes("visibility IN ('COACHES_ONLY', 'PUBLIC')"),
        ),
      ).toBe(true);
    });

    it('shows the other coach only their own plan', async () => {
      const out = await service.overviewForCoach(
        'coach-2',
        'client-1',
        ProgressRange.FourWeeks,
      );
      expect(out.lifetimeWorkouts).toBe(1);
      expect(out.records.map((r) => r.weightKg)).toEqual([105]);
    });
  });

  // ─── a client who shares a workout ────────────────────────────────

  describe('when the client shares a workout', () => {
    beforeEach(() => {
      logById('log-free').visibility = 'COACHES_ONLY';
    });

    it('counts it for each of their coaches, and nothing they kept private', async () => {
      const one = await service.overviewForCoach(
        'coach-1',
        'client-1',
        ProgressRange.TwelveWeeks,
        'en',
      );
      const two = await service.overviewForCoach(
        'coach-2',
        'client-1',
        ProgressRange.TwelveWeeks,
        'en',
      );
      // coach-1: their two plan workouts and the shared freestyle one;
      // coach-2's plan stays out. coach-2: their own plan and the shared one.
      expect(one.lifetimeWorkouts).toBe(3);
      expect(two.lifetimeWorkouts).toBe(2);
    });

    it('puts the shared session in the exercise history too', async () => {
      const history = await service.exerciseHistoryForCoach(
        'coach-1',
        'client-1',
        BENCH,
      );
      expect(history.sessions.map((x) => x.workoutLogId)).toContain('log-free');
      expect(history.sessions.map((x) => x.workoutLogId)).not.toContain(
        'log-other',
      );
    });

    it('no longer reads the old share_off_plan flag', async () => {
      logById('log-free').visibility = 'ONLY_ME';
      assignments[0].shareOffPlan = true;

      const one = await service.overviewForCoach(
        'coach-1',
        'client-1',
        ProgressRange.TwelveWeeks,
        'en',
      );
      expect(one.lifetimeWorkouts).toBe(2);
    });
  });

  // ─── the trainee themselves ───────────────────────────────────────

  describe("the trainee's own Progress", () => {
    it('is unscoped: every log, records from one_rep_max', async () => {
      const out = await service.overview(
        'client-1',
        ProgressRange.FourWeeks,
        'en',
      );

      expect(out.totals.workouts).toBe(4);
      expect(out.lifetimeWorkouts).toBe(4);
      expect(out.records).toEqual([
        {
          exerciseId: BENCH,
          exerciseName: 'Bench press',
          weightKg: 120,
          recordedAt: storedOneRepMaxes[4].recordedAt.toISOString(),
          deltaKg: 10,
        },
        {
          exerciseId: SQUAT,
          exerciseName: 'Back squat',
          weightKg: 140,
          recordedAt: logFree.at.toISOString(),
          deltaKg: 140,
        },
      ]);

      // No coach machinery and no scope anywhere in the SQL.
      expect(instructorClientModel.findOne).not.toHaveBeenCalled();
      expect(assignmentModel.findAll).not.toHaveBeenCalled();
      for (const [sql, opts] of query.mock.calls) {
        expect(sql).not.toMatch(/assignmentIds|AND FALSE/);
        expect(opts.replacements).not.toHaveProperty('assignmentIds');
      }
    });

    it('keeps the stored 1RM series in the exercise history', async () => {
      const out = await service.exerciseHistory('client-1', BENCH);
      expect(out.sessions).toHaveLength(4);
      expect(out.oneRepMaxSeries.map((p) => p.weightKg)).toEqual([
        81.67, 105, 110, 120,
      ]);
      expect(out.oneRepMaxSeries.at(-1)?.source).toBe('MANUAL');
    });
  });
});
