import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { ExerciseSource } from './entities/exercise.enums';
import { EXERCISE_EDITORIAL_RANKS } from './search/exercise-editorial-ranks';

/** One exercise's use, as the recompute reads it. */
export interface ExerciseUsage {
  id: string;
  slug: string;
  source: string;
  /** People who completed a workout with it in the last 180 days. */
  users: number;
  /** People who put it in a routine or program they still have. */
  authors: number;
}

/** Below this many people, real use is scaled as if this many existed, so one person's habit cannot top the library. */
const USAGE_FLOOR = 50;
/** A plan counts for less than a workout actually done. */
const AUTHOR_WEIGHT = 0.5;
/** Share of the score that comes from the editorial rank; the rest is real use. */
const EDITORIAL_SHARE = 0.5;

/**
 * 0 to 1 per exercise: the editorial rank blended with real use, on a log
 * scale. Pure, so the maths is tested without a database.
 */
export function popularityScores(
  usage: readonly ExerciseUsage[],
): Map<string, number> {
  const used = (row: ExerciseUsage) => row.users + AUTHOR_WEIGHT * row.authors;
  const top = Math.max(USAGE_FLOOR, ...usage.map(used));
  const scores = new Map<string, number>();
  for (const row of usage) {
    const editorial =
      row.source === ExerciseSource.System
        ? (EXERCISE_EDITORIAL_RANKS[row.slug] ?? 0) / 100
        : 0;
    const real = Math.log1p(used(row)) / Math.log1p(top);
    const score =
      EDITORIAL_SHARE * editorial + (1 - EDITORIAL_SHARE) * Math.min(1, real);
    scores.set(row.id, Math.round(score * 10_000) / 10_000);
  }
  return scores;
}

/**
 * Keeps `exercise.popularity_score` current: the nightly
 * `workouts.recompute_exercise_popularity` job, and once at boot while no
 * exercise has a score yet (a fresh database, or the deploy that added the
 * column).
 */
@Injectable()
export class ExercisePopularityService implements OnApplicationBootstrap {
  constructor(
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    // Never holds up boot, and a failure only means search ranks without
    // popularity until the nightly run.
    void this.recomputeIfUnset().catch((err: Error) => {
      this.logger.warn(
        `Exercise popularity at boot failed: ${err.message}`,
        ExercisePopularityService.name,
      );
    });
  }

  async recompute(): Promise<{ updated: number }> {
    const usage = await this.sequelize.query<{
      id: string;
      slug: string;
      source: string;
      users: string | number;
      authors: string | number;
    }>(
      `
      WITH used AS (
        SELECT le.exercise_id, COUNT(DISTINCT wl.user_id) AS users
          FROM logged_exercise le
          JOIN workout_log wl ON wl.id = le.workout_log_id
         WHERE wl.status = 'COMPLETED'
           AND le.exercise_id IS NOT NULL
           AND le.is_skipped = FALSE
           AND wl.started_at > NOW() - INTERVAL '180 days'
           AND EXISTS (
             SELECT 1 FROM logged_set ls
              WHERE ls.logged_exercise_id = le.id AND ls.is_completed = TRUE
           )
         GROUP BY le.exercise_id
      ),
      authored AS (
        SELECT pe.exercise_id, COUNT(DISTINCT p.owner_id) AS authors
          FROM prescribed_exercise pe
          JOIN program_workout pw ON pw.id = pe.program_workout_id
          JOIN program p          ON p.id = pw.program_id
         WHERE p.deleted_at IS NULL AND p.owner_id IS NOT NULL
         GROUP BY pe.exercise_id
      )
      SELECT e.id, e.slug, e.source,
             COALESCE(u.users, 0)   AS users,
             COALESCE(a.authors, 0) AS authors
        FROM exercise e
        LEFT JOIN used u     ON u.exercise_id = e.id
        LEFT JOIN authored a ON a.exercise_id = e.id
       WHERE e.deleted_at IS NULL
      `,
      { type: QueryTypes.SELECT },
    );

    const scores = popularityScores(
      usage.map((row) => ({
        id: row.id,
        slug: row.slug,
        source: row.source,
        users: Number(row.users),
        authors: Number(row.authors),
      })),
    );
    if (!scores.size) return { updated: 0 };

    const [, updated] = await this.sequelize.query(
      `
      UPDATE exercise e
         SET popularity_score = v.score
        FROM unnest($1::char(36)[], $2::real[]) AS v(id, score)
       WHERE e.id = v.id
         AND e.popularity_score IS DISTINCT FROM v.score
      `,
      {
        bind: [[...scores.keys()], [...scores.values()]],
        type: QueryTypes.UPDATE,
      },
    );
    return { updated };
  }

  private async recomputeIfUnset(): Promise<void> {
    const scored = await this.sequelize.query(
      'SELECT 1 FROM exercise WHERE popularity_score > 0 LIMIT 1',
      { type: QueryTypes.SELECT },
    );
    if (scored.length) return;
    const { updated } = await this.recompute();
    this.logger.log(
      `Exercise popularity set at boot for ${updated} exercises`,
      ExercisePopularityService.name,
    );
  }
}
