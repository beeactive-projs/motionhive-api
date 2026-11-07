import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { DEFAULT_LOCALE, apiError, type Locale } from '../../common/i18n';
import { Exercise } from '../exercise/entities/exercise.entity';
import { CoachAccessService } from '../workout/coach-access.service';
import { OneRepMaxSource } from '../workout/entities/workout.enums';
import { estimateOneRepMaxEpley } from '../workout/one-rep-max.estimate';
import { streakFromWeeks } from '../workout/training-streak';
import {
  COUNTED_SET_SQL,
  NO_VOLUME,
  VOLUME_SUMS_SQL,
  type VolumeSumsRow,
  type VolumeUnit,
  addVolume,
  volumeIn,
  volumeTotalsFromRow,
  volumeUnitFor,
} from '../workout/volume';
import { ProgressRange } from './dto/progress-range.enum';
import { RosterWindow } from './dto/roster.query.dto';

/** How far back each range window reaches, in days. */
const RANGE_DAYS: Record<ProgressRange, number> = {
  [ProgressRange.FourWeeks]: 28,
  [ProgressRange.TwelveWeeks]: 84,
  [ProgressRange.Year]: 365,
};

export interface ProgressOverview {
  range: ProgressRange;
  totals: {
    workouts: number;
    volumeKg: number;
    setsCompleted: number;
    trainingSeconds: number;
  };
  /** Same metrics for the preceding window, so the UI can show movement. */
  previous: { workouts: number; volumeKg: number };
  streak: { currentWeeks: number; bestWeeks: number };
  /**
   * Oldest first. One entry per ISO week of the window that has a
   * workout (weeks without one are left out). Volume excludes warm-ups;
   * minutes are the workouts' recorded durations.
   */
  weeklyVolume: Array<{
    weekStart: string;
    volumeKg: number;
    workouts: number;
    minutes: number;
  }>;
  /** Oldest first, one per day, for the consistency grid. */
  dailyActivity: Array<{ date: string; workouts: number }>;
  records: Array<{
    exerciseId: string;
    exerciseName: string;
    weightKg: number;
    recordedAt: string;
    /** Improvement on the previous best; equals weight for a first-ever. */
    deltaKg: number;
  }>;
  /** Lifetime, not windowed — used to pick the empty/near-empty state. */
  lifetimeWorkouts: number;
}

/** `GET /progress/exercises/:id` and its coach twin. */
export interface ExerciseHistory {
  exercise: Exercise;
  /** Oldest first so the sparkline reads left to right. */
  oneRepMaxSeries: Array<{
    weightKg: number;
    recordedAt: Date;
    source: string;
  }>;
  /** Newest first, capped at 100. */
  sessions: Array<{
    workoutLogId: string;
    performedAt: Date;
    workoutName: string;
    setCount: number;
    topWeightKg: number | null;
    topReps: number | null;
    bestDurationSeconds: number | null;
    bestDistanceMeters: number | null;
    /**
     * The session's volume over its completed sets, warm-ups excluded,
     * in `volumeUnit`: kg × reps for a loaded exercise, total reps for a
     * bodyweight one, total seconds for a hold, total metres for a
     * distance. The unit is chosen once for the exercise (its kind, then
     * what its sessions filled), so every session is in the same one.
     */
    volume: number;
    volumeUnit: VolumeUnit;
  }>;
}

/**
 * One exercise the person has trained, for the Progress list: what it is,
 * how often, and the top set of its latest sessions (newest first, up to
 * TRAINED_RECENT_SESSIONS) so the app can draw its trend.
 */
export interface TrainedExercise {
  exerciseId: string;
  exerciseName: string;
  kind: string;
  sessionCount: number;
  lastPerformedAt: Date;
  recent: Array<{
    workoutLogId: string;
    performedAt: Date;
    topWeightKg: number | null;
    topReps: number | null;
    bestDurationSeconds: number | null;
    bestDistanceMeters: number | null;
  }>;
}

/** Sessions per exercise the Progress list draws its trend from. */
const TRAINED_RECENT_SESSIONS = 6;

/**
 * Whose logs a progress read covers, and which of them.
 *
 *   assignmentIds === null → every completed log of `userId`: the
 *     trainee reading their own progress.
 *   assignmentIds = [...]  → a coach: logs started from one of these
 *     assignments (their own plans), plus any the client set to
 *     COACHES_ONLY or PUBLIC. Everything else (private freestyle,
 *     self-scheduled plans, other coaches' plans) stays out.
 *
 * The rule is CoachAccessService's (`isReadableByCoach`), the same one
 * the coach's log history uses, so the numbers and the logs behind them
 * cannot disagree.
 */
interface LogScope {
  userId: string;
  assignmentIds: string[] | null;
}

/** One point of an estimated-1RM progression. */
interface OneRepMaxPoint {
  weightKg: number;
  recordedAt: Date;
}

/** How many recent records the overview shows. */
const RECENT_RECORDS_LIMIT = 10;

/** How far back the coach's activity feed reaches, in days. */
const ACTIVITY_DAYS = 14;

// ── Coach reads across clients ───────────────────────────────────────
// SQL pieces the roster and the activity feed share, so "who", "may the
// coach read it" and "was it a record" mean the same in both. Each binds
// `:instructorId`; the one-client form binds `:clientId` too.

/** The coach's ACTIVE clients, or the one a page asks about. */
function coachClientsCte(oneClient: boolean): string {
  return `
      clients AS (
        SELECT ic.client_id
        FROM instructor_client ic
        -- A deleted account is off the roster, so off its totals too.
        JOIN "user" u ON u.id = ic.client_id AND u.deleted_at IS NULL
        WHERE ic.instructor_id = :instructorId
          AND ic.status = 'ACTIVE'
          ${oneClient ? 'AND ic.client_id = :clientId' : ''}
      )`;
}

/**
 * `isReadableByCoach` on a workout_log alias: one from the coach's own
 * plans, or one the client shared with coaches. `alias` is always a
 * literal from this file, never input.
 */
function readableByCoach(alias: string): string {
  return `(
            ${alias}.visibility IN ('COACHES_ONLY', 'PUBLIC')
            OR ${alias}.program_assignment_id IN (
              SELECT pa.id
              FROM program_assignment pa
              WHERE pa.instructor_id = :instructorId
                AND pa.deleted_at IS NULL
            )
          )`;
}

/**
 * The clients' estimated-1RM rows that beat an earlier one. A first time
 * on an exercise beat nothing, so it is no record: History's rule
 * (`WorkoutLogService._countSessionPrs`), in SQL.
 */
const CLIENT_RECORDS_CTE = `
      records AS (
        SELECT x.user_id, x.recorded_at
        FROM (
          SELECT
            orm.user_id,
            orm.source,
            orm.recorded_at,
            MIN(orm.recorded_at) OVER (
              PARTITION BY orm.user_id, orm.exercise_id
            ) AS first_at
          FROM one_rep_max orm
          WHERE orm.user_id IN (SELECT client_id FROM clients)
        ) x
        WHERE x.source = 'ESTIMATED_EPLEY'
          AND x.recorded_at > x.first_at
      )`;

/** Records set inside one workout, from `records`, as History counts them. */
function sessionRecords(alias: string): string {
  return `(
          SELECT COUNT(*)
          FROM records r
          WHERE r.user_id = ${alias}.user_id
            AND r.recorded_at BETWEEN ${alias}.started_at AND ${alias}.completed_at
        )`;
}

export interface RosterClient {
  clientId: string;
  name: string;
  avatarUrl: string | null;
  handle: string | null;
  /** Assigned workouts due in the window, and how many were completed. */
  due: number;
  completed: number;
  skipped: number;
  /** 0-100. Null when nothing was due, which is not the same as 0%. */
  adherencePercent: number | null;
  /** Same figure for the preceding window, for the drop signal. */
  previousAdherencePercent: number | null;
  lastWorkoutAt: string | null;
  daysSinceLastWorkout: number | null;
  activePlans: number;
  /**
   * Why this client needs looking at, or null when they don't:
   *   NO_PLAN       — no active plan at all, so nothing is being asked of them
   *   NEVER_STARTED — assigned work, nothing ever logged
   *   SILENT        — no workout in 14+ days
   *   DROPPED       — adherence fell 20+ points against the prior window
   *   BEHIND        — under half the work due in the window
   */
  attention:
    | 'NO_PLAN'
    | 'NEVER_STARTED'
    | 'SILENT'
    | 'DROPPED'
    | 'BEHIND'
    | null;
}

export interface RosterSummary {
  window: string;
  clients: RosterClient[];
  totals: {
    clients: number;
    needsAttention: number;
    /** Mean adherence across clients who had work due. */
    adherencePercent: number | null;
    /**
     * Finished workouts the coach may read, in the window and in the one
     * before it, planned or the client's own.
     */
    workouts: number;
    previousWorkouts: number;
    /** Records set in the window's workouts. */
    records: number;
  };
}

/** One finished workout in the coach's activity feed. */
export interface CoachActivityItem {
  workoutLogId: string;
  clientId: string;
  name: string;
  avatarUrl: string | null;
  handle: string | null;
  workoutName: string;
  completedAt: string;
  durationSeconds: number | null;
  recordCount: number;
}

/**
 * ProgressService — the client's "am I improving" surface.
 *
 * Everything here is derived. No new tables: volume and consistency are
 * aggregates over `workout_log` + `logged_set`, and records come from
 * `one_rep_max`, which the completion flow already writes.
 *
 * **Volume rule.** Volume is Σ(reps × weight) over completed sets that
 * carry a load and are not warm-ups (`workout/volume.ts`, the one
 * definition). Bodyweight and cardio sets have no weight, so they
 * contribute nothing to the kilograms rather than zero-inflating the
 * number. That keeps the figure comparable week to week, which is the
 * only thing it is for. Sets are counted separately so a bodyweight-only
 * week still shows work. One exercise's history is the exception: there
 * its volume is in the exercise's own unit (reps, seconds, metres).
 */
@Injectable()
export class ProgressService {
  constructor(
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
    private readonly coachAccess: CoachAccessService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async overview(
    userId: string,
    range: ProgressRange,
    /** The reader's language, for the exercise names of recent records. */
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<ProgressOverview> {
    return this._overview({ userId, assignmentIds: null }, range, locale);
  }

  /**
   * A coach reading one client's overview: the trainee's own screen,
   * computed over only the logs this coach may read. 404 unless the
   * caller is the client's ACTIVE coach.
   */
  async overviewForCoach(
    instructorId: string,
    clientId: string,
    range: ProgressRange,
    /** The coach's language, for the exercise names of recent records. */
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<ProgressOverview> {
    const scope = await this._coachScope(instructorId, clientId);
    return this._overview(scope, range, locale);
  }

  /**
   * Every session of one exercise, newest first, with the top set of
   * each. This is where the stored 1RM history pays off.
   */
  async exerciseHistory(
    userId: string,
    exerciseId: string,
  ): Promise<ExerciseHistory> {
    return this._exerciseHistory({ userId, assignmentIds: null }, exerciseId);
  }

  /**
   * A coach reading one client's history for one exercise, scoped like
   * `overviewForCoach`. The relationship is checked before the exercise,
   * so a stranger learns nothing from the exercise id either.
   */
  async exerciseHistoryForCoach(
    instructorId: string,
    clientId: string,
    exerciseId: string,
  ): Promise<ExerciseHistory> {
    const scope = await this._coachScope(instructorId, clientId);
    return this._exerciseHistory(scope, exerciseId);
  }

  /**
   * Every exercise the caller has trained, most recently trained first:
   * the Progress tab's list, which lifts, holds and runs alike, where the
   * records list only had exercises with a weight.
   */
  async trainedExercises(
    userId: string,
    locale: Locale,
  ): Promise<TrainedExercise[]> {
    return this._trainedExercises({ userId, assignmentIds: null }, locale);
  }

  /** The same list for a coach, scoped like `overviewForCoach`. */
  async trainedExercisesForCoach(
    instructorId: string,
    clientId: string,
    locale: Locale,
  ): Promise<TrainedExercise[]> {
    const scope = await this._coachScope(instructorId, clientId);
    return this._trainedExercises(scope, locale);
  }

  private async _coachScope(
    instructorId: string,
    clientId: string,
  ): Promise<LogScope> {
    return {
      userId: clientId,
      assignmentIds: await this.coachAccess.readableAssignmentIds(
        instructorId,
        clientId,
      ),
    };
  }

  private async _overview(
    scope: LogScope,
    range: ProgressRange,
    locale: Locale,
  ): Promise<ProgressOverview> {
    const days = RANGE_DAYS[range];

    const [totals, previous, weekly, daily, records, lifetime, weeks] =
      await Promise.all([
        this._totals(scope, days, 0),
        this._totals(scope, days, days),
        this._weeklyVolume(scope, days),
        this._dailyActivity(scope, days),
        // A restricted coach gets records rebuilt from the logs they may
        // read; see `_derivedOneRepMaxSeries` for why not one_rep_max.
        scope.assignmentIds === null
          ? this._recentRecords(scope.userId, locale)
          : this._derivedRecentRecords(scope, locale),
        this._lifetimeWorkouts(scope),
        // Streaks look past the window on purpose: a 9-week run is still
        // a 9-week run when you are looking at the last 4 weeks.
        this._activeWeeks(scope),
      ]);

    return {
      range,
      totals,
      previous: { workouts: previous.workouts, volumeKg: previous.volumeKg },
      streak: streakFromWeeks(weeks),
      weeklyVolume: weekly,
      dailyActivity: daily,
      records,
      lifetimeWorkouts: lifetime,
    };
  }

  private async _exerciseHistory(
    scope: LogScope,
    exerciseId: string,
  ): Promise<ExerciseHistory> {
    // No visibility check here on purpose: the sessions below are the
    // scoped person's own logs, so a client's PRIVATE own exercise opens
    // for the coach the scope lets in. A deleted exercise (paranoid) still
    // has its history: deleting a used exercise keeps what was logged.
    const exercise = await this.exerciseModel.findByPk(exerciseId, {
      attributes: [
        'id',
        'name',
        'slug',
        'kind',
        'thumbnailUrl',
        'translations',
      ],
      paranoid: false,
    });
    if (!exercise) throw new NotFoundException(apiError('exercise.notFound'));

    const scoped = this._scopeFilter(scope, 'wl.program_assignment_id');
    const sessions = await this.sequelize.query<
      {
        workoutLogId: string;
        performedAt: Date;
        workoutName: string;
        setCount: string;
        topWeightKg: string | null;
        topReps: number | null;
        bestDurationSeconds: number | null;
        bestDistanceMeters: number | null;
      } & VolumeSumsRow
    >(
      `
      SELECT
        wl.id                                    AS "workoutLogId",
        COALESCE(wl.completed_at, wl.started_at) AS "performedAt",
        wl.name                                  AS "workoutName",
        COUNT(ls.id)                             AS "setCount",
        MAX(ls.weight_kg)                        AS "topWeightKg",
        -- Reps of the heaviest set, not the highest rep count.
        (ARRAY_AGG(ls.reps ORDER BY ls.weight_kg DESC NULLS LAST, ls.reps DESC))[1]
                                                 AS "topReps",
        MAX(ls.duration_seconds)                 AS "bestDurationSeconds",
        MAX(ls.distance_meters)                  AS "bestDistanceMeters",
        -- The volume's four sums, warm-ups out; the unit is picked below.
        ${VOLUME_SUMS_SQL}
      FROM logged_set ls
      JOIN logged_exercise le ON le.id = ls.logged_exercise_id
      JOIN workout_log wl     ON wl.id = le.workout_log_id
      WHERE wl.user_id = :userId
        AND le.exercise_id = :exerciseId
        AND ls.is_completed = TRUE
        AND wl.status = 'COMPLETED'
        ${scoped.sql}
      GROUP BY wl.id, wl.completed_at, wl.started_at, wl.name
      ORDER BY "performedAt" DESC
      LIMIT 100
      `,
      {
        replacements: { userId: scope.userId, exerciseId, ...scoped.params },
        type: QueryTypes.SELECT,
      },
    );

    // One unit for the whole history, so the chart compares like with
    // like: the exercise's kind, then what its sessions actually filled.
    const totals = sessions.map((s) => volumeTotalsFromRow(s));
    const volumeUnit = volumeUnitFor(
      exercise.kind,
      totals.reduce(addVolume, NO_VOLUME),
    );

    return {
      exercise,
      oneRepMaxSeries: await this._oneRepMaxSeries(scope, exerciseId),
      sessions: sessions.map((s, i) => ({
        workoutLogId: s.workoutLogId,
        performedAt: s.performedAt,
        workoutName: s.workoutName,
        setCount: Number(s.setCount),
        topWeightKg: s.topWeightKg == null ? null : Number(s.topWeightKg),
        topReps: s.topReps,
        bestDurationSeconds: s.bestDurationSeconds,
        bestDistanceMeters: s.bestDistanceMeters,
        volume: volumeIn(volumeUnit, totals[i]),
        volumeUnit,
      })),
    };
  }

  /**
   * One row per exercise from the per-session top sets (the same top set
   * `_exerciseHistory` names: the heaviest set's reps, the longest hold,
   * the furthest distance), keeping each exercise's latest sessions.
   */
  private async _trainedExercises(
    scope: LogScope,
    locale: Locale,
  ): Promise<TrainedExercise[]> {
    const scoped = this._scopeFilter(scope, 'wl.program_assignment_id');
    const rows = await this.sequelize.query<{
      exerciseId: string;
      exerciseName: string;
      kind: string;
      sessionCount: string;
      lastPerformedAt: Date;
      recent: Array<{
        workoutLogId: string;
        performedAt: string;
        topWeightKg: string | number | null;
        topReps: number | null;
        bestDurationSeconds: number | null;
        bestDistanceMeters: number | null;
      }>;
    }>(
      `
      WITH sessions AS (
        SELECT
          le.exercise_id,
          wl.id                                    AS workout_log_id,
          COALESCE(wl.completed_at, wl.started_at) AS performed_at,
          MAX(ls.weight_kg)                        AS top_weight_kg,
          (ARRAY_AGG(ls.reps ORDER BY ls.weight_kg DESC NULLS LAST, ls.reps DESC))[1]
                                                   AS top_reps,
          MAX(ls.duration_seconds)                 AS best_duration_seconds,
          MAX(ls.distance_meters)                  AS best_distance_meters
        FROM logged_set ls
        JOIN logged_exercise le ON le.id = ls.logged_exercise_id
        JOIN workout_log wl     ON wl.id = le.workout_log_id
        WHERE wl.user_id = :userId
          AND le.exercise_id IS NOT NULL
          AND ls.is_completed = TRUE
          AND wl.status = 'COMPLETED'
          ${scoped.sql}
        GROUP BY le.exercise_id, wl.id, wl.completed_at, wl.started_at
      ),
      ranked AS (
        SELECT
          s.*,
          ROW_NUMBER() OVER (PARTITION BY s.exercise_id ORDER BY s.performed_at DESC) AS rn,
          COUNT(*)     OVER (PARTITION BY s.exercise_id)                              AS session_count
        FROM sessions s
      )
      SELECT
        r.exercise_id                                         AS "exerciseId",
        COALESCE(e.translations -> :locale ->> 'name', e.name) AS "exerciseName",
        e.kind                                                AS "kind",
        r.session_count                                       AS "sessionCount",
        MAX(r.performed_at)                                   AS "lastPerformedAt",
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'workoutLogId', r.workout_log_id,
            'performedAt', r.performed_at,
            'topWeightKg', r.top_weight_kg,
            'topReps', r.top_reps,
            'bestDurationSeconds', r.best_duration_seconds,
            'bestDistanceMeters', r.best_distance_meters
          ) ORDER BY r.performed_at DESC
        )                                                     AS "recent"
      FROM ranked r
      JOIN exercise e ON e.id = r.exercise_id
      WHERE r.rn <= :recentSessions
      GROUP BY r.exercise_id, e.id, r.session_count
      ORDER BY "lastPerformedAt" DESC
      LIMIT 200
      `,
      {
        replacements: {
          userId: scope.userId,
          locale,
          recentSessions: TRAINED_RECENT_SESSIONS,
          ...scoped.params,
        },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      kind: row.kind,
      sessionCount: Number(row.sessionCount),
      lastPerformedAt: row.lastPerformedAt,
      recent: row.recent.map((s) => ({
        workoutLogId: s.workoutLogId,
        performedAt: new Date(s.performedAt),
        topWeightKg: s.topWeightKg == null ? null : Number(s.topWeightKg),
        topReps: s.topReps,
        bestDurationSeconds: s.bestDurationSeconds,
        bestDistanceMeters: s.bestDistanceMeters,
      })),
    }));
  }

  /**
   * The coach's morning screen: who is on track, who is slipping.
   *
   * A read-model over what the trainee surfaces already write — assigned
   * workout statuses and logs. Nothing new is captured for it, which is
   * why it needed no migration.
   *
   * Only ACTIVE coaching relationships. An archived client's data stops
   * being the coach's business the moment the relationship ends, which
   * is the same rule the log endpoints enforce.
   */
  async roster(
    instructorId: string,
    window: RosterWindow,
    today: string,
    clientId?: string,
  ): Promise<RosterSummary> {
    const days = window === RosterWindow.OneWeek ? 7 : 28;

    const rows = await this.sequelize.query<{
      clientId: string;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
      handle: string | null;
      due: string;
      completed: string;
      skipped: string;
      prevDue: string;
      prevCompleted: string;
      lastWorkoutAt: Date | null;
      activePlans: string;
    }>(
      `
      WITH ${coachClientsCte(!!clientId)},
      -- Scheduled work in the window, and in the one before it, so a
      -- drop can be detected rather than just a low number.
      windowed AS (
        SELECT
          pa.client_id,
          COUNT(*) FILTER (
            WHERE aw.scheduled_date > (:today::date - :days::int)
              AND aw.scheduled_date <= :today::date
          ) AS due,
          COUNT(*) FILTER (
            WHERE aw.scheduled_date > (:today::date - :days::int)
              AND aw.scheduled_date <= :today::date
              AND aw.status = 'COMPLETED'
          ) AS completed,
          COUNT(*) FILTER (
            WHERE aw.scheduled_date > (:today::date - :days::int)
              AND aw.scheduled_date <= :today::date
              AND aw.status = 'SKIPPED'
          ) AS skipped,
          COUNT(*) FILTER (
            WHERE aw.scheduled_date > (:today::date - (:days::int * 2))
              AND aw.scheduled_date <= (:today::date - :days::int)
          ) AS prev_due,
          COUNT(*) FILTER (
            WHERE aw.scheduled_date > (:today::date - (:days::int * 2))
              AND aw.scheduled_date <= (:today::date - :days::int)
              AND aw.status = 'COMPLETED'
          ) AS prev_completed
        FROM program_assignment pa
        JOIN assigned_workout aw ON aw.program_assignment_id = pa.id
        WHERE pa.instructor_id = :instructorId
          AND pa.client_id IN (SELECT client_id FROM clients)
          AND pa.deleted_at IS NULL
          -- Both windows and nothing older: every count above is inside it.
          AND aw.scheduled_date > (:today::date - (:days::int * 2))
          AND aw.scheduled_date <= :today::date
        GROUP BY pa.client_id
      ),
      -- Only these clients' logs: unscoped, this took the latest workout
      -- of every person on the platform on each read.
      -- And only the workouts the coach may read (\`isReadableByCoach\`):
      -- one from their own plans, or one the client shared with coaches.
      -- A private workout must not date "last workout" or count as
      -- training on the coach's Home.
      last_seen AS (
        SELECT wl.user_id, MAX(COALESCE(wl.completed_at, wl.started_at)) AS last_at
        FROM workout_log wl
        WHERE wl.status = 'COMPLETED'
          AND wl.user_id IN (SELECT client_id FROM clients)
          AND ${readableByCoach('wl')}
        GROUP BY wl.user_id
      ),
      plan_counts AS (
        SELECT client_id, COUNT(*) AS active_plans
        FROM program_assignment
        WHERE instructor_id = :instructorId
          AND deleted_at IS NULL
          AND status = 'ACTIVE'
        GROUP BY client_id
      )
      SELECT
        c.client_id                        AS "clientId",
        u.first_name                       AS "firstName",
        u.last_name                        AS "lastName",
        u.avatar_url                       AS "avatarUrl",
        u.handle                           AS "handle",
        COALESCE(w.due, 0)                 AS "due",
        COALESCE(w.completed, 0)           AS "completed",
        COALESCE(w.skipped, 0)             AS "skipped",
        COALESCE(w.prev_due, 0)            AS "prevDue",
        COALESCE(w.prev_completed, 0)      AS "prevCompleted",
        ls.last_at                         AS "lastWorkoutAt",
        COALESCE(pc.active_plans, 0)       AS "activePlans"
      FROM clients c
      JOIN "user" u       ON u.id = c.client_id
      LEFT JOIN windowed w   ON w.client_id = c.client_id
      LEFT JOIN last_seen ls ON ls.user_id = c.client_id
      LEFT JOIN plan_counts pc ON pc.client_id = c.client_id
      WHERE u.deleted_at IS NULL
      `,
      {
        replacements: {
          instructorId,
          days,
          today,
          ...(clientId ? { clientId } : {}),
        },
        type: QueryTypes.SELECT,
      },
    );

    const clients = rows.map((r) => this._toRosterClient(r, today));

    // Average only over clients who actually had work due — folding in
    // people with nothing scheduled would drag the number down for a
    // reason that has nothing to do with adherence.
    const scored = clients.filter((c) => c.adherencePercent !== null);
    const mean = scored.length
      ? Math.round(
          scored.reduce((sum, c) => sum + (c.adherencePercent ?? 0), 0) /
            scored.length,
        )
      : null;

    // Needs-attention first, then the least adherent.
    clients.sort((a, b) => {
      if (!!a.attention !== !!b.attention) return a.attention ? -1 : 1;
      return (a.adherencePercent ?? 101) - (b.adherencePercent ?? 101);
    });

    const activity = clients.length
      ? await this._rosterActivity(instructorId, days, today, clientId)
      : { workouts: 0, previousWorkouts: 0, records: 0 };

    return {
      window,
      clients,
      totals: {
        clients: clients.length,
        needsAttention: clients.filter((c) => c.attention !== null).length,
        adherencePercent: mean,
        ...activity,
      },
    };
  }

  /**
   * How much the coach's clients trained, as the coach may see it: their
   * finished workouts in the window and the one before (planned or their
   * own, under `isReadableByCoach`), and the records set in the window.
   * Days are the server's, like the roster's window.
   */
  private async _rosterActivity(
    instructorId: string,
    days: number,
    today: string,
    clientId?: string,
  ): Promise<{ workouts: number; previousWorkouts: number; records: number }> {
    const [row] = await this.sequelize.query<{
      workouts: string | null;
      previousWorkouts: string | null;
      records: string | null;
    }>(
      `
      WITH ${coachClientsCte(!!clientId)},
      ${CLIENT_RECORDS_CTE},
      logs AS (
        SELECT
          wl.user_id,
          wl.started_at,
          wl.completed_at,
          wl.completed_at::date > (:today::date - :days::int) AS in_window
        FROM workout_log wl
        WHERE wl.status = 'COMPLETED'
          AND wl.completed_at IS NOT NULL
          AND wl.user_id IN (SELECT client_id FROM clients)
          AND ${readableByCoach('wl')}
          AND wl.completed_at::date > (:today::date - (:days::int * 2))
          AND wl.completed_at::date <= :today::date
      )
      SELECT
        COUNT(*) FILTER (WHERE in_window)     AS "workouts",
        COUNT(*) FILTER (WHERE NOT in_window) AS "previousWorkouts",
        COALESCE(SUM(${sessionRecords('logs')}) FILTER (WHERE in_window), 0) AS "records"
      FROM logs
      `,
      {
        replacements: {
          instructorId,
          days,
          today,
          ...(clientId ? { clientId } : {}),
        },
        type: QueryTypes.SELECT,
      },
    );

    return {
      workouts: Number(row?.workouts ?? 0),
      previousWorkouts: Number(row?.previousWorkouts ?? 0),
      records: Number(row?.records ?? 0),
    };
  }

  /**
   * The coach Home's "Hive activity": their clients' latest finished
   * workouts across everyone, newest first, each with the records it set.
   * Only ACTIVE relationships and only what the coach may read
   * (`isReadableByCoach`), so a private workout never appears here even as
   * a line. Bounded to the last two weeks: older news is the client page's.
   */
  async activity(
    instructorId: string,
    limit: number,
  ): Promise<CoachActivityItem[]> {
    const rows = await this.sequelize.query<{
      workoutLogId: string;
      clientId: string;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
      handle: string | null;
      workoutName: string;
      completedAt: Date;
      durationSeconds: number | null;
      recordCount: string;
    }>(
      `
      WITH ${coachClientsCte(false)},
      ${CLIENT_RECORDS_CTE}
      SELECT
        wl.id               AS "workoutLogId",
        wl.user_id          AS "clientId",
        u.first_name        AS "firstName",
        u.last_name         AS "lastName",
        u.avatar_url        AS "avatarUrl",
        u.handle            AS "handle",
        wl.name             AS "workoutName",
        wl.completed_at     AS "completedAt",
        wl.duration_seconds AS "durationSeconds",
        ${sessionRecords('wl')} AS "recordCount"
      FROM workout_log wl
      JOIN "user" u ON u.id = wl.user_id
      WHERE wl.status = 'COMPLETED'
        AND wl.completed_at IS NOT NULL
        AND wl.completed_at >= NOW() - (:activityDays || ' days')::INTERVAL
        AND wl.user_id IN (SELECT client_id FROM clients)
        AND u.deleted_at IS NULL
        AND ${readableByCoach('wl')}
      ORDER BY wl.completed_at DESC
      LIMIT :limit
      `,
      {
        replacements: { instructorId, limit, activityDays: ACTIVITY_DAYS },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((r) => ({
      workoutLogId: r.workoutLogId,
      clientId: r.clientId,
      name:
        [r.firstName, r.lastName].filter(Boolean).join(' ') ||
        r.handle ||
        'Client',
      avatarUrl: r.avatarUrl,
      handle: r.handle,
      workoutName: r.workoutName,
      completedAt: new Date(r.completedAt).toISOString(),
      durationSeconds: r.durationSeconds,
      recordCount: Number(r.recordCount),
    }));
  }

  private _toRosterClient(
    r: {
      clientId: string;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
      handle: string | null;
      due: string;
      completed: string;
      skipped: string;
      prevDue: string;
      prevCompleted: string;
      lastWorkoutAt: Date | null;
      activePlans: string;
    },
    today: string,
  ): RosterClient {
    const due = Number(r.due);
    const completed = Number(r.completed);
    const prevDue = Number(r.prevDue);
    const prevCompleted = Number(r.prevCompleted);
    const activePlans = Number(r.activePlans);

    // Nothing due is not 0% — it means the question doesn't apply.
    const adherencePercent =
      due > 0 ? Math.round((completed / due) * 100) : null;
    const previousAdherencePercent =
      prevDue > 0 ? Math.round((prevCompleted / prevDue) * 100) : null;

    // Measured from the end of today, not its start: a workout logged
    // this afternoon is "0 days ago", not "-1".
    const daysSince =
      r.lastWorkoutAt == null
        ? null
        : Math.max(
            0,
            Math.floor(
              (new Date(`${today}T23:59:59Z`).getTime() -
                new Date(r.lastWorkoutAt).getTime()) /
                86_400_000,
            ),
          );

    return {
      clientId: r.clientId,
      name:
        [r.firstName, r.lastName].filter(Boolean).join(' ') ||
        r.handle ||
        'Client',
      avatarUrl: r.avatarUrl,
      handle: r.handle,
      due,
      completed,
      skipped: Number(r.skipped),
      adherencePercent,
      previousAdherencePercent,
      lastWorkoutAt: r.lastWorkoutAt ? r.lastWorkoutAt.toISOString() : null,
      daysSinceLastWorkout: daysSince,
      activePlans,
      attention: this._attentionReason({
        activePlans,
        lastWorkoutAt: r.lastWorkoutAt,
        daysSince,
        adherencePercent,
        previousAdherencePercent,
      }),
    };
  }

  /**
   * One reason, most urgent first, so the UI has something to say
   * rather than a bare flag. Ordering is deliberate: having no plan
   * outranks never-started, which outranks silent, which outranks a
   * drop, which outranks merely being behind.
   */
  private _attentionReason(input: {
    activePlans: number;
    lastWorkoutAt: Date | null;
    daysSince: number | null;
    adherencePercent: number | null;
    previousAdherencePercent: number | null;
  }): RosterClient['attention'] {
    // Someone with no active plan has nothing to be behind on — but that is
    // the coach's omission, not the client being fine. Returning null here
    // sorted them into "On track" beside people who are actually training.
    if (input.activePlans === 0) return 'NO_PLAN';

    if (input.lastWorkoutAt == null) return 'NEVER_STARTED';
    if ((input.daysSince ?? 0) >= 14) return 'SILENT';

    const now = input.adherencePercent;
    const before = input.previousAdherencePercent;
    if (now != null && before != null && before - now >= 20) return 'DROPPED';
    if (now != null && now < 50) return 'BEHIND';
    return null;
  }

  // ── Internals ────────────────────────────────────────────────────

  /**
   * The scope as a WHERE fragment on the given workout_log column, plus
   * the replacements it binds. Empty for an unrestricted read, so the
   * trainee's own queries run unfiltered exactly as before. An empty
   * allow-list matches nothing: a coach who assigned nothing has nothing
   * to see, and `IN ()` is not valid SQL anyway.
   *
   * `column` is always a literal from this file, never input.
   */
  private _scopeFilter(
    scope: LogScope,
    column: string,
  ): { sql: string; params: { assignmentIds?: string[] } } {
    if (scope.assignmentIds === null) return { sql: '', params: {} };
    // The visibility column sits on the same table as the assignment one.
    // Named levels, as in `isReadableByCoach`: private unless shared.
    const visibility = column.replace(/program_assignment_id$/, 'visibility');
    const shared = `${visibility} IN ('COACHES_ONLY', 'PUBLIC')`;
    if (scope.assignmentIds.length === 0) {
      return { sql: `AND ${shared}`, params: {} };
    }
    return {
      sql: `AND (${column} IN (:assignmentIds) OR ${shared})`,
      params: { assignmentIds: scope.assignmentIds },
    };
  }

  /** `offsetDays` shifts the window back, for period-on-period deltas. */
  private async _totals(scope: LogScope, days: number, offsetDays: number) {
    const scoped = this._scopeFilter(scope, 'program_assignment_id');
    const [row] = await this.sequelize.query<{
      workouts: string;
      volumeKg: string | null;
      setsCompleted: string;
      trainingSeconds: string | null;
    }>(
      `
      WITH windowed AS (
        SELECT id, duration_seconds
        FROM workout_log
        WHERE user_id = :userId
          AND status = 'COMPLETED'
          AND COALESCE(completed_at, started_at) >= NOW() - (:fromDays || ' days')::INTERVAL
          AND COALESCE(completed_at, started_at) <  NOW() - (:toDays || ' days')::INTERVAL
          ${scoped.sql}
      ),
      sets AS (
        SELECT
          -- Load-bearing working sets only; see the volume rule on this class.
          COALESCE(SUM(ls.reps * ls.weight_kg)
                   FILTER (WHERE ls.weight_kg IS NOT NULL
                             AND ls.set_type <> 'WARMUP'), 0) AS volume_kg,
          COUNT(ls.id)                                         AS sets_completed
        FROM windowed w
        JOIN logged_exercise le ON le.workout_log_id = w.id AND le.is_skipped = FALSE
        JOIN logged_set ls      ON ls.logged_exercise_id = le.id AND ls.is_completed = TRUE
      )
      SELECT
        (SELECT COUNT(*) FROM windowed)                              AS "workouts",
        (SELECT COALESCE(SUM(duration_seconds), 0) FROM windowed)    AS "trainingSeconds",
        (SELECT volume_kg FROM sets)                                 AS "volumeKg",
        (SELECT sets_completed FROM sets)                            AS "setsCompleted"
      `,
      {
        replacements: {
          userId: scope.userId,
          fromDays: days + offsetDays,
          toDays: offsetDays,
          ...scoped.params,
        },
        type: QueryTypes.SELECT,
      },
    );

    return {
      workouts: Number(row?.workouts ?? 0),
      volumeKg: Math.round(Number(row?.volumeKg ?? 0)),
      setsCompleted: Number(row?.setsCompleted ?? 0),
      trainingSeconds: Number(row?.trainingSeconds ?? 0),
    };
  }

  /**
   * Per ISO week: the workouts, their volume (working sets, see the
   * volume rule) and their recorded time. The volume is summed per log
   * first, so joining the sets cannot multiply a workout's duration.
   */
  private async _weeklyVolume(scope: LogScope, days: number) {
    const scoped = this._scopeFilter(scope, 'wl.program_assignment_id');
    const rows = await this.sequelize.query<{
      weekStart: Date;
      volumeKg: string | null;
      workouts: string;
      weekSeconds: string | null;
    }>(
      `
      WITH logs AS (
        SELECT
          wl.id,
          wl.duration_seconds,
          DATE_TRUNC('week', COALESCE(wl.completed_at, wl.started_at))::DATE AS week_start
        FROM workout_log wl
        WHERE wl.user_id = :userId
          AND wl.status = 'COMPLETED'
          AND COALESCE(wl.completed_at, wl.started_at) >= NOW() - (:days || ' days')::INTERVAL
          ${scoped.sql}
      ),
      log_volume AS (
        SELECT le.workout_log_id, SUM(ls.reps * ls.weight_kg) AS volume_kg
        FROM logs l
        JOIN logged_exercise le ON le.workout_log_id = l.id AND le.is_skipped = FALSE
        JOIN logged_set ls      ON ls.logged_exercise_id = le.id
        WHERE ${COUNTED_SET_SQL}
          AND ls.weight_kg IS NOT NULL
        GROUP BY le.workout_log_id
      )
      SELECT
        l.week_start                              AS "weekStart",
        COALESCE(SUM(v.volume_kg), 0)             AS "volumeKg",
        COUNT(*)                                  AS "workouts",
        COALESCE(SUM(l.duration_seconds), 0)      AS "weekSeconds"
      FROM logs l
      LEFT JOIN log_volume v ON v.workout_log_id = l.id
      GROUP BY l.week_start
      ORDER BY l.week_start ASC
      `,
      {
        replacements: { userId: scope.userId, days, ...scoped.params },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((r) => ({
      weekStart: this._isoDate(r.weekStart),
      volumeKg: Math.round(Number(r.volumeKg ?? 0)),
      workouts: Number(r.workouts),
      minutes: Math.round(Number(r.weekSeconds ?? 0) / 60),
    }));
  }

  private async _dailyActivity(scope: LogScope, days: number) {
    const scoped = this._scopeFilter(scope, 'program_assignment_id');
    const rows = await this.sequelize.query<{ day: Date; workouts: string }>(
      `
      SELECT
        COALESCE(completed_at, started_at)::DATE AS "day",
        COUNT(*)                                AS "workouts"
      FROM workout_log
      WHERE user_id = :userId
        AND status = 'COMPLETED'
        AND COALESCE(completed_at, started_at) >= NOW() - (:days || ' days')::INTERVAL
        ${scoped.sql}
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      {
        replacements: { userId: scope.userId, days, ...scoped.params },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((r) => ({
      date: this._isoDate(r.day),
      workouts: Number(r.workouts),
    }));
  }

  /** Distinct ISO weeks with at least one completed workout, newest first. */
  private async _activeWeeks(scope: LogScope): Promise<string[]> {
    const scoped = this._scopeFilter(scope, 'program_assignment_id');
    const rows = await this.sequelize.query<{ weekStart: Date }>(
      `
      SELECT DISTINCT
        DATE_TRUNC('week', COALESCE(completed_at, started_at))::DATE AS "weekStart"
      FROM workout_log
      WHERE user_id = :userId AND status = 'COMPLETED'
        ${scoped.sql}
      ORDER BY 1 DESC
      `,
      {
        replacements: { userId: scope.userId, ...scoped.params },
        type: QueryTypes.SELECT,
      },
    );
    return rows.map((r) => this._isoDate(r.weekStart));
  }

  private async _lifetimeWorkouts(scope: LogScope): Promise<number> {
    const scoped = this._scopeFilter(scope, 'program_assignment_id');
    const [row] = await this.sequelize.query<{ total: string }>(
      `SELECT COUNT(*) AS "total" FROM workout_log
       WHERE user_id = :userId AND status = 'COMPLETED'
       ${scoped.sql}`,
      {
        replacements: { userId: scope.userId, ...scoped.params },
        type: QueryTypes.SELECT,
      },
    );
    return Number(row?.total ?? 0);
  }

  /**
   * Latest estimated 1RM per exercise, with the improvement on the
   * previous one. Records are the payoff, so they are never windowed.
   */
  private async _recentRecords(userId: string, locale: Locale) {
    const rows = await this.sequelize.query<{
      exerciseId: string;
      exerciseName: string;
      weightKg: string;
      recordedAt: Date;
      priorKg: string | null;
    }>(
      `
      WITH ranked AS (
        SELECT
          orm.exercise_id,
          orm.weight_kg,
          orm.recorded_at,
          LAG(orm.weight_kg) OVER (
            PARTITION BY orm.exercise_id ORDER BY orm.recorded_at ASC
          ) AS prior_kg,
          ROW_NUMBER() OVER (
            PARTITION BY orm.exercise_id ORDER BY orm.recorded_at DESC
          ) AS rn
        FROM one_rep_max orm
        WHERE orm.user_id = :userId
      )
      SELECT
        r.exercise_id  AS "exerciseId",
        COALESCE(e.translations -> :locale ->> 'name', e.name)
                       AS "exerciseName",
        r.weight_kg    AS "weightKg",
        r.recorded_at  AS "recordedAt",
        r.prior_kg     AS "priorKg"
      FROM ranked r
      JOIN exercise e ON e.id = r.exercise_id
      WHERE r.rn = 1
      ORDER BY r.recorded_at DESC
      LIMIT :limit
      `,
      {
        replacements: { userId, locale, limit: RECENT_RECORDS_LIMIT },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((r) =>
      this._toRecord(
        r.exerciseId,
        r.exerciseName,
        Number(r.weightKg),
        r.recordedAt,
        r.priorKg == null ? null : Number(r.priorKg),
      ),
    );
  }

  private _toRecord(
    exerciseId: string,
    exerciseName: string,
    weightKg: number,
    recordedAt: Date,
    priorKg: number | null,
  ): ProgressOverview['records'][number] {
    return {
      exerciseId,
      exerciseName,
      weightKg,
      recordedAt: recordedAt.toISOString(),
      // A first-ever lift is a record in full, not an improvement of 0.
      deltaKg:
        priorKg == null
          ? weightKg
          : Math.round((weightKg - priorKg) * 100) / 100,
    };
  }

  /**
   * 1RM history for one exercise, oldest first so the sparkline reads
   * left to right. The stored history for an unrestricted read; for a
   * restricted coach, the progression rebuilt from visible logs (see
   * `_derivedOneRepMaxSeries`).
   */
  private async _oneRepMaxSeries(
    scope: LogScope,
    exerciseId: string,
  ): Promise<ExerciseHistory['oneRepMaxSeries']> {
    if (scope.assignmentIds !== null) {
      const derived = await this._derivedOneRepMaxSeries(scope, exerciseId);
      return (derived.get(exerciseId) ?? []).map((p) => ({
        weightKg: p.weightKg,
        recordedAt: p.recordedAt,
        // Rebuilt the way the completion flow writes its rows.
        source: OneRepMaxSource.EstimatedEpley,
      }));
    }

    const rows = await this.sequelize.query<{
      weightKg: string;
      recordedAt: Date;
      source: string;
    }>(
      `
      SELECT weight_kg AS "weightKg", recorded_at AS "recordedAt", source
      FROM one_rep_max
      WHERE user_id = :userId AND exercise_id = :exerciseId
      ORDER BY recorded_at ASC
      `,
      {
        replacements: { userId: scope.userId, exerciseId },
        type: QueryTypes.SELECT,
      },
    );
    return rows.map((r) => ({
      weightKg: Number(r.weightKg),
      recordedAt: r.recordedAt,
      source: r.source,
    }));
  }

  /**
   * `_recentRecords` for a restricted coach: the latest point of each
   * exercise's rebuilt progression, the improvement measured against the
   * point before it, newest first.
   */
  private async _derivedRecentRecords(scope: LogScope, locale: Locale) {
    const series = await this._derivedOneRepMaxSeries(scope);

    const latest = [...series]
      .map(([exerciseId, points]) => ({
        exerciseId,
        last: points[points.length - 1],
        priorKg: points.length > 1 ? points[points.length - 2].weightKg : null,
      }))
      .sort((a, b) => b.last.recordedAt.getTime() - a.last.recordedAt.getTime())
      .slice(0, RECENT_RECORDS_LIMIT);
    if (latest.length === 0) return [];

    const names = await this.sequelize.query<{ id: string; name: string }>(
      `
      SELECT id, COALESCE(translations -> :locale ->> 'name', name) AS "name"
      FROM exercise
      WHERE id IN (:ids)
      `,
      {
        replacements: { ids: latest.map((r) => r.exerciseId), locale },
        type: QueryTypes.SELECT,
      },
    );
    const nameById = new Map(names.map((n) => [n.id, n.name]));

    return latest.flatMap((r) => {
      const name = nameById.get(r.exerciseId);
      // Same as the inner JOIN on exercise in `_recentRecords`.
      if (name === undefined) return [];
      return [
        this._toRecord(
          r.exerciseId,
          name,
          r.last.weightKg,
          r.last.recordedAt,
          r.priorKg,
        ),
      ];
    });
  }

  /**
   * Estimated-1RM progression per exercise, oldest first, rebuilt from
   * only the logs in `scope`. Used for a restricted coach instead of the
   * one_rep_max table.
   *
   * Why not filter one_rep_max: its rows carry no link to the log they
   * came from, and MANUAL / TESTED entries come from no log at all. Even
   * the auto-estimated rows are written only when a session beats the
   * client's best across *all* their training, so whether a row exists
   * for an on-plan session, and what its delta is measured against,
   * depends on their off-plan lifting. Any filter over that table would
   * leak hidden training through which rows are missing.
   *
   * So this replays what the completion flow does (`_writePrsFromLog` in
   * WorkoutLogService): the best Epley estimate per session per
   * exercise, kept when it beats the best before it, recorded at the
   * session's completion time. Same estimate function, so on-plan
   * numbers match the client's own to the decimal, but "the best before
   * it" only ever means an earlier visible session. Nothing outside the
   * allow-list can move a number. Manual and tested 1RMs stay with the
   * client unless they share off-plan work.
   */
  private async _derivedOneRepMaxSeries(
    scope: LogScope,
    exerciseId?: string,
  ): Promise<Map<string, OneRepMaxPoint[]>> {
    const scoped = this._scopeFilter(scope, 'wl.program_assignment_id');
    const rows = await this.sequelize.query<{
      workoutLogId: string;
      exerciseId: string;
      performedAt: Date;
      reps: number;
      weightKg: string;
    }>(
      `
      -- Each visible session's best set per exercise, ranked by the exact
      -- Epley product (the value itself is taken in code by the shared
      -- function), and only the sessions that beat every earlier one.
      -- Rounding can only make fewer sessions records, never more, so
      -- this is every record the loop below keeps and usually far fewer
      -- rows than sessions: the database reads the history, the app gets
      -- the records.
      WITH best AS (
        SELECT DISTINCT ON (wl.id, le.exercise_id)
          wl.id                                    AS workout_log_id,
          le.exercise_id,
          COALESCE(wl.completed_at, wl.started_at) AS performed_at,
          ls.reps,
          ls.weight_kg,
          ls.weight_kg * (30 + ls.reps)            AS strength
        FROM workout_log wl
        JOIN logged_exercise le ON le.workout_log_id = wl.id
        JOIN logged_set ls      ON ls.logged_exercise_id = le.id AND ls.is_completed = TRUE
        WHERE wl.user_id = :userId
          AND wl.status = 'COMPLETED'
          AND le.exercise_id IS NOT NULL
          ${exerciseId ? 'AND le.exercise_id = :exerciseId' : ''}
          -- The sets the estimate covers; it returns nothing for others.
          AND ls.reps BETWEEN 1 AND 12
          AND ls.weight_kg > 0
          ${scoped.sql}
        ORDER BY wl.id, le.exercise_id, strength DESC
      ),
      running AS (
        SELECT
          best.*,
          MAX(strength) OVER (
            PARTITION BY exercise_id
            ORDER BY performed_at, workout_log_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS prior_strength
        FROM best
      )
      SELECT
        workout_log_id AS "workoutLogId",
        exercise_id    AS "exerciseId",
        performed_at   AS "performedAt",
        reps           AS "reps",
        weight_kg      AS "weightKg"
      FROM running
      WHERE prior_strength IS NULL OR strength > prior_strength
      ORDER BY performed_at ASC, workout_log_id ASC
      `,
      {
        replacements: {
          userId: scope.userId,
          ...(exerciseId ? { exerciseId } : {}),
          ...scoped.params,
        },
        type: QueryTypes.SELECT,
      },
    );

    // Best estimate per (exercise, session). Rows arrive in session
    // order, one per session and exercise, so insertion order is session
    // order too.
    const sessionBest = new Map<
      string,
      { exerciseId: string; recordedAt: Date; best: number }
    >();
    for (const r of rows) {
      const est = estimateOneRepMaxEpley(r.reps, Number(r.weightKg));
      if (est == null) continue;
      const key = `${r.exerciseId}:${r.workoutLogId}`;
      const cur = sessionBest.get(key);
      if (!cur) {
        sessionBest.set(key, {
          exerciseId: r.exerciseId,
          recordedAt: r.performedAt,
          best: est,
        });
      } else if (est > cur.best) {
        cur.best = est;
      }
    }

    // A session is a record when it beats every earlier visible one.
    const series = new Map<string, OneRepMaxPoint[]>();
    for (const s of sessionBest.values()) {
      const points = series.get(s.exerciseId) ?? [];
      const prior = points.length ? points[points.length - 1].weightKg : 0;
      if (s.best <= prior) continue;
      points.push({ weightKg: s.best, recordedAt: s.recordedAt });
      series.set(s.exerciseId, points);
    }
    return series;
  }

  private _isoDate(d: Date | string): string {
    return typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  }
}
