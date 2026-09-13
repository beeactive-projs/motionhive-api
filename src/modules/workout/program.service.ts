import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { literal, Op, type Order, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { assertOwned } from '../../common/utils/ownership.utils';
import { escapeLikeWildcards } from '../../common/utils/search.utils';
import {
  buildPaginatedResponse,
  getOffset,
} from '../../common/dto/pagination.dto';
import { Exercise } from '../exercise/entities/exercise.entity';
import {
  ExerciseSource,
  ExerciseVisibility,
} from '../exercise/entities/exercise.enums';
import { User } from '../user/entities/user.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import {
  ExerciseSetType,
  ProgramAssignmentStatus,
  ProgramSource,
  ProgramStatus,
} from './entities/workout.enums';
import { CopyProgramWeekDto } from './dto/copy-program-week.dto';
import { ReorderPrescribedRowsDto } from './dto/reorder-prescribed-rows.dto';
import { CreatePrescribedExerciseDto } from './dto/create-prescribed-exercise.dto';
import { CreatePrescribedSetDto } from './dto/create-prescribed-set.dto';
import {
  CreateProgramDto,
  CreateProgramExerciseDto,
} from './dto/create-program.dto';
import { CreateProgramWorkoutDto } from './dto/create-program-workout.dto';
import {
  ListProgramsQueryDto,
  ProgramLibrary,
} from './dto/list-programs.query.dto';
import { ReorderProgramWorkoutsDto } from './dto/reorder-program-workouts.dto';
import { UpdatePrescribedExerciseDto } from './dto/update-prescribed-exercise.dto';
import { UpdatePrescribedSetDto } from './dto/update-prescribed-set.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { UpdateProgramWorkoutDto } from './dto/update-program-workout.dto';

/**
 * Temporary week namespace used while repositioning workouts. The
 * unique (program_id, week_index, day_index) index is NOT deferrable,
 * so swaps would collide mid-transaction if final slots were written
 * directly. week_index has no upper CHECK (only >= 0, SMALLINT) and
 * real weeks are DTO-capped at 103, so parking moved rows at
 * `week + 10000` can never clash with a live slot.
 */
const WEEK_PARK_OFFSET = 10_000;

/**
 * ProgramService — nested CRUD across the program-authoring tree
 * (program → program_workout → prescribed_exercise → prescribed_set).
 *
 * Ownership is enforced at the program root. All nested operations
 * load the program first (via `_loadProgram`) and then verify the
 * nested-id parent chain — a workout must belong to the program,
 * an exercise must belong to the workout, a set must belong to the
 * exercise. Service throws 404 with the same hide-existence pattern
 * the exercise module uses (locked decision §16-style for shared
 * resources, applied here for cross-instructor probes).
 *
 * Locked decisions touched:
 *   - §3 — programs are per-instructor private; no marketplace.
 *   - §15 — sets snapshot kg/m/s in storage; FE converts at the edge.
 */
@Injectable()
export class ProgramService {
  constructor(
    @InjectModel(Program) private readonly programModel: typeof Program,
    @InjectModel(ProgramAssignment)
    private readonly assignmentModel: typeof ProgramAssignment,
    @InjectModel(ProgramWorkout)
    private readonly workoutModel: typeof ProgramWorkout,
    @InjectModel(PrescribedExercise)
    private readonly prescribedExerciseModel: typeof PrescribedExercise,
    @InjectModel(PrescribedSet)
    private readonly prescribedSetModel: typeof PrescribedSet,
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Program — top-level CRUD
  // ────────────────────────────────────────────────────────────────────

  async list(filter: ListProgramsQueryDto, ownerId: string) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    // MotionHive starter routines have `ownerId = null` and are readable
    // by everyone. The old `ownerId` equality hid them from every user,
    // which is why the seeded starter content had nowhere to appear.
    const library = filter.library ?? ProgramLibrary.All;
    const ownerScope =
      library === ProgramLibrary.Mine
        ? { ownerId }
        : library === ProgramLibrary.System
          ? { source: ProgramSource.System }
          : {
              [Op.or]: [{ ownerId }, { source: ProgramSource.System }],
            };

    const where = {
      ...ownerScope,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.isSingleWorkout !== undefined
        ? { isSingleWorkout: filter.isSingleWorkout }
        : {}),
      ...(filter.folder ? { folder: filter.folder } : {}),
      ...(filter.level ? { level: filter.level } : {}),
      ...(filter.search
        ? {
            name: {
              [Op.iLike]: `%${escapeLikeWildcards(filter.search.trim())}%`,
            },
          }
        : {}),
    };

    // Routines sort by when they were last trained, which is what the
    // quick-start list is ordered by. Multi-week programs keep the
    // authoring sort (most recently edited).
    // Your own routines lead; starter content sits underneath rather
    // than pushing a returning user's work down the list.
    const yoursFirst: Order = [
      [literal('CASE WHEN owner_id IS NULL THEN 1 ELSE 0 END'), 'ASC'],
    ];
    const order: Order = filter.isSingleWorkout
      ? [
          ...yoursFirst,
          ['lastPerformedAt', 'DESC NULLS LAST'],
          ['updatedAt', 'DESC'],
        ]
      : [...yoursFirst, ['updatedAt', 'DESC']];

    const { rows, count } = await this.programModel.findAndCountAll({
      where,
      order,
      offset: getOffset(page, limit),
      limit,
    });

    // The list never carries the tree (too heavy), but the row still has
    // to say how many exercises a program holds. One grouped count for
    // the whole page beats N+1 or shipping every set.
    const counts = await this._exerciseCountsFor(rows.map((r) => r.id));
    const items = rows.map((r) => ({
      ...r.toJSON(),
      exerciseCount: counts.get(r.id) ?? 0,
    }));

    return buildPaginatedResponse(items, count, page, limit);
  }

  /** programId -> number of prescribed exercises across all its workouts. */
  private async _exerciseCountsFor(
    programIds: string[],
  ): Promise<Map<string, number>> {
    if (!programIds.length) return new Map();

    const rows = await this.prescribedExerciseModel.findAll({
      attributes: [
        [Sequelize.col('workout.program_id'), 'programId'],
        [
          Sequelize.fn('COUNT', Sequelize.col('PrescribedExercise.id')),
          'total',
        ],
      ],
      include: [
        {
          model: ProgramWorkout,
          as: 'workout',
          attributes: [],
          where: { programId: { [Op.in]: programIds } },
        },
      ],
      group: [Sequelize.col('workout.program_id')],
      raw: true,
    });

    return new Map(
      (rows as unknown as Array<{ programId: string; total: string }>).map(
        (r) => [r.programId, Number(r.total)],
      ),
    );
  }

  /**
   * Detail view — full nested tree. Workouts ordered by
   * `sequenceNumber`, exercises by `orderIndex`, sets by `orderIndex`.
   */
  async findById(id: string, ownerId: string): Promise<Program> {
    const program = await this.programModel.findByPk(id, {
      include: [
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl', 'handle'],
        },
        {
          model: ProgramWorkout,
          as: 'workouts',
          separate: true,
          order: [['sequenceNumber', 'ASC']],
          include: [
            {
              model: PrescribedExercise,
              as: 'exercises',
              separate: true,
              order: [['orderIndex', 'ASC']],
              include: [
                {
                  model: Exercise,
                  as: 'exercise',
                  attributes: [
                    'id',
                    'name',
                    'slug',
                    'kind',
                    'level',
                    'thumbnailUrl',
                  ],
                },
                {
                  model: PrescribedSet,
                  as: 'sets',
                  separate: true,
                  order: [['orderIndex', 'ASC']],
                },
              ],
            },
          ],
        },
      ],
    });

    // MotionHive starters belong to nobody and are readable by everyone.
    // Without this the list showed them and starting one worked, but
    // opening the detail 404'd — the same routine visible, runnable and
    // unopenable at once.
    if (program?.source === ProgramSource.System) return program;

    assertOwned(program, ownerId, (p) => p.ownerId, {
      notFoundMessage: 'Program not found.',
      onMismatch: 'hide',
    });
    return program;
  }

  /**
   * `isInstructor` only decides the `source` stamp, which is provenance
   * for reporting. It grants nothing: ownership is the authorization
   * boundary, and both roles author into the same table.
   */
  /**
   * Copy a routine into the caller's own library.
   *
   * The way a starter routine becomes editable. MotionHive's are owned
   * by nobody (`ownerId = null`) so they cannot be edited in place —
   * one person's tweak would change them for everybody. Taking a copy
   * gives you a routine that is yours, stamped `USER`, with the
   * original left alone.
   *
   * Also works on your own routines, which is the cheap way to make a
   * variant of something you already have.
   */
  async duplicateForUser(programId: string, userId: string): Promise<Program> {
    const source = await this.programModel.findOne({
      where: { id: programId, deletedAt: null },
      include: [
        {
          model: ProgramWorkout,
          as: 'workouts',
          required: false,
          include: [
            {
              model: PrescribedExercise,
              as: 'exercises',
              required: false,
              include: [{ model: PrescribedSet, as: 'sets', required: false }],
            },
          ],
        },
      ],
    });

    // Readable if it is yours or it is ours. 404 rather than 403 so a
    // probe cannot enumerate other people's libraries.
    const readable =
      source &&
      (source.ownerId === userId || source.source === ProgramSource.System);
    if (!readable) throw new NotFoundException('Program not found.');

    return this.sequelize.transaction(async (tx) => {
      const copy = await this.programModel.create(
        {
          ownerId: userId,
          name: `${source.name} (my copy)`,
          description: source.description,
          kind: source.kind,
          status: ProgramStatus.Draft,
          source: ProgramSource.User,
          isSingleWorkout: source.isSingleWorkout,
          folder: source.folder,
          goalTags: source.goalTags,
          durationDays: source.durationDays,
        },
        { transaction: tx },
      );

      for (const w of source.workouts ?? []) {
        const newWorkout = await this.workoutModel.create(
          {
            programId: copy.id,
            name: w.name,
            notes: w.notes,
            weekIndex: w.weekIndex,
            dayIndex: w.dayIndex,
            sequenceNumber: w.sequenceNumber,
            phase: w.phase,
            estimatedDurationMinutes: w.estimatedDurationMinutes,
          },
          { transaction: tx },
        );

        for (const ex of w.exercises ?? []) {
          const newExercise = await this.prescribedExerciseModel.create(
            {
              programWorkoutId: newWorkout.id,
              exerciseId: ex.exerciseId,
              blockId: ex.blockId,
              supersetGroupId: ex.supersetGroupId,
              orderIndex: ex.orderIndex,
              notes: ex.notes,
              alternateExerciseId: ex.alternateExerciseId,
            },
            { transaction: tx },
          );

          const sets = (ex.sets ?? []).map((st) => ({
            prescribedExerciseId: newExercise.id,
            orderIndex: st.orderIndex,
            setType: st.setType,
            targetRepsMin: st.targetRepsMin,
            targetRepsMax: st.targetRepsMax,
            targetWeightKg: st.targetWeightKg,
            targetWeightPercent1rm: st.targetWeightPercent1rm,
            targetDurationSeconds: st.targetDurationSeconds,
            targetDistanceMeters: st.targetDistanceMeters,
            targetRpe: st.targetRpe,
            targetRir: st.targetRir,
            restAfterSeconds: st.restAfterSeconds,
            tempo: st.tempo,
            notes: st.notes,
          }));
          if (sets.length) {
            await this.prescribedSetModel.bulkCreate(sets, { transaction: tx });
          }
        }
      }

      return copy;
    });
  }

  /**
   * Copy every workout of one week into another, with its exercises and
   * sets, in ONE transaction.
   *
   * The client used to do this itself with one request per row, which is
   * both slow and not atomic — a throttle or a dropped connection halfway
   * left the target week half-copied. Whatever is already in the target
   * week is removed first, so repeating a copy is idempotent rather than
   * additive.
   */
  async reorderExercises(
    programId: string,
    workoutId: string,
    dto: ReorderPrescribedRowsDto,
    ownerId: string,
  ): Promise<PrescribedExercise[]> {
    await this._loadWorkout(programId, workoutId, ownerId);
    const rows = await this.prescribedExerciseModel.findAll({
      where: { programWorkoutId: workoutId },
    });
    await this._reorderRows(rows, dto, 'Exercise not found.');
    return this.prescribedExerciseModel.findAll({
      where: { programWorkoutId: workoutId },
      order: [['orderIndex', 'ASC']],
    });
  }

  async reorderSets(
    programId: string,
    workoutId: string,
    exerciseId: string,
    dto: ReorderPrescribedRowsDto,
    ownerId: string,
  ): Promise<PrescribedSet[]> {
    await this._loadPrescribedExercise(
      programId,
      workoutId,
      exerciseId,
      ownerId,
    );
    const rows = await this.prescribedSetModel.findAll({
      where: { prescribedExerciseId: exerciseId },
    });
    await this._reorderRows(rows, dto, 'Set not found.');
    return this.prescribedSetModel.findAll({
      where: { prescribedExerciseId: exerciseId },
      order: [['orderIndex', 'ASC']],
    });
  }

  /**
   * Apply new indexes to a list of ordered rows in one transaction. Rows
   * not mentioned keep their index; the combined layout is checked for
   * two rows landing on the same index before anything is written.
   */
  private async _reorderRows(
    rows: (PrescribedExercise | PrescribedSet)[],
    dto: ReorderPrescribedRowsDto,
    notFound: string,
  ): Promise<void> {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const item of dto.items) {
      if (!byId.has(item.id)) throw new NotFoundException(notFound);
      if (seen.has(item.id)) {
        throw new BadRequestException(
          'Each row may appear only once in items.',
        );
      }
      seen.add(item.id);
    }

    const targetById = new Map(dto.items.map((i) => [i.id, i.orderIndex]));
    const taken = new Set<number>();
    for (const row of rows) {
      const index = targetById.get(row.id) ?? row.orderIndex;
      if (taken.has(index)) {
        throw new ConflictException(
          `Two rows would share position ${index + 1}.`,
        );
      }
      taken.add(index);
    }

    const moved = dto.items.filter(
      (i) => byId.get(i.id)!.orderIndex !== i.orderIndex,
    );
    if (!moved.length) return;
    await this.sequelize.transaction(async (tx) => {
      for (const item of moved) {
        await byId
          .get(item.id)!
          .update({ orderIndex: item.orderIndex }, { transaction: tx });
      }
    });
  }

  async copyWeek(
    programId: string,
    dto: CopyProgramWeekDto,
    ownerId: string,
  ): Promise<ProgramWorkout[]> {
    await this._loadProgram(programId, ownerId);
    if (dto.fromWeekIndex === dto.toWeekIndex) {
      throw new BadRequestException('Source and target week must differ.');
    }

    const source = await this.workoutModel.findAll({
      where: { programId, weekIndex: dto.fromWeekIndex },
      order: [['dayIndex', 'ASC']],
      include: [
        {
          model: PrescribedExercise,
          as: 'exercises',
          required: false,
          include: [{ model: PrescribedSet, as: 'sets', required: false }],
        },
      ],
    });
    if (!source.length) {
      throw new BadRequestException('That week has nothing to copy.');
    }

    return this.sequelize.transaction(async (tx) => {
      // CASCADE on the FK takes the nested exercises and sets with them.
      await this.workoutModel.destroy({
        where: { programId, weekIndex: dto.toWeekIndex },
        transaction: tx,
      });

      const copied: ProgramWorkout[] = [];
      for (const w of source) {
        const newWorkout = await this.workoutModel.create(
          {
            programId,
            name: w.name,
            notes: w.notes,
            weekIndex: dto.toWeekIndex,
            dayIndex: w.dayIndex,
            sequenceNumber: w.sequenceNumber,
            phase: w.phase,
            estimatedDurationMinutes: w.estimatedDurationMinutes,
          },
          { transaction: tx },
        );

        for (const ex of w.exercises ?? []) {
          const newExercise = await this.prescribedExerciseModel.create(
            {
              programWorkoutId: newWorkout.id,
              exerciseId: ex.exerciseId,
              blockId: ex.blockId,
              supersetGroupId: ex.supersetGroupId,
              orderIndex: ex.orderIndex,
              notes: ex.notes,
              alternateExerciseId: ex.alternateExerciseId,
            },
            { transaction: tx },
          );

          const sets = (ex.sets ?? []).map((st) => ({
            prescribedExerciseId: newExercise.id,
            orderIndex: st.orderIndex,
            setType: st.setType,
            targetRepsMin: st.targetRepsMin,
            targetRepsMax: st.targetRepsMax,
            targetWeightKg: st.targetWeightKg,
            targetWeightPercent1rm: st.targetWeightPercent1rm,
            targetDurationSeconds: st.targetDurationSeconds,
            targetDistanceMeters: st.targetDistanceMeters,
            targetRpe: st.targetRpe,
            targetRir: st.targetRir,
            restAfterSeconds: st.restAfterSeconds,
            tempo: st.tempo,
            notes: st.notes,
          }));
          if (sets.length) {
            await this.prescribedSetModel.bulkCreate(sets, { transaction: tx });
          }
        }
        copied.push(newWorkout);
      }
      return copied;
    });
  }

  async create(
    dto: CreateProgramDto,
    ownerId: string,
    isInstructor: boolean,
  ): Promise<Program> {
    if (dto.exercises?.length && !dto.isSingleWorkout) {
      throw new BadRequestException(
        'Nested exercises are only supported on single-workout programs. ' +
          'Build a multi-week program through its workout endpoints.',
      );
    }

    const attrs = {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      kind: dto.kind ?? 'WORKOUT',
      status: dto.status ?? ProgramStatus.Draft,
      durationDays: dto.durationDays ?? null,
      periodizationModel: dto.periodizationModel?.trim() || null,
      coverImageUrl: dto.coverImageUrl ?? null,
      goalTags: dto.goalTags ?? null,
      isSingleWorkout: dto.isSingleWorkout ?? false,
      folder: dto.folder?.trim() || null,
      // Authored through the API by a signed-in person. SYSTEM starter
      // programs are seeded, never created here.
      source: isInstructor ? ProgramSource.Instructor : ProgramSource.User,
      ownerId,
    };

    if (!dto.isSingleWorkout) {
      return this.programModel.create(attrs);
    }

    // Single-workout programs are saved whole: program, its one workout,
    // and the exercise tree in one transaction, so a routine is never
    // left half-written if a later insert fails.
    return this.sequelize.transaction(async (tx) => {
      const program = await this.programModel.create(attrs, {
        transaction: tx,
      });

      const workout = await this.workoutModel.create(
        {
          programId: program.id,
          name: attrs.name,
          weekIndex: 0,
          dayIndex: 0,
          sequenceNumber: 0,
        },
        { transaction: tx },
      );

      await this._writeExerciseTree(workout.id, dto.exercises ?? [], tx);
      return program;
    });
  }

  /**
   * Writes prescribed exercises and their sets for one workout.
   * `defaultSets` fans out into that many rows carrying the same
   * targets, which is what the simple editor sends.
   */
  private async _writeExerciseTree(
    programWorkoutId: string,
    exercises: CreateProgramExerciseDto[],
    tx: Transaction,
  ): Promise<void> {
    for (const [index, ex] of exercises.entries()) {
      const created = await this.prescribedExerciseModel.create(
        {
          programWorkoutId,
          exerciseId: ex.exerciseId,
          orderIndex: index,
          supersetGroupId: ex.supersetGroupId ?? null,
          notes: ex.notes?.trim() || null,
        },
        { transaction: tx },
      );

      // Explicit rows win: they can express a warm-up, a top set and
      // backoffs. `defaultSets` is the shorthand for N identical sets,
      // which is all the simple editor can say.
      const rows = ex.sets?.length
        ? ex.sets.map((s, i) => ({
            prescribedExerciseId: created.id,
            orderIndex: i,
            setType: s.setType ?? ExerciseSetType.Normal,
            targetRepsMin: s.targetRepsMin ?? null,
            targetRepsMax: s.targetRepsMax ?? null,
            targetWeightKg: s.targetWeightKg ?? null,
            targetDurationSeconds: s.targetDurationSeconds ?? null,
            targetDistanceMeters: s.targetDistanceMeters ?? null,
            restAfterSeconds: s.restAfterSeconds ?? null,
          }))
        : Array.from(
            { length: Math.min(30, Math.max(1, ex.defaultSets ?? 3)) },
            (_, i) => ({
              prescribedExerciseId: created.id,
              orderIndex: i,
              setType: ExerciseSetType.Normal,
              targetRepsMin: ex.targetRepsMin ?? null,
              targetRepsMax: ex.targetRepsMax ?? null,
              targetWeightKg: ex.targetWeightKg ?? null,
              targetDurationSeconds: null,
              targetDistanceMeters: null,
              restAfterSeconds: ex.restAfterSeconds ?? null,
            }),
          );

      await this.prescribedSetModel.bulkCreate(rows, { transaction: tx });
    }
  }

  async update(
    id: string,
    dto: UpdateProgramDto,
    ownerId: string,
  ): Promise<Program> {
    const program = await this._loadProgram(id, ownerId);

    if (dto.exercises && !program.isSingleWorkout) {
      throw new BadRequestException(
        'Nested exercises are only supported on single-workout programs. ' +
          'Edit a multi-week program through its workout endpoints.',
      );
    }

    // A routine's exercise list is edited as a whole, so the tree is
    // replaced rather than diffed. Safe for history: logged rows point at
    // assigned_* copies and carry their own name snapshots, so nothing
    // already trained is disturbed.
    if (dto.exercises) {
      await this.sequelize.transaction(async (tx) => {
        const workout = await this.workoutModel.findOne({
          where: { programId: program.id },
          order: [['sequenceNumber', 'ASC']],
          transaction: tx,
        });
        if (!workout) {
          throw new BadRequestException(
            'This routine has no workout to put exercises in.',
          );
        }
        // Sets cascade from prescribed_exercise.
        await this.prescribedExerciseModel.destroy({
          where: { programWorkoutId: workout.id },
          transaction: tx,
        });
        await this._writeExerciseTree(workout.id, dto.exercises!, tx);
      });
    }

    await program.update({
      ...(dto.folder !== undefined && {
        folder: dto.folder?.trim() || null,
      }),
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.description !== undefined && {
        description: dto.description?.trim() || null,
      }),
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.durationDays !== undefined && {
        durationDays: dto.durationDays,
      }),
      ...(dto.periodizationModel !== undefined && {
        periodizationModel: dto.periodizationModel?.trim() || null,
      }),
      ...(dto.coverImageUrl !== undefined && {
        coverImageUrl: dto.coverImageUrl ?? null,
      }),
      ...(dto.goalTags !== undefined && { goalTags: dto.goalTags ?? null }),
    });
    return program;
  }

  /**
   * @param cancelScheduled also cancel sessions this routine was
   * scheduled into. Off by default: `program_assignment.master_program_id`
   * is ON DELETE SET NULL, so without this the assignment survives and
   * its `assigned_workout` rows keep appearing on the calendar, pointing
   * at a routine that no longer exists.
   */
  async softDelete(
    id: string,
    ownerId: string,
    cancelScheduled = false,
  ): Promise<void> {
    const program = await this._loadProgram(id, ownerId);

    if (cancelScheduled) {
      // Cancel rather than delete: a scheduled session someone already
      // trained is history, and history does not get rewritten because
      // the template was tidied up.
      await this.assignmentModel.update(
        { status: ProgramAssignmentStatus.Cancelled },
        {
          where: {
            masterProgramId: id,
            clientId: ownerId,
            status: {
              [Op.in]: [
                ProgramAssignmentStatus.Pending,
                ProgramAssignmentStatus.Active,
                ProgramAssignmentStatus.Paused,
              ],
            },
          },
        },
      );
    }

    await program.destroy();
  }

  /**
   * How many live schedules point at this routine, so the confirm can
   * say what else disappears instead of surprising someone afterwards.
   */
  async countScheduledFor(id: string, ownerId: string): Promise<number> {
    await this._loadProgram(id, ownerId);
    return this.assignmentModel.count({
      where: {
        masterProgramId: id,
        clientId: ownerId,
        status: {
          [Op.in]: [
            ProgramAssignmentStatus.Pending,
            ProgramAssignmentStatus.Active,
            ProgramAssignmentStatus.Paused,
          ],
        },
      },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // ProgramWorkout — nested under a program
  // ────────────────────────────────────────────────────────────────────

  async addWorkout(
    programId: string,
    dto: CreateProgramWorkoutDto,
    ownerId: string,
  ): Promise<ProgramWorkout> {
    await this._loadProgram(programId, ownerId);

    // Uniqueness on (programId, weekIndex, dayIndex) enforced by the
    // partial unique index — surface as 409 with a clear message
    // before the DB constraint fires.
    const existing = await this.workoutModel.findOne({
      where: {
        programId,
        weekIndex: dto.weekIndex,
        dayIndex: dto.dayIndex,
      },
      attributes: ['id'],
    });
    if (existing) {
      throw new ConflictException(
        `A workout already exists at week ${dto.weekIndex + 1}, day ${dto.dayIndex + 1}.`,
      );
    }

    // sequence_number = current max + 1 (or 0 for the first workout).
    const nextSeq = await this._nextSequenceNumber(programId);

    return this.workoutModel.create({
      programId,
      name: dto.name.trim(),
      notes: dto.notes?.trim() || null,
      weekIndex: dto.weekIndex,
      dayIndex: dto.dayIndex,
      sequenceNumber: nextSeq,
      phase: dto.phase?.trim() || null,
      estimatedDurationMinutes: dto.estimatedDurationMinutes ?? null,
    });
  }

  /**
   * Atomic calendar repositioning — see ReorderProgramWorkoutsDto.
   * Validates the combined target layout up front, then applies all
   * moves in one transaction: phase 1 parks moved rows in the
   * out-of-range week namespace, phase 2 writes final slots, and
   * `sequenceNumber` is recomputed to calendar order program-wide.
   */
  async reorderWorkouts(
    programId: string,
    dto: ReorderProgramWorkoutsDto,
    ownerId: string,
  ): Promise<ProgramWorkout[]> {
    await this._loadProgram(programId, ownerId);

    const workouts = await this.workoutModel.findAll({ where: { programId } });
    const byId = new Map(workouts.map((w) => [w.id, w]));

    const seenIds = new Set<string>();
    for (const item of dto.items) {
      if (!byId.has(item.id)) {
        throw new NotFoundException('Workout not found.');
      }
      if (seenIds.has(item.id)) {
        throw new BadRequestException(
          'Each workout may appear only once in items.',
        );
      }
      seenIds.add(item.id);
    }

    // Combined layout = moved targets + untouched rows' current slots.
    const targetById = new Map(dto.items.map((i) => [i.id, i]));
    const slots = new Set<string>();
    for (const w of workouts) {
      const target = targetById.get(w.id);
      const week = target?.weekIndex ?? w.weekIndex;
      const day = target?.dayIndex ?? w.dayIndex;
      const key = `${week}:${day}`;
      if (slots.has(key)) {
        throw new ConflictException(
          `Two workouts would occupy week ${week + 1}, day ${day + 1}.`,
        );
      }
      slots.add(key);
    }

    const moved = dto.items.filter((i) => {
      const w = byId.get(i.id)!;
      return w.weekIndex !== i.weekIndex || w.dayIndex !== i.dayIndex;
    });

    if (moved.length > 0) {
      await this.sequelize.transaction(async (tx) => {
        // Phase 1 — park (see WEEK_PARK_OFFSET). Parked slots stay
        // mutually unique because the original (week, day) pairs were.
        for (const item of moved) {
          const w = byId.get(item.id)!;
          await w.update(
            { weekIndex: w.weekIndex + WEEK_PARK_OFFSET },
            { transaction: tx },
          );
        }
        // Phase 2 — final slots (validated collision-free above).
        for (const item of moved) {
          const w = byId.get(item.id)!;
          await w.update(
            { weekIndex: item.weekIndex, dayIndex: item.dayIndex },
            { transaction: tx },
          );
        }
        // Keep the linear index in calendar order program-wide.
        const ordered = [...workouts].sort(
          (a, b) => a.weekIndex - b.weekIndex || a.dayIndex - b.dayIndex,
        );
        for (let i = 0; i < ordered.length; i++) {
          if (ordered[i].sequenceNumber !== i) {
            await ordered[i].update({ sequenceNumber: i }, { transaction: tx });
          }
        }
      });
    }

    return this.workoutModel.findAll({
      where: { programId },
      order: [['sequenceNumber', 'ASC']],
    });
  }

  async updateWorkout(
    programId: string,
    workoutId: string,
    dto: UpdateProgramWorkoutDto,
    ownerId: string,
  ): Promise<ProgramWorkout> {
    const workout = await this._loadWorkout(programId, workoutId, ownerId);

    // If repositioning, re-check uniqueness against other workouts.
    if (
      (dto.weekIndex !== undefined && dto.weekIndex !== workout.weekIndex) ||
      (dto.dayIndex !== undefined && dto.dayIndex !== workout.dayIndex)
    ) {
      const targetWeek = dto.weekIndex ?? workout.weekIndex;
      const targetDay = dto.dayIndex ?? workout.dayIndex;
      const clash = await this.workoutModel.findOne({
        where: {
          programId,
          weekIndex: targetWeek,
          dayIndex: targetDay,
          id: { [Op.ne]: workoutId },
        },
        attributes: ['id'],
      });
      if (clash) {
        throw new ConflictException(
          `Another workout already occupies week ${targetWeek + 1}, day ${targetDay + 1}.`,
        );
      }
    }

    await workout.update({
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      ...(dto.weekIndex !== undefined && { weekIndex: dto.weekIndex }),
      ...(dto.dayIndex !== undefined && { dayIndex: dto.dayIndex }),
      ...(dto.phase !== undefined && {
        phase: dto.phase?.trim() || null,
      }),
      ...(dto.estimatedDurationMinutes !== undefined && {
        estimatedDurationMinutes: dto.estimatedDurationMinutes,
      }),
    });
    return workout;
  }

  async removeWorkout(
    programId: string,
    workoutId: string,
    ownerId: string,
  ): Promise<void> {
    const workout = await this._loadWorkout(programId, workoutId, ownerId);
    // CASCADE on FK takes care of nested exercises + sets. The program
    // workout table isn't paranoid (only program is) — hard delete OK
    // because no `assigned_workout` references it directly (those
    // reference via `master_workout_id` which is ON DELETE SET NULL).
    await workout.destroy();
  }

  // ────────────────────────────────────────────────────────────────────
  // PrescribedExercise — nested under a workout
  // ────────────────────────────────────────────────────────────────────

  async addExercise(
    programId: string,
    workoutId: string,
    dto: CreatePrescribedExerciseDto,
    ownerId: string,
  ): Promise<PrescribedExercise> {
    await this._loadWorkout(programId, workoutId, ownerId);
    await this._assertExerciseUsable(dto.exerciseId, ownerId);
    if (dto.alternateExerciseId) {
      await this._assertExerciseUsable(dto.alternateExerciseId, ownerId);
    }

    const orderIndex =
      dto.orderIndex ?? (await this._nextExerciseOrderIndex(workoutId));

    // The sets ride along in the same transaction: an editor that adds a
    // movement with N empty sets should not need N+1 round trips for it.
    return this.sequelize.transaction(async (tx) => {
      const created = await this.prescribedExerciseModel.create(
        {
          programWorkoutId: workoutId,
          exerciseId: dto.exerciseId,
          blockId: dto.blockId ?? null,
          supersetGroupId: dto.supersetGroupId ?? null,
          orderIndex,
          notes: dto.notes?.trim() || null,
          alternateExerciseId: dto.alternateExerciseId ?? null,
        },
        { transaction: tx },
      );

      if (dto.defaultSets) {
        await this.prescribedSetModel.bulkCreate(
          Array.from({ length: dto.defaultSets }, (_, i) => ({
            prescribedExerciseId: created.id,
            orderIndex: i,
            setType: ExerciseSetType.Normal,
          })),
          { transaction: tx },
        );
      }
      return created;
    });
  }

  async updateExercise(
    programId: string,
    workoutId: string,
    exerciseId: string,
    dto: UpdatePrescribedExerciseDto,
    ownerId: string,
  ): Promise<PrescribedExercise> {
    const row = await this._loadPrescribedExercise(
      programId,
      workoutId,
      exerciseId,
      ownerId,
    );

    if (dto.exerciseId && dto.exerciseId !== row.exerciseId) {
      await this._assertExerciseUsable(dto.exerciseId, ownerId);
    }
    if (
      dto.alternateExerciseId &&
      dto.alternateExerciseId !== row.alternateExerciseId
    ) {
      await this._assertExerciseUsable(dto.alternateExerciseId, ownerId);
    }

    await row.update({
      ...(dto.exerciseId !== undefined && { exerciseId: dto.exerciseId }),
      ...(dto.blockId !== undefined && { blockId: dto.blockId ?? null }),
      ...(dto.supersetGroupId !== undefined && {
        supersetGroupId: dto.supersetGroupId ?? null,
      }),
      ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      ...(dto.alternateExerciseId !== undefined && {
        alternateExerciseId: dto.alternateExerciseId ?? null,
      }),
    });
    return row;
  }

  async removeExercise(
    programId: string,
    workoutId: string,
    exerciseId: string,
    ownerId: string,
  ): Promise<void> {
    const row = await this._loadPrescribedExercise(
      programId,
      workoutId,
      exerciseId,
      ownerId,
    );
    await row.destroy();
  }

  // ────────────────────────────────────────────────────────────────────
  // PrescribedSet — nested under a prescribed exercise
  // ────────────────────────────────────────────────────────────────────

  async addSet(
    programId: string,
    workoutId: string,
    exerciseId: string,
    dto: CreatePrescribedSetDto,
    ownerId: string,
  ): Promise<PrescribedSet> {
    await this._loadPrescribedExercise(
      programId,
      workoutId,
      exerciseId,
      ownerId,
    );
    this._assertSetCoherent(dto);

    const orderIndex =
      dto.orderIndex ?? (await this._nextSetOrderIndex(exerciseId));

    return this.prescribedSetModel.create({
      prescribedExerciseId: exerciseId,
      orderIndex,
      setType: dto.setType ?? 'NORMAL',
      targetRepsMin: dto.targetRepsMin ?? null,
      targetRepsMax: dto.targetRepsMax ?? null,
      targetWeightKg: dto.targetWeightKg ?? null,
      targetWeightPercent1rm: dto.targetWeightPercent1rm ?? null,
      targetDurationSeconds: dto.targetDurationSeconds ?? null,
      targetDistanceMeters: dto.targetDistanceMeters ?? null,
      targetRpe: dto.targetRpe ?? null,
      targetRir: dto.targetRir ?? null,
      restAfterSeconds: dto.restAfterSeconds ?? null,
      tempo: dto.tempo ?? null,
      notes: dto.notes?.trim() || null,
    });
  }

  async updateSet(
    programId: string,
    workoutId: string,
    exerciseId: string,
    setId: string,
    dto: UpdatePrescribedSetDto,
    ownerId: string,
  ): Promise<PrescribedSet> {
    const set = await this._loadPrescribedSet(
      programId,
      workoutId,
      exerciseId,
      setId,
      ownerId,
    );
    this._assertSetCoherent({ ...set.get({ plain: true }), ...dto });

    await set.update({
      ...(dto.setType !== undefined && { setType: dto.setType }),
      ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
      ...(dto.targetRepsMin !== undefined && {
        targetRepsMin: dto.targetRepsMin ?? null,
      }),
      ...(dto.targetRepsMax !== undefined && {
        targetRepsMax: dto.targetRepsMax ?? null,
      }),
      ...(dto.targetWeightKg !== undefined && {
        targetWeightKg: dto.targetWeightKg ?? null,
      }),
      ...(dto.targetWeightPercent1rm !== undefined && {
        targetWeightPercent1rm: dto.targetWeightPercent1rm ?? null,
      }),
      ...(dto.targetDurationSeconds !== undefined && {
        targetDurationSeconds: dto.targetDurationSeconds ?? null,
      }),
      ...(dto.targetDistanceMeters !== undefined && {
        targetDistanceMeters: dto.targetDistanceMeters ?? null,
      }),
      ...(dto.targetRpe !== undefined && {
        targetRpe: dto.targetRpe ?? null,
      }),
      ...(dto.targetRir !== undefined && {
        targetRir: dto.targetRir ?? null,
      }),
      ...(dto.restAfterSeconds !== undefined && {
        restAfterSeconds: dto.restAfterSeconds ?? null,
      }),
      ...(dto.tempo !== undefined && { tempo: dto.tempo ?? null }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
    });
    return set;
  }

  async removeSet(
    programId: string,
    workoutId: string,
    exerciseId: string,
    setId: string,
    ownerId: string,
  ): Promise<void> {
    const set = await this._loadPrescribedSet(
      programId,
      workoutId,
      exerciseId,
      setId,
      ownerId,
    );
    await set.destroy();
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async _loadProgram(id: string, ownerId: string): Promise<Program> {
    const program = await this.programModel.findByPk(id);
    assertOwned(program, ownerId, (p) => p.ownerId, {
      notFoundMessage: 'Program not found.',
      onMismatch: 'hide',
    });
    return program;
  }

  private async _loadWorkout(
    programId: string,
    workoutId: string,
    ownerId: string,
  ): Promise<ProgramWorkout> {
    await this._loadProgram(programId, ownerId);
    const workout = await this.workoutModel.findOne({
      where: { id: workoutId, programId },
    });
    if (!workout) {
      throw new NotFoundException('Workout not found.');
    }
    return workout;
  }

  private async _loadPrescribedExercise(
    programId: string,
    workoutId: string,
    exerciseRowId: string,
    ownerId: string,
  ): Promise<PrescribedExercise> {
    await this._loadWorkout(programId, workoutId, ownerId);
    const row = await this.prescribedExerciseModel.findOne({
      where: { id: exerciseRowId, programWorkoutId: workoutId },
    });
    if (!row) {
      throw new NotFoundException('Exercise slot not found.');
    }
    return row;
  }

  private async _loadPrescribedSet(
    programId: string,
    workoutId: string,
    exerciseRowId: string,
    setId: string,
    ownerId: string,
  ): Promise<PrescribedSet> {
    await this._loadPrescribedExercise(
      programId,
      workoutId,
      exerciseRowId,
      ownerId,
    );
    const set = await this.prescribedSetModel.findOne({
      where: { id: setId, prescribedExerciseId: exerciseRowId },
    });
    if (!set) {
      throw new NotFoundException('Set not found.');
    }
    return set;
  }

  /**
   * The exercise being added to a program must be readable by the
   * caller — SYSTEM, their own, or a PUBLIC custom by another
   * instructor. Mirror of `ExerciseService.canRead`. Hides existence
   * (404) for PRIVATE rows not owned by the caller.
   */
  private async _assertExerciseUsable(
    exerciseId: string,
    ownerId: string,
  ): Promise<void> {
    const exercise = await this.exerciseModel.findByPk(exerciseId, {
      attributes: ['id', 'source', 'visibility', 'ownerId'],
    });
    if (!exercise) {
      throw new NotFoundException('Exercise not found.');
    }
    const readable =
      exercise.source === ExerciseSource.System ||
      exercise.visibility === ExerciseVisibility.Public ||
      exercise.ownerId === ownerId;
    if (!readable) {
      throw new NotFoundException('Exercise not found.');
    }
  }

  /**
   * Cross-field set coherence — rep range bounds + weight modes.
   * The DB has CHECKs too but a clean 400 reads better than a
   * Postgres exception bubble.
   */
  private _assertSetCoherent(dto: {
    targetRepsMin?: number | null;
    targetRepsMax?: number | null;
    targetWeightKg?: number | null;
    targetWeightPercent1rm?: number | null;
  }): void {
    if (
      dto.targetRepsMin != null &&
      dto.targetRepsMax != null &&
      dto.targetRepsMin > dto.targetRepsMax
    ) {
      throw new BadRequestException(
        'targetRepsMin must not exceed targetRepsMax.',
      );
    }
    if (dto.targetWeightKg != null && dto.targetWeightPercent1rm != null) {
      // Soft warning — we accept both, but flag the mixed signal so
      // FE can show a yellow hint. For V1, reject outright; the FE
      // picker should be single-mode.
      throw new BadRequestException(
        'Pick either targetWeightKg or targetWeightPercent1rm, not both.',
      );
    }
  }

  // `model.max()` returns `unknown` in current Sequelize types. `null`
  // means no rows in scope yet → first row gets index 0. `Number()`
  // coerces the boxed pg return without a TS assertion.
  private async _nextSequenceNumber(programId: string): Promise<number> {
    const last = await this.workoutModel.max('sequenceNumber', {
      where: { programId },
    });
    return last == null ? 0 : Number(last) + 1;
  }

  private async _nextExerciseOrderIndex(workoutId: string): Promise<number> {
    const last = await this.prescribedExerciseModel.max('orderIndex', {
      where: { programWorkoutId: workoutId },
    });
    return last == null ? 0 : Number(last) + 1;
  }

  private async _nextSetOrderIndex(exerciseId: string): Promise<number> {
    const last = await this.prescribedSetModel.max('orderIndex', {
      where: { prescribedExerciseId: exerciseId },
    });
    return last == null ? 0 : Number(last) + 1;
  }
}
