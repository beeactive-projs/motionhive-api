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
import {
  escapeLikeWildcards,
  normalizeSearchTerm,
} from '../../common/utils/search.utils';
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
import { CopyProgramDayDto } from './dto/copy-program-day.dto';
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
  ProgramArchivedFilter,
  ProgramLibrary,
} from './dto/list-programs.query.dto';
import { ReorderProgramWorkoutsDto } from './dto/reorder-program-workouts.dto';
import { UpdatePrescribedExerciseDto } from './dto/update-prescribed-exercise.dto';
import { UpdatePrescribedSetDto } from './dto/update-prescribed-set.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { UpdateProgramWorkoutDto } from './dto/update-program-workout.dto';
import {
  DEFAULT_LOCALE,
  apiError,
  translate,
  translatedText,
} from '../../common/i18n';
import type { ErrorKey, Locale } from '../../common/i18n';

/**
 * Temporary week namespace used while repositioning workouts. The
 * unique (program_id, week_index, day_index) index is NOT deferrable,
 * so swaps would collide mid-transaction if final slots were written
 * directly. week_index has no upper CHECK (only >= 0, SMALLINT) and
 * real weeks are DTO-capped at 103, so parking moved rows at
 * `week + 10000` can never clash with a live slot.
 */
const WEEK_PARK_OFFSET = 10_000;

/** Turning `duration_days` back into whole weeks. */
const DAYS_PER_WEEK = 7;

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

    const statuses = this._listStatuses(filter);
    const where = {
      ...ownerScope,
      deletedAt: null,
      ...(statuses ? { status: statuses } : {}),
      ...(filter.isSingleWorkout !== undefined
        ? { isSingleWorkout: filter.isSingleWorkout }
        : {}),
      ...(filter.folder ? { folder: filter.folder } : {}),
      ...(filter.level ? { level: filter.level } : {}),
      // Starter routines are searchable by their name in any language.
      ...(filter.search
        ? {
            [Op.and]: [
              literal(
                `fold_for_search(name || ' ' || translated_names(translations)) LIKE ${this.sequelize.escape(
                  `%${escapeLikeWildcards(normalizeSearchTerm(filter.search).toLowerCase())}%`,
                )}`,
              ),
            ],
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

  /**
   * The status filter of a list: `status` as sent, narrowed by `archived`
   * (`exclude` drops ARCHIVED, `only` keeps nothing else). Undefined when
   * neither is sent, so the default list reads every status as before.
   */
  private _listStatuses(
    filter: ListProgramsQueryDto,
  ): ProgramStatus | { [Op.in]: ProgramStatus[] } | undefined {
    if (!filter.archived || filter.archived === ProgramArchivedFilter.Include) {
      return filter.status;
    }
    const candidates = filter.status
      ? [filter.status]
      : Object.values(ProgramStatus);
    const allowed = candidates.filter((status) =>
      filter.archived === ProgramArchivedFilter.Only
        ? status === ProgramStatus.Archived
        : status !== ProgramStatus.Archived,
    );
    return { [Op.in]: allowed };
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
                    'translations',
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
      notFoundMessage: apiError('workout.programNotFound'),
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
  async duplicateForUser(
    programId: string,
    userId: string,
    /** The copier's language: the copy is named in it. */
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<Program> {
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
    if (!readable) {
      throw new NotFoundException(apiError('workout.programNotFound'));
    }

    return this.sequelize.transaction(async (tx) => {
      const copy = await this.programModel.create(
        {
          ownerId: userId,
          // A copy is the person's own text, so it is written once in their
          // language and carries no translations.
          name: translate(locale, 'content.programCopyName', {
            name: translatedText(source, 'name', locale),
          }),
          description: translatedText(source, 'description', locale),
          kind: source.kind,
          status: ProgramStatus.Draft,
          source: ProgramSource.User,
          isSingleWorkout: source.isSingleWorkout,
          folder: translatedText(source, 'folder', locale),
          goalTags: source.goalTags,
          durationDays: source.durationDays,
          defaultRestSeconds: source.defaultRestSeconds ?? null,
        },
        { transaction: tx },
      );

      for (const w of source.workouts ?? []) {
        const newWorkout = await this.workoutModel.create(
          {
            programId: copy.id,
            name: translatedText(w, 'name', locale),
            notes: translatedText(w, 'notes', locale),
            weekIndex: w.weekIndex,
            dayIndex: w.dayIndex,
            sequenceNumber: w.sequenceNumber,
            phase: w.phase,
            estimatedDurationMinutes: w.estimatedDurationMinutes,
            defaultRestSeconds: w.defaultRestSeconds ?? null,
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
              notes: translatedText(ex, 'notes', locale),
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
    await this._reorderRows(rows, dto, 'exercise.notFound');
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
    await this._reorderRows(rows, dto, 'workout.setNotFound');
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
    notFound: ErrorKey,
  ): Promise<void> {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const item of dto.items) {
      if (!byId.has(item.id)) throw new NotFoundException(apiError(notFound));
      if (seen.has(item.id)) {
        throw new BadRequestException(apiError('workout.reorderDuplicate'));
      }
      seen.add(item.id);
    }

    const targetById = new Map(dto.items.map((i) => [i.id, i.orderIndex]));
    const taken = new Set<number>();
    for (const row of rows) {
      const index = targetById.get(row.id) ?? row.orderIndex;
      if (taken.has(index)) {
        throw new ConflictException(
          apiError('workout.reorderPositionClash', { position: index + 1 }),
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
      throw new BadRequestException(apiError('workout.copyWeekSameWeek'));
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
      throw new BadRequestException(apiError('workout.weekEmpty'));
    }

    return this.sequelize.transaction(async (tx) => {
      // CASCADE on the FK takes the nested exercises and sets with them.
      await this.workoutModel.destroy({
        where: { programId, weekIndex: dto.toWeekIndex },
        transaction: tx,
      });

      const copied: ProgramWorkout[] = [];
      for (const w of source) {
        copied.push(
          await this._cloneWorkoutInto(
            w,
            programId,
            dto.toWeekIndex,
            w.dayIndex,
            tx,
          ),
        );
      }
      await this._resequence(programId, tx);
      return copied;
    });
  }

  /**
   * Copy one day's training into the same day slot of other weeks.
   *
   * "Make Monday the same for weeks 2 to 5" — the day-level twin of
   * `copyWeek`, and multi-target for the same reason: one request per week
   * would walk the same tree repeatedly and trip the throttle.
   *
   * Replaces whatever occupies the target slot, exactly as `copyWeek`
   * replaces a week. One rule for both, so a coach never has to remember
   * which verb merges and which overwrites — the UI states the count of
   * days it is about to replace before committing.
   */
  async copyDay(
    programId: string,
    dto: CopyProgramDayDto,
    ownerId: string,
  ): Promise<ProgramWorkout[]> {
    await this._loadProgram(programId, ownerId);

    const toDayIndex = dto.toDayIndex ?? dto.dayIndex;
    const movingDay = toDayIndex !== dto.dayIndex;

    // Landing on a different day is only meaningful for one week: across a
    // block it would mean "which day?" once per week, which is a different
    // feature. Rejected rather than guessed at.
    if (movingDay && dto.toWeekIndexes.length > 1) {
      throw new BadRequestException(apiError('workout.copyDayOneWeek'));
    }

    // Same slot is a copy onto itself; a different day in the same week is a
    // real target, so the source week only drops out when the day matches.
    const targets = [...new Set(dto.toWeekIndexes)].filter(
      (w) => movingDay || w !== dto.fromWeekIndex,
    );
    if (!targets.length) {
      throw new BadRequestException(apiError('workout.copyDayNoTarget'));
    }

    const source = await this.workoutModel.findOne({
      where: {
        programId,
        weekIndex: dto.fromWeekIndex,
        dayIndex: dto.dayIndex,
      },
      include: [
        {
          model: PrescribedExercise,
          as: 'exercises',
          required: false,
          include: [{ model: PrescribedSet, as: 'sets', required: false }],
        },
      ],
    });
    if (!source) {
      throw new BadRequestException(apiError('workout.dayEmpty'));
    }

    return this.sequelize.transaction(async (tx) => {
      // CASCADE on the FK takes the nested exercises and sets with them.
      await this.workoutModel.destroy({
        where: { programId, weekIndex: targets, dayIndex: toDayIndex },
        transaction: tx,
      });

      const copied: ProgramWorkout[] = [];
      for (const weekIndex of targets) {
        copied.push(
          await this._cloneWorkoutInto(
            source,
            programId,
            weekIndex,
            toDayIndex,
            tx,
          ),
        );
      }
      await this._resequence(programId, tx);
      return copied;
    });
  }

  /**
   * Repeat the weeks already built into the empty ones after them.
   *
   * The block is every week up to the last one holding work — rest weeks
   * inside it included — and it cycles: a 3-week block on a 10-week
   * program fills weeks 4–10 as 1, 2, 3, 1, 2, 3, 1. Only weeks past the
   * block are written, and those are empty by definition, so nothing a
   * coach built is ever replaced and running it twice changes nothing.
   */
  async repeatWeeks(programId: string, ownerId: string): Promise<Program> {
    const program = await this._loadProgram(programId, ownerId);
    if (program.isSingleWorkout) {
      throw new BadRequestException(apiError('workout.routineNoWeeksToRepeat'));
    }
    if (!program.durationDays) {
      throw new BadRequestException(apiError('workout.programNeedsLength'));
    }
    const totalWeeks = Math.ceil(program.durationDays / DAYS_PER_WEEK);

    const built = await this.workoutModel.findAll({
      where: { programId },
      include: [
        {
          model: PrescribedExercise,
          as: 'exercises',
          required: false,
          include: [{ model: PrescribedSet, as: 'sets', required: false }],
        },
      ],
    });
    if (!built.length) {
      throw new BadRequestException(apiError('workout.nothingToRepeat'));
    }

    const blockLength = Math.max(...built.map((w) => w.weekIndex)) + 1;
    if (blockLength < totalWeeks) {
      const byWeek = new Map<number, ProgramWorkout[]>();
      for (const w of built) {
        byWeek.set(w.weekIndex, [...(byWeek.get(w.weekIndex) ?? []), w]);
      }

      await this.sequelize.transaction(async (tx) => {
        for (let week = blockLength; week < totalWeeks; week++) {
          for (const source of byWeek.get(week % blockLength) ?? []) {
            await this._cloneWorkoutInto(
              source,
              programId,
              week,
              source.dayIndex,
              tx,
            );
          }
        }
        await this._resequence(programId, tx);
      });
    }

    return this.findById(programId, ownerId);
  }

  /**
   * Remove one week and close the gap.
   *
   * Its days are deleted, every later week moves up one, and a declared
   * length loses a week with it — a program that kept its length would
   * simply grow an empty week at the end, which is not what "delete" means.
   */
  async deleteWeek(
    programId: string,
    weekIndex: number,
    ownerId: string,
  ): Promise<Program> {
    const program = await this._loadProgram(programId, ownerId);
    if (program.isSingleWorkout) {
      throw new BadRequestException(apiError('workout.routineNoWeeksToDelete'));
    }

    const workouts = await this.workoutModel.findAll({
      where: { programId },
      attributes: ['id', 'weekIndex'],
    });
    const declared = program.durationDays
      ? Math.ceil(program.durationDays / DAYS_PER_WEEK)
      : 0;
    const used = workouts.reduce((max, w) => Math.max(max, w.weekIndex + 1), 0);
    const totalWeeks = Math.max(declared, used);

    if (weekIndex < 0 || weekIndex >= totalWeeks) {
      throw new NotFoundException(apiError('workout.weekNotFound'));
    }
    if (totalWeeks <= 1) {
      throw new BadRequestException(apiError('workout.programNeedsOneWeek'));
    }

    const doomed = workouts.filter((w) => w.weekIndex === weekIndex).length;
    if (doomed > 0) {
      const live = await this._countLiveAssignments(programId);
      if (live > 0) {
        throw new ConflictException(
          apiError('workout.cannotDeleteLiveWeek', {
            clients: live,
            week: weekIndex + 1,
            days: doomed,
          }),
        );
      }
    }

    const laterWeeks = [
      ...new Set(
        workouts.filter((w) => w.weekIndex > weekIndex).map((w) => w.weekIndex),
      ),
    ].sort((a, b) => a - b);

    await this.sequelize.transaction(async (tx) => {
      // Exercises and sets cascade from program_workout.
      await this.workoutModel.destroy({
        where: { programId, weekIndex },
        transaction: tx,
      });
      // Ascending, one week at a time: each lands in the slot the one
      // before it just left, so the unique (week, day) index never sees
      // two rows in the same place.
      for (const week of laterWeeks) {
        await this.workoutModel.update(
          { weekIndex: week - 1 },
          { where: { programId, weekIndex: week }, transaction: tx },
        );
      }
      if (program.durationDays) {
        await program.update(
          {
            durationDays: Math.max(
              DAYS_PER_WEEK,
              program.durationDays - DAYS_PER_WEEK,
            ),
          },
          { transaction: tx },
        );
      }
      await this._resequence(programId, tx);
    });

    return this.findById(programId, ownerId);
  }

  /**
   * Keep `sequenceNumber` in calendar order. Assignments deal workouts out
   * by it, and a cloned workout arrives carrying its source's number.
   */
  private async _resequence(programId: string, tx: Transaction): Promise<void> {
    const rows = await this.workoutModel.findAll({
      where: { programId },
      attributes: ['id', 'weekIndex', 'dayIndex', 'sequenceNumber'],
      order: [
        ['weekIndex', 'ASC'],
        ['dayIndex', 'ASC'],
      ],
      transaction: tx,
    });
    for (const [index, row] of rows.entries()) {
      if (row.sequenceNumber !== index) {
        await row.update({ sequenceNumber: index }, { transaction: tx });
      }
    }
  }

  private _countLiveAssignments(programId: string): Promise<number> {
    return this.assignmentModel.count({
      where: {
        masterProgramId: programId,
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

  /**
   * Deep-copies one workout — its exercises and their sets — into a given
   * week/day slot. Shared by `copyWeek` and `copyDay` so the two can never
   * drift on which columns travel with a copy.
   */
  private async _cloneWorkoutInto(
    source: ProgramWorkout,
    programId: string,
    weekIndex: number,
    dayIndex: number,
    tx: Transaction,
  ): Promise<ProgramWorkout> {
    const newWorkout = await this.workoutModel.create(
      {
        programId,
        name: source.name,
        notes: source.notes,
        weekIndex,
        dayIndex,
        sequenceNumber: source.sequenceNumber,
        phase: source.phase,
        estimatedDurationMinutes: source.estimatedDurationMinutes,
        defaultRestSeconds: source.defaultRestSeconds ?? null,
      },
      { transaction: tx },
    );

    for (const ex of source.exercises ?? []) {
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
    return newWorkout;
  }

  async create(
    dto: CreateProgramDto,
    ownerId: string,
    isInstructor: boolean,
  ): Promise<Program> {
    if (dto.exercises?.length && !dto.isSingleWorkout) {
      throw new BadRequestException(apiError('workout.exercisesOnlyOnRoutine'));
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
      defaultRestSeconds: dto.defaultRestSeconds ?? null,
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
    // A superset is two or three exercises. A group sent with one member
    // (its pair was removed in the editor) is no superset: written unlinked.
    const groupSizes = new Map<number, number>();
    for (const ex of exercises) {
      if (ex.supersetGroupId == null) continue;
      groupSizes.set(
        ex.supersetGroupId,
        (groupSizes.get(ex.supersetGroupId) ?? 0) + 1,
      );
    }
    for (const [index, ex] of exercises.entries()) {
      const linked =
        ex.supersetGroupId != null &&
        (groupSizes.get(ex.supersetGroupId) ?? 0) > 1;
      const created = await this.prescribedExerciseModel.create(
        {
          programWorkoutId,
          exerciseId: ex.exerciseId,
          orderIndex: index,
          supersetGroupId: linked ? ex.supersetGroupId : null,
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

  /**
   * Drop the weeks a shortened program no longer has room for.
   *
   * Refused outright while anyone is mid-program: their `assigned_*` rows
   * are their own copies and survive, but the master they were cut from
   * would no longer contain the weeks they are still training, so the
   * coach's view of the plan and the client's would disagree.
   */
  private async _shrinkToDuration(
    program: Program,
    durationDays: number | null | undefined,
  ): Promise<void> {
    if (!durationDays) return;
    const weeks = Math.ceil(durationDays / DAYS_PER_WEEK);

    const doomed = await this.workoutModel.count({
      where: { programId: program.id, weekIndex: { [Op.gte]: weeks } },
    });
    if (doomed === 0) return;

    const live = await this._countLiveAssignments(program.id);
    if (live > 0) {
      throw new ConflictException(
        apiError('workout.cannotShortenLiveProgram', {
          clients: live,
          weeks,
          days: doomed,
        }),
      );
    }

    // Exercises and sets cascade from program_workout.
    await this.workoutModel.destroy({
      where: { programId: program.id, weekIndex: { [Op.gte]: weeks } },
    });
  }

  async update(
    id: string,
    dto: UpdateProgramDto,
    ownerId: string,
  ): Promise<Program> {
    const program = await this._loadProgram(id, ownerId);

    if (dto.exercises && !program.isSingleWorkout) {
      throw new BadRequestException(apiError('workout.exercisesOnlyOnRoutine'));
    }

    // Shortening a program is a real edit, not a relabel: the weeks that
    // no longer fit have to go, or `duration_days` would claim a length the
    // workouts contradict and every client's end date would be wrong.
    if (dto.durationDays !== undefined && !program.isSingleWorkout) {
      await this._shrinkToDuration(program, dto.durationDays);
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
            apiError('workout.routineHasNoWorkout'),
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
      ...(dto.defaultRestSeconds !== undefined && {
        defaultRestSeconds: dto.defaultRestSeconds ?? null,
      }),
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
        apiError('workout.slotTaken', {
          week: dto.weekIndex + 1,
          day: dto.dayIndex + 1,
        }),
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
      defaultRestSeconds: dto.defaultRestSeconds ?? null,
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
        throw new NotFoundException(apiError('workout.workoutNotFound'));
      }
      if (seenIds.has(item.id)) {
        throw new BadRequestException(apiError('workout.reorderDuplicate'));
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
          apiError('workout.slotClash', { week: week + 1, day: day + 1 }),
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
          apiError('workout.slotTaken', {
            week: targetWeek + 1,
            day: targetDay + 1,
          }),
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
      ...(dto.defaultRestSeconds !== undefined && {
        defaultRestSeconds: dto.defaultRestSeconds ?? null,
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
            // Exercise-level rest lives on its sets; there is no column.
            restAfterSeconds: dto.restAfterSeconds ?? null,
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

    const previousGroup = row.supersetGroupId;
    await this.sequelize.transaction(async (tx) => {
      await row.update(
        {
          ...(dto.exerciseId !== undefined && { exerciseId: dto.exerciseId }),
          ...(dto.blockId !== undefined && { blockId: dto.blockId ?? null }),
          // Null unlinks it from its superset.
          ...(dto.supersetGroupId !== undefined && {
            supersetGroupId: dto.supersetGroupId ?? null,
          }),
          ...(dto.orderIndex !== undefined && { orderIndex: dto.orderIndex }),
          ...(dto.notes !== undefined && {
            notes: dto.notes?.trim() || null,
          }),
          ...(dto.alternateExerciseId !== undefined && {
            alternateExerciseId: dto.alternateExerciseId ?? null,
          }),
        },
        { transaction: tx },
      );

      // Exercise-level rest has no column of its own: it is the rest of
      // every one of its sets, set together.
      if (dto.restAfterSeconds !== undefined) {
        await this.prescribedSetModel.update(
          { restAfterSeconds: dto.restAfterSeconds ?? null },
          { where: { prescribedExerciseId: row.id }, transaction: tx },
        );
      }

      // Unlinked or moved to another superset: the one it left may now be
      // a single exercise, which is no superset.
      if (
        dto.supersetGroupId !== undefined &&
        previousGroup != null &&
        previousGroup !== (dto.supersetGroupId ?? null)
      ) {
        await this._dissolveLoneSuperset(workoutId, previousGroup, tx);
      }
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
    const group = row.supersetGroupId;
    await this.sequelize.transaction(async (tx) => {
      await row.destroy({ transaction: tx });
      // Removing one of a pair removes the link from the other.
      if (group != null) {
        await this._dissolveLoneSuperset(workoutId, group, tx);
      }
    });
  }

  /**
   * A superset is two or three exercises. When one leaves and a single
   * exercise is left with the group id, that exercise goes back to
   * standalone. Same transaction as the change that left it alone.
   */
  private async _dissolveLoneSuperset(
    workoutId: string,
    groupId: number,
    tx: Transaction,
  ): Promise<void> {
    const members = await this.prescribedExerciseModel.findAll({
      where: { programWorkoutId: workoutId, supersetGroupId: groupId },
      attributes: ['id'],
      transaction: tx,
    });
    if (members.length !== 1) return;
    await this.prescribedExerciseModel.update(
      { supersetGroupId: null },
      { where: { id: members[0].id }, transaction: tx },
    );
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
      notFoundMessage: apiError('workout.programNotFound'),
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
      throw new NotFoundException(apiError('workout.workoutNotFound'));
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
      throw new NotFoundException(apiError('exercise.notFound'));
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
      throw new NotFoundException(apiError('workout.setNotFound'));
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
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    const readable =
      exercise.source === ExerciseSource.System ||
      exercise.visibility === ExerciseVisibility.Public ||
      exercise.ownerId === ownerId;
    if (!readable) {
      throw new NotFoundException(apiError('exercise.notFound'));
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
      throw new BadRequestException(apiError('workout.repRangeInvalid'));
    }
    if (dto.targetWeightKg != null && dto.targetWeightPercent1rm != null) {
      // Soft warning — we accept both, but flag the mixed signal so
      // FE can show a yellow hint. For V1, reject outright; the FE
      // picker should be single-mode.
      throw new BadRequestException(apiError('workout.weightModeConflict'));
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
