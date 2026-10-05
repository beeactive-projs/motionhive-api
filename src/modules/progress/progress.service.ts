import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { DEFAULT_LOCALE, apiError, type Locale } from '../../common/i18n';
import { Exercise } from '../exercise/entities/exercise.entity';
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
  /** Oldest first. One entry per ISO week in the window. */
  weeklyVolume: Array<{
    weekStart: string;
    volumeKg: number;
    workouts: number;
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
  };
}

/**
 * ProgressService — the client's "am I improving" surface.
 *
 * Everything here is derived. No new tables: volume and consistency are
 * aggregates over `workout_log` + `logged_set`, and records come from
 * `one_rep_max`, which the completion flow already writes.
 *
 * **Volume rule.** Volume is Σ(reps × weight) over completed sets that
 * carry a load. Bodyweight and cardio sets have no weight, so they
 * contribute nothing rather than zero-inflating the number. That keeps
 * the figure comparable week to week, which is the only thing it is for.
 * Sets are counted separately so a bodyweight-only week still shows work.
 */
@Injectable()
export class ProgressService {
  constructor(
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
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
    const days = RANGE_DAYS[range];

    const [totals, previous, weekly, daily, records, lifetime, weeks] =
      await Promise.all([
        this._totals(userId, days, 0),
        this._totals(userId, days, days),
        this._weeklyVolume(userId, days),
        this._dailyActivity(userId, days),
        this._recentRecords(userId, locale),
        this._lifetimeWorkouts(userId),
        // Streaks look past the window on purpose: a 9-week run is still
        // a 9-week run when you are looking at the last 4 weeks.
        this._activeWeeks(userId),
      ]);

    return {
      range,
      totals,
      previous: { workouts: previous.workouts, volumeKg: previous.volumeKg },
      streak: this._streakFromWeeks(weeks),
      weeklyVolume: weekly,
      dailyActivity: daily,
      records,
      lifetimeWorkouts: lifetime,
    };
  }

  /**
   * Every session of one exercise, newest first, with the top set of
   * each. This is where the stored 1RM history pays off.
   */
  async exerciseHistory(userId: string, exerciseId: string) {
    const exercise = await this.exerciseModel.findByPk(exerciseId, {
      attributes: [
        'id',
        'name',
        'slug',
        'kind',
        'thumbnailUrl',
        'translations',
      ],
    });
    if (!exercise) throw new NotFoundException(apiError('exercise.notFound'));

    const sessions = await this.sequelize.query<{
      workoutLogId: string;
      performedAt: Date;
      workoutName: string;
      setCount: string;
      topWeightKg: string | null;
      topReps: number | null;
      bestDurationSeconds: number | null;
      bestDistanceMeters: number | null;
    }>(
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
        MAX(ls.distance_meters)                  AS "bestDistanceMeters"
      FROM logged_set ls
      JOIN logged_exercise le ON le.id = ls.logged_exercise_id
      JOIN workout_log wl     ON wl.id = le.workout_log_id
      WHERE wl.user_id = :userId
        AND le.exercise_id = :exerciseId
        AND ls.is_completed = TRUE
        AND wl.status = 'COMPLETED'
      GROUP BY wl.id, wl.completed_at, wl.started_at, wl.name
      ORDER BY "performedAt" DESC
      LIMIT 100
      `,
      {
        replacements: { userId, exerciseId },
        type: QueryTypes.SELECT,
      },
    );

    const oneRepMaxes = await this.sequelize.query<{
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
      { replacements: { userId, exerciseId }, type: QueryTypes.SELECT },
    );

    return {
      exercise,
      // Oldest first so the sparkline reads left to right.
      oneRepMaxSeries: oneRepMaxes.map((r) => ({
        weightKg: Number(r.weightKg),
        recordedAt: r.recordedAt,
        source: r.source,
      })),
      sessions: sessions.map((s) => ({
        workoutLogId: s.workoutLogId,
        performedAt: s.performedAt,
        workoutName: s.workoutName,
        setCount: Number(s.setCount),
        topWeightKg: s.topWeightKg == null ? null : Number(s.topWeightKg),
        topReps: s.topReps,
        bestDurationSeconds: s.bestDurationSeconds,
        bestDistanceMeters: s.bestDistanceMeters,
      })),
    };
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
      WITH clients AS (
        SELECT ic.client_id
        FROM instructor_client ic
        WHERE ic.instructor_id = :instructorId
          AND ic.status = 'ACTIVE'
      ),
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
          AND pa.deleted_at IS NULL
          AND aw.scheduled_date IS NOT NULL
        GROUP BY pa.client_id
      ),
      last_seen AS (
        SELECT user_id, MAX(COALESCE(completed_at, started_at)) AS last_at
        FROM workout_log
        WHERE status = 'COMPLETED'
        GROUP BY user_id
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
        replacements: { instructorId, days, today },
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

    return {
      window,
      clients,
      totals: {
        clients: clients.length,
        needsAttention: clients.filter((c) => c.attention !== null).length,
        adherencePercent: mean,
      },
    };
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

  /** `offsetDays` shifts the window back, for period-on-period deltas. */
  private async _totals(userId: string, days: number, offsetDays: number) {
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
      ),
      sets AS (
        SELECT
          -- Load-bearing sets only; see the volume rule on this class.
          COALESCE(SUM(ls.reps * ls.weight_kg)
                   FILTER (WHERE ls.weight_kg IS NOT NULL), 0) AS volume_kg,
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
          userId,
          fromDays: days + offsetDays,
          toDays: offsetDays,
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

  private async _weeklyVolume(userId: string, days: number) {
    const rows = await this.sequelize.query<{
      weekStart: Date;
      volumeKg: string | null;
      workouts: string;
    }>(
      `
      SELECT
        DATE_TRUNC('week', COALESCE(wl.completed_at, wl.started_at))::DATE AS "weekStart",
        COALESCE(SUM(ls.reps * ls.weight_kg)
                 FILTER (WHERE ls.weight_kg IS NOT NULL), 0)              AS "volumeKg",
        COUNT(DISTINCT wl.id)                                             AS "workouts"
      FROM workout_log wl
      LEFT JOIN logged_exercise le ON le.workout_log_id = wl.id AND le.is_skipped = FALSE
      LEFT JOIN logged_set ls      ON ls.logged_exercise_id = le.id AND ls.is_completed = TRUE
      WHERE wl.user_id = :userId
        AND wl.status = 'COMPLETED'
        AND COALESCE(wl.completed_at, wl.started_at) >= NOW() - (:days || ' days')::INTERVAL
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      { replacements: { userId, days }, type: QueryTypes.SELECT },
    );

    return rows.map((r) => ({
      weekStart: this._isoDate(r.weekStart),
      volumeKg: Math.round(Number(r.volumeKg ?? 0)),
      workouts: Number(r.workouts),
    }));
  }

  private async _dailyActivity(userId: string, days: number) {
    const rows = await this.sequelize.query<{ day: Date; workouts: string }>(
      `
      SELECT
        COALESCE(completed_at, started_at)::DATE AS "day",
        COUNT(*)                                AS "workouts"
      FROM workout_log
      WHERE user_id = :userId
        AND status = 'COMPLETED'
        AND COALESCE(completed_at, started_at) >= NOW() - (:days || ' days')::INTERVAL
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      { replacements: { userId, days }, type: QueryTypes.SELECT },
    );

    return rows.map((r) => ({
      date: this._isoDate(r.day),
      workouts: Number(r.workouts),
    }));
  }

  /** Distinct ISO weeks with at least one completed workout, newest first. */
  private async _activeWeeks(userId: string): Promise<string[]> {
    const rows = await this.sequelize.query<{ weekStart: Date }>(
      `
      SELECT DISTINCT
        DATE_TRUNC('week', COALESCE(completed_at, started_at))::DATE AS "weekStart"
      FROM workout_log
      WHERE user_id = :userId AND status = 'COMPLETED'
      ORDER BY 1 DESC
      `,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => this._isoDate(r.weekStart));
  }

  /**
   * Current streak counts back from this week or last week. Allowing
   * last week means someone who trains Mon-Fri does not watch their
   * streak die every Sunday before they have had a chance to train.
   */
  private _streakFromWeeks(weeks: string[]): {
    currentWeeks: number;
    bestWeeks: number;
  } {
    if (!weeks.length) return { currentWeeks: 0, bestWeeks: 0 };

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const asTime = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
    const times = weeks.map(asTime);

    // Longest run of consecutive weeks anywhere in the history.
    let best = 1;
    let run = 1;
    for (let i = 1; i < times.length; i++) {
      if (times[i - 1] - times[i] === WEEK_MS) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 1;
      }
    }

    const now = new Date();
    const day = now.getUTCDay();
    // Postgres DATE_TRUNC('week') is Monday-based; match it.
    const daysSinceMonday = (day + 6) % 7;
    const thisWeek = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday,
    );

    let current = 0;
    if (times[0] === thisWeek || times[0] === thisWeek - WEEK_MS) {
      current = 1;
      for (let i = 1; i < times.length; i++) {
        if (times[i - 1] - times[i] === WEEK_MS) current += 1;
        else break;
      }
    }

    return { currentWeeks: current, bestWeeks: best };
  }

  private async _lifetimeWorkouts(userId: string): Promise<number> {
    const [row] = await this.sequelize.query<{ total: string }>(
      `SELECT COUNT(*) AS "total" FROM workout_log
       WHERE user_id = :userId AND status = 'COMPLETED'`,
      { replacements: { userId }, type: QueryTypes.SELECT },
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
      LIMIT 10
      `,
      { replacements: { userId, locale }, type: QueryTypes.SELECT },
    );

    return rows.map((r) => {
      const weightKg = Number(r.weightKg);
      const prior = r.priorKg == null ? null : Number(r.priorKg);
      return {
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        weightKg,
        recordedAt: r.recordedAt.toISOString(),
        // A first-ever lift is a record in full, not an improvement of 0.
        deltaKg:
          prior == null ? weightKg : Math.round((weightKg - prior) * 100) / 100,
      };
    });
  }

  private _isoDate(d: Date | string): string {
    return typeof d === 'string' ? d : d.toISOString().slice(0, 10);
  }
}
