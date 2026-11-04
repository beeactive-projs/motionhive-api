import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { ContentTranslations } from '../../common/i18n';
import { Equipment } from './entities/equipment.entity';
import { Muscle } from './entities/muscle.entity';
import {
  buildSearchPlan,
  ExerciseSearchPlan,
  personalScore,
  SearchTaxonomy,
} from './search/exercise-search';

/** Muscles and equipment change with a migration, not at runtime. */
const TAXONOMY_TTL_MS = 10 * 60_000;
/** A person's history beyond this many exercises adds nothing to a ranking. */
const PERSONAL_LIMIT = 200;

/**
 * What exercise search needs from the database besides the exercises:
 * the muscle and equipment names a query may mention, and how much each
 * exercise is the searcher's own. Matching and ranking themselves are pure
 * (`search/exercise-search.ts`).
 */
@Injectable()
export class ExerciseSearchService {
  private taxonomy: {
    loadedAt: number;
    value: Promise<SearchTaxonomy>;
  } | null = null;

  constructor(
    @InjectModel(Muscle) private readonly muscleModel: typeof Muscle,
    @InjectModel(Equipment) private readonly equipmentModel: typeof Equipment,
    private readonly sequelize: Sequelize,
  ) {}

  /** The plan for what was typed, or null when nothing was. */
  async plan(search: string | undefined): Promise<ExerciseSearchPlan | null> {
    if (!search?.trim()) return null;
    return buildSearchPlan(search, await this.loadTaxonomy());
  }

  /**
   * 0 to 1 per exercise id: how much each is this person's own. From the
   * workouts they completed in the last year, the routines and programs
   * they own, and the plans their coach assigned them. The top
   * `PERSONAL_LIMIT` only.
   */
  async personalScores(userId: string): Promise<Map<string, number>> {
    const rows = await this.sequelize.query<{
      exerciseId: string;
      sessions: string | number | null;
      lastPerformedAt: Date | null;
      planned: boolean;
    }>(
      `
      WITH logged AS (
        SELECT le.exercise_id,
               COUNT(DISTINCT wl.id)                         AS sessions,
               MAX(COALESCE(wl.completed_at, wl.started_at)) AS last_at
          FROM logged_exercise le
          JOIN workout_log wl ON wl.id = le.workout_log_id
         WHERE wl.user_id = :userId
           AND wl.status = 'COMPLETED'
           AND le.exercise_id IS NOT NULL
           AND le.is_skipped = FALSE
           AND wl.started_at > NOW() - INTERVAL '365 days'
           AND EXISTS (
             SELECT 1 FROM logged_set ls
              WHERE ls.logged_exercise_id = le.id AND ls.is_completed = TRUE
           )
         GROUP BY le.exercise_id
      ),
      planned AS (
        SELECT pe.exercise_id
          FROM prescribed_exercise pe
          JOIN program_workout pw ON pw.id = pe.program_workout_id
          JOIN program p          ON p.id = pw.program_id
         WHERE p.owner_id = :userId AND p.deleted_at IS NULL
        UNION
        SELECT ae.exercise_id
          FROM assigned_exercise ae
          JOIN assigned_workout aw   ON aw.id = ae.assigned_workout_id
          JOIN program_assignment pa ON pa.id = aw.program_assignment_id
         WHERE pa.client_id = :userId
           AND pa.deleted_at IS NULL
           AND pa.status IN ('PENDING', 'ACTIVE', 'PAUSED')
      )
      SELECT COALESCE(l.exercise_id, p.exercise_id) AS "exerciseId",
             l.sessions                             AS "sessions",
             l.last_at                              AS "lastPerformedAt",
             (p.exercise_id IS NOT NULL)            AS "planned"
        FROM logged l
        FULL OUTER JOIN planned p ON p.exercise_id = l.exercise_id
      `,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );

    const now = new Date();
    const scored = rows
      .map((row) => ({
        id: row.exerciseId,
        score: personalScore(
          {
            exerciseId: row.exerciseId,
            sessions: Number(row.sessions ?? 0),
            lastPerformedAt: row.lastPerformedAt
              ? new Date(row.lastPerformedAt)
              : null,
            planned: row.planned,
          },
          now,
        ),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PERSONAL_LIMIT);
    return new Map(scored.map((row) => [row.id, row.score]));
  }

  private loadTaxonomy(): Promise<SearchTaxonomy> {
    const now = Date.now();
    if (!this.taxonomy || now - this.taxonomy.loadedAt > TAXONOMY_TTL_MS) {
      const value = this.readTaxonomy();
      this.taxonomy = { loadedAt: now, value };
      // A failed read is not cached: the next search tries again.
      value.catch(() => {
        if (this.taxonomy?.value === value) this.taxonomy = null;
      });
    }
    return this.taxonomy.value;
  }

  private async readTaxonomy(): Promise<SearchTaxonomy> {
    const [muscles, equipment] = await Promise.all([
      this.muscleModel.findAll({
        attributes: ['id', 'slug', 'commonName', 'latinName', 'translations'],
      }),
      this.equipmentModel.findAll({
        attributes: ['id', 'slug', 'name', 'translations'],
      }),
    ]);
    return {
      muscles: muscles.map((m) => ({
        id: m.id,
        slug: m.slug,
        names: [
          m.commonName,
          m.latinName ?? '',
          ...translatedValues(m.translations, 'commonName'),
        ].filter(Boolean),
      })),
      equipment: equipment.map((e) => ({
        id: e.id,
        slug: e.slug,
        names: [e.name, ...translatedValues(e.translations, 'name')],
      })),
    };
  }
}

function translatedValues(
  translations: ContentTranslations | null,
  field: string,
): string[] {
  return Object.values(translations ?? {})
    .map((fields) => fields?.[field])
    .filter((value): value is string => !!value);
}
