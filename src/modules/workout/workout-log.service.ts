import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import {
  buildPaginatedResponse,
  getOffset,
} from '../../common/dto/pagination.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { escapeLikeWildcards } from '../../common/utils/search.utils';
import { ListWorkoutLogsQueryDto } from './dto/list-workout-logs.query.dto';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import { ExerciseVisibility } from '../exercise/entities/exercise.enums';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { LoggedExercise } from './entities/logged-exercise.entity';
import { LoggedSet } from './entities/logged-set.entity';
import { OneRepMax } from './entities/one-rep-max.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import {
  ExerciseSetType,
  OneRepMaxSource,
  ProgramSource,
  ProgramStatus,
  WorkoutLogStatus,
} from './entities/workout.enums';
import { CompleteWorkoutDto } from './dto/complete-workout.dto';
import { LogSetDto } from './dto/log-set.dto';
import { RecordOneRepMaxDto } from './dto/record-one-rep-max.dto';
import { StartWorkoutDto } from './dto/start-workout.dto';
import {
  SaveLogAsRoutineDto,
  SaveRoutineMode,
} from './dto/save-log-as-routine.dto';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { clientCompletedWorkoutForInstructor } from './notifications';

/**
 * WorkoutLogService — the client-side surface. Three core flows:
 *
 *   1. **Start** — `start({assignedWorkoutId?})` creates a WorkoutLog
 *      and (when assigned) hydrates the entire log tree from the
 *      assignment, resolving every %1RM-targeted set against the
 *      latest one_rep_max for (client, exercise). Single transaction.
 *
 *   2. **Log a set** — `logSet(workoutLogId, setId, dto)` updates one
 *      logged_set row. Mark-complete-only is valid (locked §11).
 *
 *   3. **Complete** — `complete(workoutLogId, dto)` computes duration,
 *      flips status, mirrors to the assigned_workout, updates the
 *      assignment's completion_percent, and optionally auto-suggests
 *      a 1RM from a heavy logged set via Epley.
 */
@Injectable()
export class WorkoutLogService {
  constructor(
    @InjectModel(WorkoutLog) private readonly logModel: typeof WorkoutLog,
    @InjectModel(LoggedExercise)
    private readonly loggedExerciseModel: typeof LoggedExercise,
    @InjectModel(LoggedSet)
    private readonly loggedSetModel: typeof LoggedSet,
    @InjectModel(AssignedWorkout)
    private readonly assignedWorkoutModel: typeof AssignedWorkout,
    @InjectModel(AssignedExercise)
    private readonly assignedExerciseModel: typeof AssignedExercise,
    @InjectModel(AssignedSet)
    private readonly assignedSetModel: typeof AssignedSet,
    @InjectModel(OneRepMax) private readonly oneRepMaxModel: typeof OneRepMax,
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
    @InjectModel(Program) private readonly programModel: typeof Program,
    @InjectModel(PrescribedExercise)
    private readonly prescribedExerciseModel: typeof PrescribedExercise,
    @InjectModel(PrescribedSet)
    private readonly prescribedSetModel: typeof PrescribedSet,
    @InjectModel(ProgramWorkout)
    private readonly programWorkoutModel: typeof ProgramWorkout,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(ProgramAssignment)
    private readonly assignmentModel: typeof ProgramAssignment,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly notificationService: NotificationService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Start
  // ────────────────────────────────────────────────────────────────────

  async start(userId: string, dto: StartWorkoutDto): Promise<WorkoutLog> {
    if (dto.assignedWorkoutId && dto.programId) {
      throw new BadRequestException(
        'Pass either assignedWorkoutId or programId, not both.',
      );
    }

    if (dto.programId) {
      return this._startFromProgram(userId, dto.programId);
    }

    if (!dto.assignedWorkoutId && !dto.name?.trim()) {
      throw new BadRequestException(
        'Freestyle workouts require a name; assigned workouts require assignedWorkoutId.',
      );
    }

    if (!dto.assignedWorkoutId) {
      // Freestyle — minimal create, exercises added via separate flow (V2).
      return this.logModel.create({
        userId,
        programAssignmentId: null,
        assignedWorkoutId: null,
        name: dto.name!.trim(),
        status: WorkoutLogStatus.InProgress,
      });
    }

    const aw = await this.assignedWorkoutModel.findByPk(dto.assignedWorkoutId, {
      include: [
        {
          model: AssignedExercise,
          as: 'exercises',
          separate: true,
          order: [['orderIndex', 'ASC']],
          include: [
            {
              model: Exercise,
              as: 'exercise',
              attributes: ['id', 'name', 'thumbnailUrl'],
            },
            {
              model: AssignedSet,
              as: 'sets',
              separate: true,
              order: [['orderIndex', 'ASC']],
            },
          ],
        },
      ],
    });
    if (!aw) {
      throw new NotFoundException('Assigned workout not found.');
    }

    // Authorization: the assigned workout must belong to an assignment
    // whose client is the caller. We do the cheap check via raw join
    // to avoid pulling the whole assignment row.
    const ownsAssignment = await this.assignedWorkoutOwnedByClient(
      aw.id,
      userId,
    );
    if (!ownsAssignment) {
      throw new NotFoundException('Assigned workout not found.');
    }

    // Compute %1RM resolutions once, batched by exercise.
    const oneRmMap = await this.fetchLatestOneRepMaxesForExercises(
      userId,
      (aw.exercises ?? []).map((e) => e.exerciseId),
    );

    return this.sequelize.transaction(async (tx) => {
      const log = await this.logModel.create(
        {
          userId,
          programAssignmentId: aw.programAssignmentId,
          assignedWorkoutId: aw.id,
          name: aw.name,
          status: WorkoutLogStatus.InProgress,
        },
        { transaction: tx },
      );

      // Mirror status onto the assignment-side workout — drives the
      // "Today's workout" preview "in progress" state on the client.
      await aw.update(
        { status: WorkoutLogStatus.InProgress },
        { transaction: tx },
      );

      for (const ae of aw.exercises ?? []) {
        const le = await this.loggedExerciseModel.create(
          {
            workoutLogId: log.id,
            exerciseId: ae.exerciseId,
            assignedExerciseId: ae.id,
            exerciseNameSnapshot: ae.exercise?.name ?? 'Exercise',
            exerciseThumbnailUrlSnapshot: ae.exercise?.thumbnailUrl ?? null,
            orderIndex: ae.orderIndex,
            supersetGroupId: ae.supersetGroupId,
            notes: null,
          },
          { transaction: tx },
        );

        // Resolve every set with target_weight_percent_1rm against the
        // user's latest 1RM and stamp the resolved kg back onto the
        // assigned_set row. Same tx so a rollback unwinds the stamp.
        for (const aset of ae.sets ?? []) {
          if (
            aset.targetWeightPercent1rm != null &&
            aset.targetWeightKg == null
          ) {
            const oneRm = oneRmMap.get(ae.exerciseId);
            if (oneRm != null) {
              const resolved =
                Math.round(
                  ((aset.targetWeightPercent1rm * oneRm) / 100) * 100,
                ) / 100;
              await aset.update(
                { resolvedWeightKg: resolved, resolvedAt: new Date() },
                { transaction: tx },
              );
            }
          }
        }

        // Pre-seed logged_set rows mirroring the assigned plan so the
        // client just ticks them off (one row per planned set).
        const sets = ae.sets ?? [];
        if (sets.length) {
          await this.loggedSetModel.bulkCreate(
            sets.map((aset) => ({
              loggedExerciseId: le.id,
              assignedSetId: aset.id,
              orderIndex: aset.orderIndex,
              setType: aset.setType,
              isCompleted: false,
            })),
            { transaction: tx },
          );
        }
      }

      return log;
    });
  }

  /**
   * Start a program directly, with no assignment in between. This is the
   * on-demand path for single-workout programs (what the UI calls a
   * routine) and it is deliberately kept: making someone self-assign
   * before they can train would be indirection for its own sake.
   *
   * Reads the prescription tree rather than an assigned copy, so targets
   * are whatever the program says right now. Nothing is snapshotted onto
   * logged_set — the program is mutable and the UI shows its numbers as
   * placeholders, not commitments.
   *
   * Only the first workout is seeded. Running a multi-week program ad hoc
   * means "do day one"; scheduling it properly is what self-assignment is
   * for.
   */
  private async _startFromProgram(
    userId: string,
    programId: string,
  ): Promise<WorkoutLog> {
    const program = await this.programModel.findByPk(programId, {
      include: [
        {
          model: ProgramWorkout,
          as: 'workouts',
          separate: true,
          order: [['sequenceNumber', 'ASC']],
          limit: 1,
        },
      ],
    });

    // Visible if you own it, or if it is a MotionHive starter program.
    const readable =
      program &&
      (program.ownerId === userId || program.source === ProgramSource.System);
    if (!readable) {
      throw new NotFoundException('Program not found.');
    }

    const workout = program.workouts?.[0];
    if (!workout) {
      throw new BadRequestException(
        'This program has no workouts yet, so there is nothing to start.',
      );
    }

    const pxs = await this.prescribedExerciseModel.findAll({
      where: { programWorkoutId: workout.id },
      order: [['orderIndex', 'ASC']],
      include: [
        {
          model: Exercise,
          as: 'exercise',
          attributes: ['id', 'name', 'thumbnailUrl'],
        },
        {
          model: PrescribedSet,
          as: 'sets',
          separate: true,
          order: [['orderIndex', 'ASC']],
        },
      ],
    });

    const created = await this.sequelize.transaction(async (tx) => {
      const log = await this.logModel.create(
        {
          userId,
          programAssignmentId: null,
          assignedWorkoutId: null,
          // What makes this a routine session rather than a freestyle
          // one. Both used to write nothing here and were then
          // indistinguishable in history.
          sourceProgramId: program.id,
          name: program.isSingleWorkout ? program.name : workout.name,
          status: WorkoutLogStatus.InProgress,
        },
        { transaction: tx },
      );

      for (const px of pxs) {
        const le = await this.loggedExerciseModel.create(
          {
            workoutLogId: log.id,
            exerciseId: px.exerciseId,
            assignedExerciseId: null,
            prescribedExerciseId: px.id,
            exerciseNameSnapshot: px.exercise?.name ?? 'Exercise',
            exerciseThumbnailUrlSnapshot: px.exercise?.thumbnailUrl ?? null,
            orderIndex: px.orderIndex,
            supersetGroupId: px.supersetGroupId,
            notes: px.notes,
          },
          { transaction: tx },
        );

        const setCount = Math.max(1, px.sets?.length ?? 1);
        await this.loggedSetModel.bulkCreate(
          Array.from({ length: setCount }, (_, i) => ({
            loggedExerciseId: le.id,
            assignedSetId: null,
            prescribedSetId: px.sets?.[i]?.id ?? null,
            orderIndex: i,
            setType: px.sets?.[i]?.setType ?? ExerciseSetType.Normal,
            isCompleted: false,
          })),
          { transaction: tx },
        );
      }

      return log;
    });

    // Best-effort. The log is the source of truth, so a failure here must
    // not roll back a workout the person has already started.
    //
    // Skipped for MotionHive starters: `lastPerformedAt` lives on the
    // program row, and a starter is one shared row across every account.
    // Bumping it made one person's session show up as "Last done today"
    // in every other user's list — wrong, and a small leak of a
    // stranger's activity.
    try {
      if (program.source !== ProgramSource.System) {
        await program.update({ lastPerformedAt: new Date() });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to bump lastPerformedAt for program ${program.id}: ${(err as Error).message}`,
        'WorkoutLogService',
      );
    }

    return created;
  }

  /**
   * Turn a finished workout into a repeatable routine.
   *
   * This is the moment an improvised session becomes something you can
   * run again, and for someone training without a coach it's the main
   * reason to keep logging here rather than in a notes app.
   *
   * Writes a single-workout program owned by the caller, which is the
   * same shape a coach's program has — so it can later be scheduled,
   * edited, or grown into a block without converting anything.
   *
   * Skipped exercises are left out: you didn't do them, so they don't
   * belong in the thing you plan to repeat.
   */
  async saveLogAsRoutine(
    workoutLogId: string,
    userId: string,
    dto: SaveLogAsRoutineDto,
  ): Promise<Program> {
    const log = await this._loadOwnedLog(workoutLogId, userId);

    const loggedExercises = await this.loggedExerciseModel.findAll({
      where: { workoutLogId: log.id, isSkipped: false },
      order: [['orderIndex', 'ASC']],
      include: [
        {
          model: LoggedSet,
          as: 'sets',
          separate: true,
          order: [['orderIndex', 'ASC']],
        },
      ],
    });

    if (!loggedExercises.length) {
      throw new BadRequestException(
        'This workout has no exercises to save as a routine.',
      );
    }

    const bakeTargets =
      (dto.mode ?? SaveRoutineMode.Targets) === SaveRoutineMode.Targets;

    return this.sequelize.transaction(async (tx) => {
      const program = await this.programModel.create(
        {
          ownerId: userId,
          source: ProgramSource.User,
          isSingleWorkout: true,
          name: dto.name.trim(),
          folder: dto.folder?.trim() || null,
          kind: 'WORKOUT',
          status: ProgramStatus.Published,
        },
        { transaction: tx },
      );

      const workout = await this.programWorkoutModel.create(
        {
          programId: program.id,
          name: dto.name.trim(),
          weekIndex: 0,
          dayIndex: 0,
          sequenceNumber: 0,
        },
        { transaction: tx },
      );

      for (const [index, le] of loggedExercises.entries()) {
        // An exercise whose catalog row was deleted can't be prescribed
        // again — the log keeps its name snapshot, but there is nothing
        // to point a routine at.
        if (!le.exerciseId) continue;

        const px = await this.prescribedExerciseModel.create(
          {
            programWorkoutId: workout.id,
            exerciseId: le.exerciseId,
            orderIndex: index,
            supersetGroupId: le.supersetGroupId,
            notes: le.notes,
          },
          { transaction: tx },
        );

        const sets = le.sets ?? [];
        const rows = (sets.length ? sets : [null]).map((s, i) => ({
          prescribedExerciseId: px.id,
          orderIndex: i,
          setType: s?.setType ?? ExerciseSetType.Normal,
          // What you hit becomes what you aim at next time. Reps map to
          // both ends of the range so the target reads as a number, not
          // a span you didn't ask for.
          targetRepsMin: bakeTargets ? (s?.reps ?? null) : null,
          targetRepsMax: bakeTargets ? (s?.reps ?? null) : null,
          targetWeightKg: bakeTargets ? (s?.weightKg ?? null) : null,
          targetDurationSeconds: bakeTargets
            ? (s?.durationSeconds ?? null)
            : null,
          targetDistanceMeters: bakeTargets
            ? (s?.distanceMeters ?? null)
            : null,
          restAfterSeconds: s?.restAfterSeconds ?? null,
        }));

        await this.prescribedSetModel.bulkCreate(rows, { transaction: tx });
      }

      return program;
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Per-set log
  // ────────────────────────────────────────────────────────────────────

  async logSet(
    workoutLogId: string,
    setId: string,
    dto: LogSetDto,
    userId: string,
  ): Promise<LoggedSet> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Cannot log sets on a workout that is no longer in progress.',
      );
    }
    const set = await this.loggedSetModel.findByPk(setId, {
      include: [
        { model: LoggedExercise, as: 'exercise', attributes: ['workoutLogId'] },
      ],
    });
    if (!set || set.exercise?.workoutLogId !== workoutLogId) {
      throw new NotFoundException('Set not found.');
    }
    await set.update({
      ...(dto.setType !== undefined && { setType: dto.setType }),
      ...(dto.reps !== undefined && { reps: dto.reps ?? null }),
      ...(dto.weightKg !== undefined && { weightKg: dto.weightKg ?? null }),
      ...(dto.durationSeconds !== undefined && {
        durationSeconds: dto.durationSeconds ?? null,
      }),
      ...(dto.distanceMeters !== undefined && {
        distanceMeters: dto.distanceMeters ?? null,
      }),
      ...(dto.rpe !== undefined && { rpe: dto.rpe ?? null }),
      ...(dto.rir !== undefined && { rir: dto.rir ?? null }),
      ...(dto.restAfterSeconds !== undefined && {
        restAfterSeconds: dto.restAfterSeconds ?? null,
      }),
      ...(dto.isCompleted !== undefined && {
        isCompleted: dto.isCompleted,
        completedAt: dto.isCompleted ? new Date() : null,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
    });
    return set;
  }

  // ────────────────────────────────────────────────────────────────────
  // Add / remove exercise mid-session (freestyle + S14 affordances)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Append a catalog exercise to a logged session. Used by:
   *   - freestyle workouts (no assignment) building one exercise at a time
   *   - assigned workouts where the client adds an extra exercise
   *
   * The exercise must be readable (SYSTEM, owned, or PUBLIC custom);
   * the `prescribed`-style ownership check lives on the catalog model.
   * Snapshots name + thumbnail at write time so historical logs survive
   * catalog renames/deletes (matches the `start` flow).
   */
  async addExerciseToLog(
    workoutLogId: string,
    exerciseId: string,
    userId: string,
    defaultSets = 0,
  ): Promise<LoggedExercise> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Cannot add exercises to a workout that is no longer in progress.',
      );
    }
    const exercise = await this.exerciseModel.findByPk(exerciseId, {
      attributes: ['id', 'name', 'thumbnailUrl', 'visibility', 'ownerId'],
    });
    if (
      !exercise ||
      (exercise.visibility === 'PRIVATE' && exercise.ownerId !== userId)
    ) {
      throw new NotFoundException('Exercise not found.');
    }
    // Append at the end of the existing order.
    const last = await this.loggedExerciseModel.max('orderIndex', {
      where: { workoutLogId },
    });
    const orderIndex = last == null ? 0 : Number(last) + 1;
    // The empty sets ride along in the same transaction: the logger used
    // to add them one request at a time after the exercise landed.
    return this.sequelize.transaction(async (tx) => {
      const created = await this.loggedExerciseModel.create(
        {
          workoutLogId,
          exerciseId,
          assignedExerciseId: null,
          exerciseNameSnapshot: exercise.name,
          exerciseThumbnailUrlSnapshot: exercise.thumbnailUrl,
          orderIndex,
          supersetGroupId: null,
          notes: null,
        },
        { transaction: tx },
      );
      if (defaultSets > 0) {
        await this.loggedSetModel.bulkCreate(
          Array.from({ length: defaultSets }, (_, i) => ({
            loggedExerciseId: created.id,
            assignedSetId: null,
            orderIndex: i,
            setType: 'NORMAL',
            isCompleted: false,
          })),
          { transaction: tx },
        );
      }
      return created;
    });
  }

  /**
   * Remove a logged exercise (and CASCADE its sets) from a session.
   * The S14 "skip exercise" lives on top of this. Refuses on completed
   * logs since they're frozen history.
   */
  async removeExerciseFromLog(
    workoutLogId: string,
    loggedExerciseId: string,
    userId: string,
  ): Promise<void> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Cannot edit a workout that is no longer in progress.',
      );
    }
    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException('Logged exercise not found.');
    }
    await ex.destroy();
  }

  /**
   * Skip an exercise, or undo the skip.
   *
   * Distinct from removing it. A removed exercise leaves no trace, so a
   * coach cannot tell "she skipped my prescribed rows" from "it was
   * never in the workout" — which is what the UI's skip button used to
   * do. A skipped row stays, greys out, and drops out of the progress
   * denominator.
   */
  async setExerciseSkipped(
    workoutLogId: string,
    loggedExerciseId: string,
    userId: string,
    skipped: boolean,
  ): Promise<LoggedExercise> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Cannot edit a workout that is no longer in progress.',
      );
    }
    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException('Logged exercise not found.');
    }
    await ex.update({ isSkipped: skipped });
    return ex;
  }

  /**
   * Substitute one exercise for another mid-workout (machine taken,
   * shoulder complaining). The set rows and whatever has already been
   * logged into them stay put; only the exercise identity changes, and
   * `swappedFromExerciseId` records what it replaced so the coach sees
   * the substitution rather than an unexplained change.
   *
   * Snapshots are rewritten to the new exercise, since they exist to
   * keep history readable and history is now the new movement.
   */
  async swapLoggedExercise(
    workoutLogId: string,
    loggedExerciseId: string,
    userId: string,
    newExerciseId: string,
  ): Promise<LoggedExercise> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Cannot edit a workout that is no longer in progress.',
      );
    }

    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException('Logged exercise not found.');
    }
    if (ex.exerciseId === newExerciseId) {
      throw new BadRequestException(
        'That is already the exercise being logged.',
      );
    }

    const next = await this.exerciseModel.findByPk(newExerciseId);
    // Same usability rule as adding an exercise: someone else's private
    // custom movement is not swappable in.
    if (
      !next ||
      (next.visibility === ExerciseVisibility.Private &&
        next.ownerId !== userId)
    ) {
      throw new NotFoundException('Exercise not found.');
    }

    // Keep the ORIGINAL exercise as the provenance anchor across repeated
    // swaps. Otherwise a second swap would report the first substitute as
    // the prescription, which is not what the coach wrote.
    const swappedFrom = ex.swappedFromExerciseId ?? ex.exerciseId;

    await ex.update({
      exerciseId: next.id,
      swappedFromExerciseId: swappedFrom,
      exerciseNameSnapshot: next.name,
      exerciseThumbnailUrlSnapshot: next.thumbnailUrl ?? null,
    });
    return ex;
  }

  /**
   * Append an empty set to a logged exercise. Used by:
   *   - the per-exercise "+ Add set" CTA (S14)
   *   - freestyle exercises that don't pre-seed any sets
   *
   * Set type defaults to NORMAL; actuals + targets are null until the
   * client logs them via `logSet`.
   */
  async addSetToLog(
    workoutLogId: string,
    loggedExerciseId: string,
    dto: { setType?: string },
    userId: string,
  ): Promise<LoggedSet> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Cannot add sets to a workout that is no longer in progress.',
      );
    }
    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException('Logged exercise not found.');
    }
    const last = await this.loggedSetModel.max('orderIndex', {
      where: { loggedExerciseId },
    });
    const orderIndex = last == null ? 0 : Number(last) + 1;
    return this.loggedSetModel.create({
      loggedExerciseId,
      assignedSetId: null,
      orderIndex,
      setType: dto.setType ?? 'NORMAL',
      isCompleted: false,
    });
  }

  /**
   * "Last time you did this" — most-recent completed log set for this
   * exercise. Powers the `LastTimeHint` component on the active log.
   * Returns up to 6 actual rows (one workout's worth), newest first.
   */
  async lastSessionForExercise(
    userId: string,
    exerciseId: string,
  ): Promise<LoggedSet[]> {
    // Find the most-recent completed logged_exercise row for this user
    // + exercise. Cheaper than a nested include subquery (Sequelize
    // mangles the outer ORDER BY when attributes are restricted).
    const recent = (await this.loggedExerciseModel.findOne({
      where: { exerciseId },
      include: [
        {
          model: WorkoutLog,
          as: 'log',
          required: true,
          where: { userId, status: WorkoutLogStatus.Completed },
          attributes: ['id', 'completedAt'],
        },
      ],
      order: [[{ model: WorkoutLog, as: 'log' }, 'completedAt', 'DESC']],
    })) as (LoggedExercise & { log?: WorkoutLog }) | null;
    if (!recent) return [];
    return this.loggedSetModel.findAll({
      where: { loggedExerciseId: recent.id, isCompleted: true },
      order: [['orderIndex', 'ASC']],
      limit: 6,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Discard
  // ────────────────────────────────────────────────────────────────────

  /**
   * Delete a workout in progress outright. Distinct from SKIPPED, which
   * records that you chose not to train; this leaves no trace.
   */
  async discard(workoutLogId: string, userId: string): Promise<void> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        'Only a workout in progress can be cancelled. Finished workouts stay in your history.',
      );
    }

    const { assignedWorkoutId, programAssignmentId, sourceProgramId } = log;

    await this.sequelize.transaction(async (tx) => {
      // Starting mirrored IN_PROGRESS here; null is "not started yet".
      if (assignedWorkoutId) {
        await this.assignedWorkoutModel.update(
          { status: null },
          { where: { id: assignedWorkoutId }, transaction: tx },
        );
      }
      // logged_exercise and logged_set both cascade from this row.
      await log.destroy({ transaction: tx });
      if (programAssignmentId) {
        await this.recomputeAssignmentProgress(programAssignmentId, tx);
      }
    });

    if (sourceProgramId) await this._resyncLastPerformed(sourceProgramId);
  }

  /**
   * `lastPerformedAt` is stamped on start, so a discard has to walk it
   * back or the routine claims "Last done today". Recomputed from the
   * surviving logs rather than guessed.
   */
  private async _resyncLastPerformed(programId: string): Promise<void> {
    try {
      const program = await this.programModel.findByPk(programId, {
        attributes: ['id', 'source'],
      });
      // Starters share one row across every account, never stamped.
      if (!program || program.source === ProgramSource.System) return;

      const latest = await this.logModel.findOne({
        where: { sourceProgramId: programId },
        order: [['startedAt', 'DESC']],
        attributes: ['startedAt'],
      });
      await this.programModel.update(
        { lastPerformedAt: latest?.startedAt ?? null },
        { where: { id: programId } },
      );
    } catch (err) {
      // Cosmetic field: never fail a discard the person already asked for.
      this.logger.warn(
        `Failed to resync lastPerformedAt for program ${programId}: ${(err as Error).message}`,
        'WorkoutLogService',
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Complete
  // ────────────────────────────────────────────────────────────────────

  async complete(
    workoutLogId: string,
    dto: CompleteWorkoutDto,
    userId: string,
  ): Promise<WorkoutLog> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status === WorkoutLogStatus.Completed) {
      // Idempotent for the status change, but not a no-op: the feedback
      // screen runs after the workout is already complete, so its rating
      // and note arrive on this second call.
      const feedback = {
        ...(dto.feelingRating !== undefined && {
          feelingRating: dto.feelingRating,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      };
      if (Object.keys(feedback).length > 0) await log.update(feedback);
      return log;
    }

    const completedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((completedAt.getTime() - log.startedAt.getTime()) / 1000),
    );

    await this.sequelize.transaction(async (tx) => {
      await log.update(
        {
          status: WorkoutLogStatus.Completed,
          completedAt,
          durationSeconds,
          ...(dto.feelingRating !== undefined && {
            feelingRating: dto.feelingRating,
          }),
          ...(dto.notes !== undefined && {
            notes: dto.notes?.trim() || null,
          }),
        },
        { transaction: tx },
      );

      // Mirror status to the assigned_workout and bump the
      // assignment-wide completion_percent.
      if (log.assignedWorkoutId) {
        await this.assignedWorkoutModel.update(
          { status: WorkoutLogStatus.Completed },
          { where: { id: log.assignedWorkoutId }, transaction: tx },
        );
      }
      if (log.programAssignmentId) {
        await this.recomputeAssignmentProgress(log.programAssignmentId, tx);
      }

      // PR detection — Epley-estimate a 1RM for every loaded set
      // logged in this session and write a new one_rep_max row when it
      // tops the user's prior best for that exercise. The completed-at
      // timestamp on the row is the workout's completedAt so a GET on
      // the log can find the new PRs by time-window.
      await this._writePrsFromLog(log.id, userId, completedAt, tx);
    });

    // notify-after-commit — notify() opens its own transaction, so a
    // rollback above would otherwise orphan the alert.
    await this._notifyInstructorOfCompletion(log, userId);

    return log;
  }

  /**
   * Tell the coach their client trained. Only for assigned work:
   * freestyle training is the client's own business unless they opt
   * into sharing it.
   *
   * Best-effort. A notification failure must never surface as a failed
   * workout completion, since the workout genuinely did complete.
   */
  private async _notifyInstructorOfCompletion(
    log: WorkoutLog,
    userId: string,
  ): Promise<void> {
    if (!log.programAssignmentId) return;

    try {
      const assignment = await this.assignmentModel.findByPk(
        log.programAssignmentId,
      );
      if (!assignment?.instructorId) return;

      const [client, setsCompleted] = await Promise.all([
        this.userModel.findByPk(userId, {
          attributes: ['id', 'firstName', 'lastName'],
        }),
        this.loggedSetModel.count({
          where: { isCompleted: true },
          include: [
            {
              model: LoggedExercise,
              as: 'exercise',
              attributes: [],
              where: { workoutLogId: log.id },
              required: true,
            },
          ],
        }),
      ]);

      const clientName =
        [client?.firstName, client?.lastName].filter(Boolean).join(' ') ||
        'Your client';

      await this.notificationService.notify(
        clientCompletedWorkoutForInstructor({
          instructorId: assignment.instructorId,
          clientId: userId,
          workoutLogId: log.id,
          clientName,
          workoutName: log.name,
          setsCompleted,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to notify instructor of completed workout ${log.id}: ${(err as Error).message}`,
        'WorkoutLogService',
      );
    }
  }

  /**
   * Walk every loaded set in `workoutLogId`, Epley-estimate its 1RM,
   * compare against the user's best for that exercise, and insert a
   * new one_rep_max row when it's a record. Same tx as `complete()`
   * so a rollback unwinds the PRs too.
   */
  private async _writePrsFromLog(
    workoutLogId: string,
    userId: string,
    recordedAt: Date,
    tx: Transaction,
  ): Promise<void> {
    const exercises = await this.loggedExerciseModel.findAll({
      where: { workoutLogId },
      include: [{ model: LoggedSet, as: 'sets' }],
      transaction: tx,
    });

    // Best estimated 1RM per exercise from this session.
    const sessionBest = new Map<string, number>();
    for (const ex of exercises) {
      if (!ex.exerciseId) continue;
      let best = 0;
      for (const s of ex.sets ?? []) {
        if (!s.isCompleted) continue;
        const est = this.estimateOneRepMaxEpley(s.reps, s.weightKg);
        if (est != null && est > best) best = est;
      }
      if (best > 0) sessionBest.set(ex.exerciseId, best);
    }
    if (sessionBest.size === 0) return;

    // Look up prior bests in a single query.
    const priorRows = await this.oneRepMaxModel.findAll({
      where: {
        userId,
        exerciseId: { [Op.in]: Array.from(sessionBest.keys()) },
      },
      attributes: ['exerciseId', 'weightKg'],
      transaction: tx,
    });
    const priorBest = new Map<string, number>();
    for (const r of priorRows) {
      const cur = priorBest.get(r.exerciseId) ?? 0;
      if (r.weightKg > cur) priorBest.set(r.exerciseId, r.weightKg);
    }

    for (const [exerciseId, estimated] of sessionBest) {
      const prior = priorBest.get(exerciseId) ?? 0;
      if (estimated <= prior) continue;
      await this.oneRepMaxModel.create(
        {
          userId,
          exerciseId,
          weightKg: estimated,
          source: OneRepMaxSource.EstimatedEpley,
          recordedAt,
          notes: null,
        },
        { transaction: tx },
      );
    }
  }

  /**
   * Find the one_rep_max rows that were written during this log's
   * session (between startedAt and completedAt, inclusive) so the FE
   * can render them on the workout-complete screen. Returns an empty
   * array when the log isn't completed yet or hit no PRs.
   */
  private async _findSessionPrs(log: WorkoutLog): Promise<
    {
      id: string;
      exerciseId: string;
      exerciseName: string;
      weightKg: number;
      deltaKg: number;
    }[]
  > {
    if (log.status !== WorkoutLogStatus.Completed || !log.completedAt) {
      return [];
    }
    const rows = await this.oneRepMaxModel.findAll({
      where: {
        userId: log.userId,
        source: OneRepMaxSource.EstimatedEpley,
        recordedAt: {
          [Op.gte]: log.startedAt,
          [Op.lte]: log.completedAt,
        },
      },
      include: [
        {
          model: Exercise,
          as: 'exercise',
          attributes: ['id', 'name'],
        },
      ],
    });

    // For the delta, fetch each exercise's previous best (before this
    // PR was set). Cheap query — most workouts hit ≤3 PRs.
    return Promise.all(
      rows.map(async (pr) => {
        const prior = await this.oneRepMaxModel.findOne({
          where: {
            userId: log.userId,
            exerciseId: pr.exerciseId,
            recordedAt: { [Op.lt]: pr.recordedAt },
          },
          order: [['weightKg', 'DESC']],
          attributes: ['weightKg'],
        });
        const deltaKg = prior
          ? Math.round((pr.weightKg - prior.weightKg) * 100) / 100
          : pr.weightKg;
        const exerciseName =
          (pr as unknown as { exercise?: { name?: string } }).exercise?.name ??
          'Exercise';
        return {
          id: pr.id,
          exerciseId: pr.exerciseId,
          exerciseName,
          weightKg: pr.weightKg,
          deltaKg,
        };
      }),
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // One-rep-max
  // ────────────────────────────────────────────────────────────────────

  async recordOneRepMax(
    userId: string,
    dto: RecordOneRepMaxDto,
  ): Promise<OneRepMax> {
    return this.oneRepMaxModel.create({
      userId,
      exerciseId: dto.exerciseId,
      weightKg: dto.weightKg,
      source: dto.source ?? OneRepMaxSource.Manual,
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      notes: dto.notes?.trim() || null,
    });
  }

  async listOneRepMaxes(userId: string, query: PaginationDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { rows, count } = await this.oneRepMaxModel.findAndCountAll({
      where: { userId },
      include: [
        {
          model: Exercise,
          as: 'exercise',
          attributes: ['id', 'name', 'slug', 'kind'],
        },
      ],
      order: [['recordedAt', 'DESC']],
      offset: getOffset(page, limit),
      limit,
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Compute an Epley-estimated 1RM from a single heavy set. Returns
   * null when not enough info (no reps, or no weight, or > 12 reps —
   * Epley breaks down beyond ~10 reps).
   *
   *   1RM ≈ weight × (1 + reps / 30)
   */
  estimateOneRepMaxEpley(
    reps: number | null,
    weightKg: number | null,
  ): number | null {
    if (reps == null || weightKg == null) return null;
    if (reps < 1 || reps > 12 || weightKg <= 0) return null;
    return Math.round(weightKg * (1 + reps / 30) * 100) / 100;
  }

  // ────────────────────────────────────────────────────────────────────
  // List + detail
  // ────────────────────────────────────────────────────────────────────

  /**
   * `iLike` on the session name, with LIKE wildcards escaped — an
   * unescaped `%` would match everything and `_` any character.
   */
  private _nameSearch(search?: string) {
    const term = search?.trim();
    if (!term) return {};
    const escaped = escapeLikeWildcards(term);
    return { name: { [Op.iLike]: `%${escaped}%` } };
  }

  /**
   * @param onlyAssignmentIds when given, restrict to logs belonging to
   * these assignments. Used by the coach surface; the client's own
   * history passes nothing and sees everything.
   */
  async listForUser(
    userId: string,
    query: ListWorkoutLogsQueryDto,
    onlyAssignmentIds?: string[],
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // History = completed sessions only. In-progress logs still surface
    // through the active log + plan detail, not here.
    const { rows, count } = await this.logModel.findAndCountAll({
      where: {
        userId,
        status: WorkoutLogStatus.Completed,
        ...(onlyAssignmentIds
          ? { programAssignmentId: { [Op.in]: onlyAssignmentIds } }
          : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              startedAt: {
                ...(query.dateFrom
                  ? { [Op.gte]: new Date(query.dateFrom) }
                  : {}),
                ...(query.dateTo ? { [Op.lt]: new Date(query.dateTo) } : {}),
              },
            }
          : {}),
        ...this._nameSearch(query.search),
      },
      include: [
        // Eager-load the program name so the row subtitle ("12-week
        // hypertrophy base · W5") doesn't need a follow-up fetch.
        // Nullable for freestyle logs.
        {
          model: ProgramAssignment,
          as: 'assignment',
          attributes: ['id', 'programNameSnapshot', 'masterProgramId'],
          required: false,
        },
        // The routine it was started from, so a history row can say
        // "Routine · Push day A" and link there instead of shrugging
        // "Freestyle" at two different kinds of session.
        {
          model: Program,
          as: 'sourceProgram',
          attributes: ['id', 'name', 'isSingleWorkout'],
          required: false,
        },
        // Bring back logged_exercise → logged_set just for the count.
        // FE sums them client-side to render "18 sets".
        {
          model: LoggedExercise,
          as: 'exercises',
          attributes: ['id'],
          include: [
            {
              model: LoggedSet,
              as: 'sets',
              attributes: ['id', 'isCompleted'],
              required: false,
            },
          ],
          required: false,
        },
      ],
      order: [['startedAt', 'DESC']],
      offset: getOffset(page, limit),
      limit,
      distinct: true,
    });

    // Tag each row with the PR count for the session window. The
    // history view shows a "PR" trophy chip when this is > 0.
    // Sequelize instances drop arbitrary attached props on JSON
    // serialization, so we project to plain objects first.
    const prCounts =
      rows.length > 0
        ? await this._countSessionPrs(rows)
        : new Map<string, number>();
    const plainRows = rows.map((r) => {
      const plain = r.get({ plain: true }) as WorkoutLog & { prCount?: number };
      const n = prCounts.get(r.id) ?? 0;
      if (n > 0) plain.prCount = n;
      return plain;
    });
    return buildPaginatedResponse(plainRows, count, page, limit);
  }

  /**
   * Counts one_rep_max rows recorded within each log's session window
   * in a single query. Returns logId → count.
   */
  private async _countSessionPrs(
    logs: WorkoutLog[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const completedLogs = logs.filter(
      (l) => l.status === WorkoutLogStatus.Completed && l.completedAt,
    );
    if (completedLogs.length === 0) return map;

    // Build one large query that scans the time windows for this user.
    // Tiny dataset per page (≤ 30) so a per-log COUNT is fine.
    const userId = logs[0].userId;
    const candidateRows = await this.oneRepMaxModel.findAll({
      where: {
        userId,
        source: OneRepMaxSource.EstimatedEpley,
        recordedAt: {
          [Op.gte]: new Date(
            Math.min(...completedLogs.map((l) => l.startedAt.getTime())),
          ),
          [Op.lte]: new Date(
            Math.max(...completedLogs.map((l) => l.completedAt!.getTime())),
          ),
        },
      },
      attributes: ['recordedAt'],
    });
    for (const log of completedLogs) {
      const start = log.startedAt.getTime();
      const end = log.completedAt!.getTime();
      const n = candidateRows.filter((r) => {
        const t = r.recordedAt.getTime();
        return t >= start && t <= end;
      }).length;
      if (n > 0) map.set(log.id, n);
    }
    return map;
  }

  async findById(id: string, userId: string): Promise<WorkoutLog> {
    const log = await this.logModel.findByPk(id, {
      include: [
        // Same provenance the list carries, so the replay header can
        // name and link the routine a session came from.
        {
          model: Program,
          as: 'sourceProgram',
          attributes: ['id', 'name', 'isSingleWorkout'],
          required: false,
        },
        {
          model: LoggedExercise,
          as: 'exercises',
          separate: true,
          order: [['orderIndex', 'ASC']],
          include: [
            // Eager-load the catalog exercise so the FE has name +
            // thumbnail without a second hop. `exerciseId` is nullable
            // on freestyle logs so `required: false` keeps the LEFT JOIN.
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
                // Drives the set row: `kind` picks which fields show at
                // all, `isUnilateral` makes reps read as per-side.
                'isUnilateral',
              ],
              required: false,
            },
            {
              // Named, a swap tells the coach what changed; as a bare id
              // it tells them nothing.
              model: Exercise,
              as: 'swappedFromExercise',
              attributes: ['id', 'name'],
              required: false,
            },
            {
              model: LoggedSet,
              as: 'sets',
              separate: true,
              order: [['orderIndex', 'ASC']],
              include: [
                // Eager-load the prescription so the FE can render the
                // target column (reps range, weight, %1RM, etc.).
                // `assignedSet` is nullable for freestyle sets.
                {
                  model: AssignedSet,
                  as: 'assignedSet',
                  required: false,
                },
              ],
            },
          ],
        },
      ],
    });
    if (!log || log.userId !== userId) {
      throw new NotFoundException('Workout log not found.');
    }
    // Attach session PRs as a virtual property so the FE can render
    // the workout-complete trophy tile without a second hop. Sequelize
    // strips arbitrary props on JSON serialization, so we project to
    // a plain object first.
    const prs = await this._findSessionPrs(log);
    const plain = log.get({ plain: true }) as WorkoutLog & {
      personalRecords?: typeof prs;
    };
    if (prs.length > 0) plain.personalRecords = prs;
    return plain;
  }

  // ────────────────────────────────────────────────────────────────────
  // Coach read-only (instructor → client) surface
  // ────────────────────────────────────────────────────────────────────

  /**
   * Asserts the caller is the ACTIVE instructor for clientId. 404 on
   * any other state — including PENDING and ARCHIVED — so we don't
   * leak the existence of a past or unconfirmed relationship.
   */
  private async _assertActiveCoachOf(
    instructorId: string,
    clientId: string,
  ): Promise<void> {
    const link = await this.instructorClientModel.findOne({
      where: {
        instructorId,
        clientId,
        status: InstructorClientStatus.ACTIVE,
      },
      attributes: ['id'],
    });
    if (!link) throw new NotFoundException('Client not found.');
  }

  /**
   * Coach view of a client's workout history. Same shape as
   * `listForUser` (PR-tagged plain rows). Gated by ACTIVE coach link.
   */
  async listForClientByInstructor(
    instructorId: string,
    clientId: string,
    query: PaginationDto,
  ) {
    await this._assertActiveCoachOf(instructorId, clientId);
    const assignmentIds = await this._visibleAssignmentIds(
      instructorId,
      clientId,
    );
    // `null` = the client shares everything with this coach.
    return this.listForUser(clientId, query, assignmentIds ?? undefined);
  }

  /**
   * Which of this client's logs this coach may read in detail.
   *
   * Returns the coach's own assignment ids, or `null` meaning "no
   * restriction" when the client has opted in via `shareOffPlan`.
   *
   * `share_off_plan` has existed since migration 056, documented as the
   * client-owned toggle for whether a coach may see training logged
   * outside their plan, and defaulting to false — but nothing ever read
   * it, so every coach could read every freestyle session their client
   * logged, including its private note. Presence still leaks through
   * roster adherence (the coach can tell you trained); the content no
   * longer does.
   */
  private async _visibleAssignmentIds(
    instructorId: string,
    clientId: string,
  ): Promise<string[] | null> {
    const assignments = await this.assignmentModel.findAll({
      where: { instructorId, clientId, deletedAt: null },
      attributes: ['id', 'shareOffPlan'],
    });
    if (assignments.some((a) => a.shareOffPlan)) return null;
    return assignments.map((a) => a.id);
  }

  /**
   * Coach view of one log. 404 if the log isn't owned by an ACTIVE
   * client of this instructor.
   */
  async findByIdForInstructor(
    id: string,
    instructorId: string,
  ): Promise<WorkoutLog> {
    const stub = await this.logModel.findByPk(id, {
      attributes: ['userId', 'programAssignmentId'],
    });
    if (!stub) throw new NotFoundException('Workout log not found.');
    await this._assertActiveCoachOf(instructorId, stub.userId);

    // Same gate as the list: an off-plan session is the client's own
    // business unless they shared it. 404 rather than 403 — consistent
    // with the rest of the coach surface, and it does not confirm that
    // a private session exists.
    const visible = await this._visibleAssignmentIds(instructorId, stub.userId);
    if (
      visible !== null &&
      (!stub.programAssignmentId || !visible.includes(stub.programAssignmentId))
    ) {
      throw new NotFoundException('Workout log not found.');
    }
    return this.findById(id, stub.userId);
  }

  /**
   * Most-recent IN_PROGRESS log for the caller (or null if none).
   *
   * Powers the home page's "Resume workout" tile and any other "where
   * did I leave off?" affordance. Stays cheap — only the fields the
   * caller needs to render + navigate (no exercise tree). Returns null
   * (not 404) because "you have nothing to resume" is a normal state,
   * not a missing-resource error.
   */
  async findInProgressForUser(userId: string): Promise<WorkoutLog | null> {
    return this.logModel.findOne({
      where: { userId, status: WorkoutLogStatus.InProgress },
      order: [['startedAt', 'DESC']],
      attributes: [
        'id',
        'name',
        'startedAt',
        'assignedWorkoutId',
        'programAssignmentId',
      ],
    });
  }

  /**
   * Look up the WorkoutLog created from a given assigned-workout.
   *
   * Used by the client plan-detail "View" CTA on a completed workout —
   * we need the log id to navigate to the replay screen. Returns the
   * latest log if there's drift (e.g. multiple starts of the same
   * assigned workout, which today shouldn't happen but might in the
   * future). 404 on cross-tenant access.
   */
  async findByAssignedWorkout(
    assignedWorkoutId: string,
    userId: string,
  ): Promise<WorkoutLog> {
    const owned = await this.assignedWorkoutOwnedByClient(
      assignedWorkoutId,
      userId,
    );
    if (!owned) throw new NotFoundException('Workout log not found.');

    const log = await this.logModel.findOne({
      where: { userId, assignedWorkoutId },
      order: [['startedAt', 'DESC']],
      attributes: ['id'],
    });
    if (!log) throw new NotFoundException('Workout log not found.');
    return log;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async _loadOwnedLog(id: string, userId: string): Promise<WorkoutLog> {
    const log = await this.logModel.findByPk(id);
    if (!log || log.userId !== userId) {
      throw new NotFoundException('Workout log not found.');
    }
    return log;
  }

  private async assignedWorkoutOwnedByClient(
    assignedWorkoutId: string,
    userId: string,
  ): Promise<boolean> {
    const row = await this.assignedWorkoutModel.findOne({
      where: { id: assignedWorkoutId },
      include: [
        {
          association: 'assignment',
          attributes: ['id', 'clientId'],
          required: true,
        },
      ],
    });
    return !!row && row.assignment?.clientId === userId;
  }

  /**
   * Single query for all (user, exerciseId) 1RM lookups needed by a
   * workout-start. Returns the latest `weightKg` per exercise — empty
   * map entries simply mean "no 1RM recorded".
   */
  private async fetchLatestOneRepMaxesForExercises(
    userId: string,
    exerciseIds: string[],
  ): Promise<Map<string, number>> {
    if (exerciseIds.length === 0) return new Map();
    const rows = await this.oneRepMaxModel.findAll({
      where: { userId, exerciseId: { [Op.in]: exerciseIds } },
      order: [['recordedAt', 'DESC']],
      attributes: ['exerciseId', 'weightKg', 'recordedAt'],
    });
    const map = new Map<string, number>();
    // Rows come newest-first; first match per exerciseId wins.
    for (const r of rows) {
      if (!map.has(r.exerciseId)) {
        map.set(r.exerciseId, Number(r.weightKg));
      }
    }
    return map;
  }

  private async recomputeAssignmentProgress(
    assignmentId: string,
    tx: Transaction,
  ): Promise<void> {
    const [total, done] = await Promise.all([
      this.assignedWorkoutModel.count({
        where: { programAssignmentId: assignmentId },
        transaction: tx,
      }),
      this.assignedWorkoutModel.count({
        where: {
          programAssignmentId: assignmentId,
          status: WorkoutLogStatus.Completed,
        },
        transaction: tx,
      }),
    ]);
    if (total === 0) return;
    const percent = Math.min(100, Math.round((done / total) * 100));
    await this.sequelize.query(
      'UPDATE program_assignment SET completion_percent = :p, updated_at = NOW() WHERE id = :id',
      {
        replacements: { p: percent, id: assignmentId },
        transaction: tx,
      },
    );
  }
}
