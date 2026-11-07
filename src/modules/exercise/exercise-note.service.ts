import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { apiError } from '../../common/i18n';
import { Exercise } from './entities/exercise.entity';
import { ExerciseNote } from './entities/exercise-note.entity';
import { ExerciseSource, ExerciseVisibility } from './entities/exercise.enums';

/** A person's note on one exercise, as the routes return it. */
export interface ExerciseNoteView {
  exerciseId: string;
  /** Null when there is none. */
  note: string | null;
  updatedAt: Date | null;
}

/**
 * ExerciseNoteService: the person's own note on an exercise.
 *
 * Private to its owner. Only the owner's routes read it (here, and the
 * owner's workout reads through `notesFor`); a coach's read of a client's
 * workout never asks for it.
 */
@Injectable()
export class ExerciseNoteService {
  constructor(
    @InjectModel(ExerciseNote)
    private readonly noteModel: typeof ExerciseNote,
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
    private readonly sequelize: Sequelize,
  ) {}

  async get(exerciseId: string, userId: string): Promise<ExerciseNoteView> {
    await this._assertVisible(exerciseId, userId);
    const row = await this.noteModel.findOne({
      where: { userId, exerciseId },
    });
    return this._view(exerciseId, row);
  }

  /**
   * Writes the note, trimmed. Empty, blank or null deletes it: there is
   * no such thing as an empty note to keep.
   */
  async put(
    exerciseId: string,
    userId: string,
    note: string | null | undefined,
  ): Promise<ExerciseNoteView> {
    await this._assertVisible(exerciseId, userId);
    const text = note?.trim() ?? '';

    if (!text) {
      await this.noteModel.destroy({ where: { userId, exerciseId } });
      return this._view(exerciseId, null);
    }

    const existing = await this.noteModel.findOne({
      where: { userId, exerciseId },
    });
    if (existing) {
      await existing.update({ note: text });
      return this._view(exerciseId, existing);
    }
    try {
      const created = await this.noteModel.create({
        userId,
        exerciseId,
        note: text,
      });
      return this._view(exerciseId, created);
    } catch (err) {
      // Two saves at once: the other one created the row first.
      if (!(err instanceof UniqueConstraintError)) throw err;
      await this.noteModel.update(
        { note: text },
        { where: { userId, exerciseId } },
      );
      const row = await this.noteModel.findOne({
        where: { userId, exerciseId },
      });
      return this._view(exerciseId, row);
    }
  }

  /**
   * The person's notes on these exercises, in one query: exerciseId to
   * note. For the owner's reads of a workout only.
   */
  async notesFor(
    userId: string,
    exerciseIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(exerciseIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.noteModel.findAll({
      where: { userId, exerciseId: { [Op.in]: ids } },
      attributes: ['exerciseId', 'note'],
    });
    return new Map(rows.map((row) => [row.exerciseId, row.note]));
  }

  private _view(
    exerciseId: string,
    row: ExerciseNote | null,
  ): ExerciseNoteView {
    return {
      exerciseId,
      note: row?.note ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /**
   * The exercise must be one the person can see: ours, a public one,
   * their own, or one that reached them through a coach's plan (a coach's
   * private exercise in an assigned workout, or in a workout they logged).
   * Anything else is a 404, so a note never confirms someone else's
   * private exercise exists.
   */
  private async _assertVisible(
    exerciseId: string,
    userId: string,
  ): Promise<void> {
    const exercise = await this.exerciseModel.findByPk(exerciseId, {
      attributes: ['id', 'source', 'visibility', 'ownerId'],
    });
    if (!exercise) throw new NotFoundException(apiError('exercise.notFound'));
    if (
      exercise.source === ExerciseSource.System ||
      exercise.visibility === ExerciseVisibility.Public ||
      exercise.ownerId === userId
    ) {
      return;
    }
    const reached = await this.sequelize.query<{ found: number }>(
      `
      SELECT 1 AS found
      FROM logged_exercise le
      JOIN workout_log wl ON wl.id = le.workout_log_id
      WHERE le.exercise_id = :exerciseId AND wl.user_id = :userId
      UNION ALL
      SELECT 1 AS found
      FROM assigned_exercise ae
      JOIN assigned_workout aw ON aw.id = ae.assigned_workout_id
      JOIN program_assignment pa ON pa.id = aw.program_assignment_id
      WHERE ae.exercise_id = :exerciseId
        AND pa.client_id = :userId
        AND pa.deleted_at IS NULL
      LIMIT 1
      `,
      { replacements: { exerciseId, userId }, type: QueryTypes.SELECT },
    );
    if (reached.length === 0) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }
  }
}
