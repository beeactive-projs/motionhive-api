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
import { Includeable, Op, QueryTypes, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import {
  buildPaginatedResponse,
  PaginatedResponse,
  getOffset,
} from '../../common/dto/pagination.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CoachClientLogsQueryDto } from './dto/coach-client-logs.query.dto';
import {
  DEFAULT_LOCALE,
  apiError,
  translate,
  translatedText,
  type Locale,
} from '../../common/i18n';
import { escapeLikeWildcards } from '../../common/utils/search.utils';
import { stripHtml } from '../../common/utils/text.utils';
import { resolveLevel } from '../profile/profile-privacy';
import {
  ListWorkoutLogsQueryDto,
  WorkoutLogFilter,
} from './dto/list-workout-logs.query.dto';
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
  ProgramAssignmentKind,
  ProgramSource,
  ProgramStatus,
  WorkoutLogStatus,
  WorkoutVisibility,
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
import {
  CoachAccessService,
  isReadableByCoach,
  readableLogsWhere,
  SHARED_WITH_COACHES,
} from './coach-access.service';
import { profileVisibleWhere } from './profile-visibility';
import { streakFromWeeks } from './training-streak';

/**
 * What the apps learn about a workout's photo: whether there is one and
 * which version. The Cloudinary id stays on the server; the bytes only
 * come through `WorkoutPhotoService`.
 */
export function withPhotoFlag<T extends { photoPublicId?: string | null }>(
  plain: T,
): Omit<T, 'photoPublicId'> & { hasPhoto: boolean } {
  const { photoPublicId, ...rest } = plain;
  return { ...rest, hasPhoto: !!photoPublicId };
}

/** A workout as `GET /workout-logs/:id` (and the coach's read) returns it. */
/**
 * Who reads a timeline: its owner, who sees all of it, or a coach with the
 * ids of their own plans for this client.
 */
type TimelineReader = 'owner' | { own: string[] };

/** What narrows a timeline: the coach's chips, a day or month, and the page. */
interface TimelineQuery {
  page?: number;
  limit?: number;
  kind?: 'all' | 'plan' | 'own' | 'skipped';
  dateFrom?: string;
  dateTo?: string;
}

/** One row of the timeline query: a log, or a skipped plan day. */
interface CoachTimelineEntry {
  id: string;
  kind: 'LOG' | 'SKIPPED';
  at: Date | string;
  name: string | null;
  assignment_id: string | null;
  program_name: string | null;
  assignment_kind: string | null;
  master_program_id: string | null;
}

/**
 * A day of a coach's plan the client skipped, as a row of their history:
 * the plan day's id (there is no log to open) and status SKIPPED.
 */
export interface SkippedPlanDay {
  id: string;
  userId: string;
  name: string;
  status: typeof WorkoutLogStatus.Skipped;
  startedAt: Date;
  completedAt: null;
  durationSeconds: null;
  feelingRating: null;
  notes: null;
  assignedWorkoutId: string;
  programAssignmentId: string | null;
  assignment: {
    id: string;
    programNameSnapshot: string | null;
    masterProgramId: string | null;
    assignmentKind: ProgramAssignmentKind;
  } | null;
  exercises: [];
}

export type WorkoutLogView = Omit<WorkoutLog, 'photoPublicId'> & {
  hasPhoto: boolean;
  personalRecords?: SessionRecord[];
  summary?: WorkoutSummary;
};

/**
 * The safe summary of a finished workout, for anyone its owner showed it
 * to: never the note, weights, the plan or a coach.
 */
function profileSummary(
  log: Pick<
    WorkoutLog,
    | 'id'
    | 'name'
    | 'completedAt'
    | 'durationSeconds'
    | 'shareCaption'
    | 'exercises'
    | 'photoVersion'
  > & { photoPublicId?: string | null; hasPhoto?: boolean },
  recordCount: number,
): ProfileWorkout {
  // A row from `listForUser` already carries the flag in place of the id.
  const hasPhoto = log.hasPhoto ?? !!log.photoPublicId;
  return {
    id: log.id,
    name: log.name,
    completedAt: log.completedAt,
    durationSeconds: log.durationSeconds,
    setsCompleted: (log.exercises ?? [])
      .flatMap((exercise) => exercise.sets ?? [])
      .filter((set) => set.isCompleted).length,
    recordCount,
    shareCaption: log.shareCaption ?? null,
    hasPhoto,
    photoVersion: hasPhoto ? (log.photoVersion ?? null) : null,
  };
}

/** A workout card in a group post; `onProfile` when its author made it Public. */
export type PostWorkout = ProfileWorkout & { onProfile: boolean };

/** A workout on someone's profile: the safe summary `listForProfile` builds. */
export interface ProfileWorkout {
  id: string;
  name: string;
  completedAt: Date | null;
  durationSeconds: number | null;
  setsCompleted: number;
  recordCount: number;
  shareCaption: string | null;
  /**
   * Whether it has a photo, which comes only through the profile's photo
   * endpoint under the same rule; the version keeps a replaced one from
   * being served from a cache.
   */
  hasPhoto: boolean;
  photoVersion: number | null;
}

/** A record set in a session, as `GET /workout-logs/:id` returns it. */
export interface SessionRecord {
  id: string;
  exerciseId: string;
  exerciseName: string;
  /** New estimated 1RM, kg. */
  weightKg: number;
  /** Over the previous best; always positive, a first time is no record. */
  deltaKg: number;
  /** The set behind it, "100 × 5". Null when the set can't be found. */
  setWeightKg: number | null;
  setReps: number | null;
}

/** The owner-only extras on a finished workout; see `_ownerSummary`. */
export interface WorkoutSummary {
  /** 12 for "your 12th workout": completed workouts up to this one. */
  workoutNumber: number;
  /** Consecutive weeks with a workout, counting this week or last. */
  streakWeeks: number;
  /** Routines only: the volume last time, for "+8% vs last time". */
  previousVolumeKg: number | null;
  /** The coach behind a plan workout, for the shared card. */
  coachName: string | null;
}
import { estimateOneRepMaxEpley } from './one-rep-max.estimate';
import { ProgramAssignmentService } from './program-assignment.service';

/** How far back History's memory looks, the longest span first. */
const MEMORY_LOOKBACK_MONTHS = [12, 6, 3, 1] as const;

/** Either side of each span's day, so a workout a few days off still counts. */
const MEMORY_WINDOW_MS = 4 * 24 * 60 * 60_000;

/** Workouts tried per span: the photo ones first, then the most recent. */
const MEMORY_CANDIDATES = 5;

/** History's memory card: an old workout and one lift's progress since. */
export interface WorkoutMemory {
  monthsAgo: number;
  workout: {
    id: string;
    name: string;
    completedAt: Date;
    hasPhoto: boolean;
    photoVersion: number | null;
  };
  /** The heaviest completed set then, and the heaviest since. */
  exercise: { id: string; name: string; fromKg: number; toKg: number };
}

/** Left alone this long after its last ticked set, a workout ended there. */
const IDLE_AFTER_LAST_SET_MS = 30 * 60_000;

/** More active time than this is a clock left running, not training. */
const MAX_ACTIVE_SECONDS = 6 * 60 * 60;

/** Open and untouched this long, the nightly sweep closes a workout. */
const STALE_OPEN_WORKOUT_MS = 24 * 60 * 60_000;

/** How many stale workouts one night's sweep closes at most. */
const STALE_SWEEP_BATCH = 500;

/**
 * When the training ended: when Finish was tapped, unless the workout sat
 * untouched for over half an hour after its last ticked set. Then it
 * ended at that set, so forgetting to tap Finish costs nothing and the
 * workout lands on the day it was done.
 */
function endOfTraining(
  startedAt: Date,
  finishedAt: Date,
  lastSetAt: Date | null,
): Date {
  if (!lastSetAt) return finishedAt;
  if (finishedAt.getTime() - lastSetAt.getTime() <= IDLE_AFTER_LAST_SET_MS) {
    return finishedAt;
  }
  return lastSetAt < startedAt ? startedAt : lastSetAt;
}

/**
 * Active seconds from start to end, pauses out. Past what a session can
 * be it is null, shown as unknown and left out of totals, rather than a
 * number nobody trained.
 */
function activeSeconds(
  startedAt: Date,
  endedAt: Date,
  pausedSeconds: number,
): number | null {
  const seconds = Math.max(
    0,
    Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) -
      pausedSeconds,
  );
  return seconds > MAX_ACTIVE_SECONDS ? null : seconds;
}

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
 *   3. **Complete** — `complete(workoutLogId, dto)` computes duration
 *      (ending at the last set when the workout was left open after it),
 *      flips status, mirrors to the assigned_workout, updates the
 *      assignment's completion_percent (finishing the plan when it was
 *      the last), and optionally auto-suggests a 1RM via Epley.
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
    @InjectModel(ProgramAssignment)
    private readonly assignmentModel: typeof ProgramAssignment,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly notificationService: NotificationService,
    private readonly coachAccess: CoachAccessService,
    private readonly assignments: ProgramAssignmentService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Start
  // ────────────────────────────────────────────────────────────────────

  async start(
    userId: string,
    dto: StartWorkoutDto,
    /** The person's language: names copied into the log are written in it. */
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<WorkoutLog> {
    if (dto.assignedWorkoutId && dto.programId) {
      throw new BadRequestException(apiError('workout.startOneSource'));
    }

    // One session at a time, whichever way it starts. Two open logs split
    // the work between them, and "resume" can only point at one.
    const open = await this.findInProgressForUser(userId);
    if (open) {
      throw new ConflictException(
        apiError('workout.alreadyInProgress', { name: open.name }),
      );
    }

    if (dto.programId) {
      return this._startFromProgram(userId, dto.programId, locale);
    }

    if (!dto.assignedWorkoutId && !dto.name?.trim()) {
      throw new BadRequestException(apiError('workout.freestyleNameRequired'));
    }

    if (!dto.assignedWorkoutId) {
      // Freestyle — minimal create, exercises added via separate flow (V2).
      return this.logModel.create({
        userId,
        programAssignmentId: null,
        assignedWorkoutId: null,
        name: dto.name!.trim(),
        status: WorkoutLogStatus.InProgress,
        visibility: await this._defaultVisibility(userId),
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
              attributes: ['id', 'name', 'thumbnailUrl', 'translations'],
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
      throw new NotFoundException(apiError('workout.workoutNotFound'));
    }

    // Authorization: the assigned workout must belong to an assignment
    // whose client is the caller. We do the cheap check via raw join
    // to avoid pulling the whole assignment row.
    const ownsAssignment = await this.assignedWorkoutOwnedByClient(
      aw.id,
      userId,
    );
    if (!ownsAssignment) {
      throw new NotFoundException(apiError('workout.workoutNotFound'));
    }

    // Compute %1RM resolutions once, batched by exercise.
    const oneRmMap = await this.fetchLatestOneRepMaxesForExercises(
      userId,
      (aw.exercises ?? []).map((e) => e.exerciseId),
    );

    const visibility = await this._defaultVisibility(userId);
    return this.sequelize.transaction(async (tx) => {
      const log = await this.logModel.create(
        {
          userId,
          programAssignmentId: aw.programAssignmentId,
          assignedWorkoutId: aw.id,
          name: aw.name,
          status: WorkoutLogStatus.InProgress,
          visibility,
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
            exerciseNameSnapshot: this._exerciseName(ae.exercise, locale),
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
    locale: Locale,
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
      throw new NotFoundException(apiError('workout.programNotFound'));
    }

    const workout = program.workouts?.[0];
    if (!workout) {
      throw new BadRequestException(apiError('workout.programNothingToStart'));
    }

    const pxs = await this.prescribedExerciseModel.findAll({
      where: { programWorkoutId: workout.id },
      order: [['orderIndex', 'ASC']],
      include: [
        {
          model: Exercise,
          as: 'exercise',
          attributes: ['id', 'name', 'thumbnailUrl', 'translations'],
        },
        {
          model: PrescribedSet,
          as: 'sets',
          separate: true,
          order: [['orderIndex', 'ASC']],
        },
      ],
    });

    const visibility = await this._defaultVisibility(userId);
    const created = await this.sequelize.transaction(async (tx) => {
      const log = await this.logModel.create(
        {
          userId,
          visibility,
          programAssignmentId: null,
          assignedWorkoutId: null,
          // What makes this a routine session rather than a freestyle
          // one. Both used to write nothing here and were then
          // indistinguishable in history.
          sourceProgramId: program.id,
          // A starter's text is copied in the person's language.
          name: program.isSingleWorkout
            ? translatedText(program, 'name', locale)
            : translatedText(workout, 'name', locale),
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
            exerciseNameSnapshot: this._exerciseName(px.exercise, locale),
            exerciseThumbnailUrlSnapshot: px.exercise?.thumbnailUrl ?? null,
            orderIndex: px.orderIndex,
            supersetGroupId: px.supersetGroupId,
            notes: translatedText(px, 'notes', locale),
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
      throw new BadRequestException(apiError('workout.nothingToSaveAsRoutine'));
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
        apiError('workout.cannotLogSetsNotInProgress'),
      );
    }
    const set = await this.loggedSetModel.findByPk(setId, {
      include: [
        { model: LoggedExercise, as: 'exercise', attributes: ['workoutLogId'] },
      ],
    });
    if (!set || set.exercise?.workoutLogId !== workoutLogId) {
      throw new NotFoundException(apiError('workout.setNotFound'));
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
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<LoggedExercise> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        apiError('workout.cannotAddExercisesNotInProgress'),
      );
    }
    const exercise = await this.exerciseModel.findByPk(exerciseId, {
      attributes: [
        'id',
        'name',
        'thumbnailUrl',
        'visibility',
        'ownerId',
        'translations',
      ],
    });
    if (
      !exercise ||
      (exercise.visibility === 'PRIVATE' && exercise.ownerId !== userId)
    ) {
      throw new NotFoundException(apiError('exercise.notFound'));
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
          exerciseNameSnapshot: this._exerciseName(exercise, locale),
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
        apiError('workout.cannotEditNotInProgress'),
      );
    }
    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException(apiError('exercise.notFound'));
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
        apiError('workout.cannotEditNotInProgress'),
      );
    }
    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException(apiError('exercise.notFound'));
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
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<LoggedExercise> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        apiError('workout.cannotEditNotInProgress'),
      );
    }

    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    if (ex.exerciseId === newExerciseId) {
      throw new BadRequestException(apiError('workout.sameExerciseSwap'));
    }

    const next = await this.exerciseModel.findByPk(newExerciseId);
    // Same usability rule as adding an exercise: someone else's private
    // custom movement is not swappable in.
    if (
      !next ||
      (next.visibility === ExerciseVisibility.Private &&
        next.ownerId !== userId)
    ) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }

    // Keep the ORIGINAL exercise as the provenance anchor across repeated
    // swaps. Otherwise a second swap would report the first substitute as
    // the prescription, which is not what the coach wrote.
    const swappedFrom = ex.swappedFromExerciseId ?? ex.exerciseId;

    await ex.update({
      exerciseId: next.id,
      swappedFromExerciseId: swappedFrom,
      exerciseNameSnapshot: this._exerciseName(next, locale),
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
        apiError('workout.cannotAddSetsNotInProgress'),
      );
    }
    const ex = await this.loggedExerciseModel.findByPk(loggedExerciseId);
    if (!ex || ex.workoutLogId !== workoutLogId) {
      throw new NotFoundException(apiError('exercise.notFound'));
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
   * Remove one set mid-session: the extra row added by mistake, or a set
   * the user is not going to do. Deleted rather than flagged: unlike a
   * skipped exercise, a set that was never done carries nothing a coach
   * needs to see. The rows left keep their `orderIndex`; a gap is harmless
   * because every read sorts by it.
   */
  async removeSetFromLog(
    workoutLogId: string,
    setId: string,
    userId: string,
  ): Promise<void> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        apiError('workout.cannotEditNotInProgress'),
      );
    }
    const set = await this.loggedSetModel.findByPk(setId, {
      include: [
        { model: LoggedExercise, as: 'exercise', attributes: ['workoutLogId'] },
      ],
    });
    if (!set || set.exercise?.workoutLogId !== workoutLogId) {
      throw new NotFoundException(apiError('workout.setNotFound'));
    }
    await set.destroy();
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
  // Pause / resume
  // ────────────────────────────────────────────────────────────────────

  /**
   * Stop the workout's clock while the person is away from it. Pausing
   * an already paused workout keeps the original start of the pause.
   */
  async pause(workoutLogId: string, userId: string): Promise<WorkoutLog> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        apiError('workout.cannotEditNotInProgress'),
      );
    }
    if (!log.pausedAt) await log.update({ pausedAt: new Date() });
    return log;
  }

  /** Start the clock again, folding the pause into `pausedSeconds`. */
  async resume(workoutLogId: string, userId: string): Promise<WorkoutLog> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        apiError('workout.cannotEditNotInProgress'),
      );
    }
    if (log.pausedAt) {
      await log.update({
        pausedAt: null,
        pausedSeconds: this._pausedSecondsAt(log, new Date()),
      });
    }
    return log;
  }

  /** Paused time up to `at`, counting a pause still open at that moment. */
  private _pausedSecondsAt(log: WorkoutLog, at: Date): number {
    const open = log.pausedAt
      ? Math.max(0, Math.round((at.getTime() - log.pausedAt.getTime()) / 1000))
      : 0;
    return (log.pausedSeconds ?? 0) + open;
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
      throw new BadRequestException(apiError('workout.cannotDiscardFinished'));
    }
    await this._discard(log);
  }

  /** Delete a running workout and put its plan day back as not started. */
  private async _discard(
    log: WorkoutLog,
    /** Only if it is still running once locked: for the nightly sweep. */
    { ifStillRunning = false } = {},
  ): Promise<boolean> {
    const { assignedWorkoutId, programAssignmentId, sourceProgramId } = log;

    const discarded = await this.sequelize.transaction(async (tx) => {
      if (ifStillRunning) {
        // The person may be finishing it this very moment.
        const current = await this.logModel.findByPk(log.id, {
          attributes: ['id', 'status'],
          transaction: tx,
          lock: tx.LOCK.UPDATE,
        });
        if (current?.status !== WorkoutLogStatus.InProgress) return false;
      }
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
      return true;
    });

    if (discarded && sourceProgramId) {
      await this._resyncLastPerformed(sourceProgramId);
    }
    return discarded;
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
  ): Promise<WorkoutLogView> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    const feedback = this._feedbackFields(dto);
    if (log.status === WorkoutLogStatus.Completed) {
      // Idempotent for the status change, but not a no-op: the feedback
      // screen runs after the workout is already complete, so its rating,
      // note and share message arrive on this second call.
      if (Object.keys(feedback).length > 0) await log.update(feedback);
      return this._view(log);
    }
    // Only a running workout becomes a finished one. Anything else would
    // turn a skipped or abandoned record into training that happened,
    // with a duration measured from whenever it was opened.
    if (log.status !== WorkoutLogStatus.InProgress) {
      throw new BadRequestException(
        apiError('workout.cannotCompleteNotInProgress'),
      );
    }

    const finishedAt = new Date();
    const completedAt = endOfTraining(
      log.startedAt,
      finishedAt,
      await this._lastTickedSetAt(log.id),
    );
    await this.sequelize.transaction((tx) =>
      this._finishInTx(log, { completedAt, finishedAt }, feedback, tx),
    );

    // notify-after-commit — notify() opens its own transaction, so a
    // rollback above would otherwise orphan the alert.
    await this._notifyInstructorOfCompletion(log, userId);
    await this._completePlanIfFinished(log.programAssignmentId);

    return this._view(log);
  }

  /**
   * A log as the owner's own reads return it: the photo as a flag, never
   * its Cloudinary id. The feedback call comes after the photo upload, so
   * without this it carried the id.
   */
  private _view(log: WorkoutLog): WorkoutLogView {
    return withPhotoFlag(
      log.get({ plain: true }) as WorkoutLog,
    ) as WorkoutLogView;
  }

  /**
   * Paused time before the end of training. The log keeps one running
   * total, not when each pause was, so when the end moved back to the
   * last set, pause time that fits in the idle stretch after it is taken
   * to be there: pausing and walking away is how a workout gets left
   * open. Counting it again would cut the training short, down to zero.
   */
  private _pausedSecondsBefore(
    log: WorkoutLog,
    { completedAt, finishedAt }: { completedAt: Date; finishedAt: Date },
  ): number {
    const idle = Math.max(
      0,
      Math.round((finishedAt.getTime() - completedAt.getTime()) / 1000),
    );
    return Math.max(0, this._pausedSecondsAt(log, finishedAt) - idle);
  }

  /**
   * Turn a running workout into a finished one at `completedAt`, the end
   * of training (`endOfTraining`) for a Finish at `finishedAt`: duration,
   * the plan day and progress, and the records it set. The caller owns
   * the transaction and the notifications after it.
   */
  private async _finishInTx(
    log: WorkoutLog,
    end: { completedAt: Date; finishedAt: Date },
    feedback: Partial<
      Pick<WorkoutLog, 'feelingRating' | 'notes' | 'shareCaption'>
    >,
    tx: Transaction,
  ): Promise<void> {
    const { completedAt } = end;
    // Finishing from a pause ends the pause there: it was not training.
    const pausedSeconds = this._pausedSecondsBefore(log, end);
    await log.update(
      {
        status: WorkoutLogStatus.Completed,
        completedAt,
        durationSeconds: activeSeconds(
          log.startedAt,
          completedAt,
          pausedSeconds,
        ),
        pausedAt: null,
        pausedSeconds,
        ...feedback,
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
    await this._writePrsFromLog(log.id, log.userId, completedAt, tx);
  }

  /** When the workout's last ticked set was ticked, or null if none was. */
  private async _lastTickedSetAt(workoutLogId: string): Promise<Date | null> {
    const last = await this.loggedSetModel.findOne({
      where: { isCompleted: true, completedAt: { [Op.ne]: null } },
      include: [
        {
          model: LoggedExercise,
          as: 'exercise',
          attributes: [],
          where: { workoutLogId },
          required: true,
        },
      ],
      attributes: ['completedAt'],
      order: [['completedAt', 'DESC']],
    });
    return last?.completedAt ?? null;
  }

  /**
   * A plan workout finished may have been the plan's last; finish the
   * plan now rather than at the night's sweep. Best effort after commit:
   * the workout did finish, and the sweep is the backstop.
   */
  private async _completePlanIfFinished(
    programAssignmentId: string | null,
  ): Promise<void> {
    if (!programAssignmentId) return;
    try {
      await this.assignments.completeIfFinished(programAssignmentId);
    } catch (err) {
      this.logger.warn(
        `Failed to finish plan ${programAssignmentId} after its last workout: ${(err as Error).message}`,
        'WorkoutLogService',
      );
    }
  }

  /**
   * The nightly tidy-up of workouts left open. One nobody has touched for
   * a day closes itself, so it stops waiting on Home and blocking the next
   * start. With sets ticked it was training: it completes, ending at the
   * last set, with its records and plan progress, but no message to the
   * coach about a day-old session. With nothing ticked nothing happened,
   * so it is discarded as Discard would.
   */
  async closeStaleWorkouts(
    now = new Date(),
  ): Promise<{ completed: number; discarded: number }> {
    const cutoff = new Date(now.getTime() - STALE_OPEN_WORKOUT_MS);
    // Oldest first, a night's share at a time: the first run meets every
    // workout ever left open, and the rest wait for the next night.
    const open = await this.logModel.findAll({
      where: {
        status: WorkoutLogStatus.InProgress,
        // Start, pause and resume stamp the log itself.
        updatedAt: { [Op.lt]: cutoff },
      },
      order: [['updatedAt', 'ASC']],
      limit: STALE_SWEEP_BATCH,
    });

    let completed = 0;
    let discarded = 0;
    for (const log of open) {
      try {
        // Typing into a set touches the set, not the log.
        const touched = await this.loggedSetModel.findOne({
          include: [
            {
              model: LoggedExercise,
              as: 'exercise',
              attributes: [],
              where: { workoutLogId: log.id },
              required: true,
            },
          ],
          attributes: ['updatedAt'],
          order: [['updatedAt', 'DESC']],
        });
        if (touched && touched.updatedAt >= cutoff) continue;

        const lastSetAt = await this._lastTickedSetAt(log.id);
        if (!lastSetAt) {
          if (await this._discard(log, { ifStillRunning: true })) {
            discarded += 1;
          }
          continue;
        }
        const finished = await this.sequelize.transaction(async (tx) => {
          // The person may be finishing it this very moment.
          const current = await this.logModel.findByPk(log.id, {
            transaction: tx,
            lock: tx.LOCK.UPDATE,
          });
          if (current?.status !== WorkoutLogStatus.InProgress) return false;
          await this._finishInTx(
            current,
            {
              completedAt: endOfTraining(current.startedAt, now, lastSetAt),
              finishedAt: now,
            },
            {},
            tx,
          );
          return true;
        });
        if (!finished) continue;
        await this._completePlanIfFinished(log.programAssignmentId);
        completed += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to close stale workout ${log.id}: ${(err as Error).message}`,
          'WorkoutLogService',
        );
      }
    }

    if (completed + discarded > 0) {
      this.logger.log(
        `Closed stale workouts: completed=${completed} discarded=${discarded}`,
        'WorkoutLogService',
      );
    }
    return { completed, discarded };
  }

  /**
   * What the person said about the session, only the fields they sent. An
   * empty note or message clears it. The message goes on a card others
   * will see, so it is stripped to plain text on one line.
   */
  private _feedbackFields(
    dto: CompleteWorkoutDto,
  ): Partial<Pick<WorkoutLog, 'feelingRating' | 'notes' | 'shareCaption'>> {
    return {
      ...(dto.feelingRating !== undefined && {
        feelingRating: dto.feelingRating,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      ...(dto.shareCaption !== undefined && {
        shareCaption:
          stripHtml(dto.shareCaption.replace(/\s+/g, ' '), 80) || null,
      }),
    };
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
  /**
   * Records this session set, beating an earlier best. A first time on an
   * exercise also writes a one_rep_max row (it is the baseline every
   * later record is measured against), but it beat nothing, so it is not
   * a record here. Each carries the set that earned it: "100 × 5" means
   * something to a person; an estimated one-rep max does not.
   */
  private async _findSessionPrs(
    log: WorkoutLog,
    locale: Locale,
  ): Promise<SessionRecord[]> {
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
          attributes: ['id', 'name', 'translations'],
        },
      ],
    });

    // For the delta, fetch each exercise's previous best (before this
    // PR was set). Cheap query — most workouts hit ≤3 PRs.
    const records = await Promise.all(
      rows.map(async (pr): Promise<SessionRecord | null> => {
        const prior = await this.oneRepMaxModel.findOne({
          where: {
            userId: log.userId,
            exerciseId: pr.exerciseId,
            recordedAt: { [Op.lt]: pr.recordedAt },
          },
          order: [['weightKg', 'DESC']],
          attributes: ['weightKg'],
        });
        if (!prior) return null;
        const exerciseName = this._exerciseName(
          (pr as unknown as { exercise?: Exercise | null }).exercise,
          locale,
        );
        const set = this._recordSet(log, pr.exerciseId);
        return {
          id: pr.id,
          exerciseId: pr.exerciseId,
          exerciseName,
          weightKg: pr.weightKg,
          deltaKg: Math.round((pr.weightKg - prior.weightKg) * 100) / 100,
          setWeightKg: set?.weightKg ?? null,
          setReps: set?.reps ?? null,
        };
      }),
    );
    return records.filter((r): r is SessionRecord => r !== null);
  }

  /** The completed set with the best estimated 1RM for this exercise. */
  private _recordSet(
    log: WorkoutLog,
    exerciseId: string,
  ): { weightKg: number; reps: number } | null {
    let best: { weightKg: number; reps: number; estimate: number } | null =
      null;
    for (const exercise of log.exercises ?? []) {
      if (exercise.exerciseId !== exerciseId) continue;
      for (const set of exercise.sets ?? []) {
        if (!set.isCompleted || set.weightKg == null || set.reps == null) {
          continue;
        }
        const estimate = this.estimateOneRepMaxEpley(set.reps, set.weightKg);
        if (estimate != null && (!best || estimate > best.estimate)) {
          best = {
            weightKg: Number(set.weightKg),
            reps: set.reps,
            estimate,
          };
        }
      }
    }
    return best && { weightKg: best.weightKg, reps: best.reps };
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
          attributes: ['id', 'name', 'slug', 'kind', 'translations'],
        },
      ],
      order: [['recordedAt', 'DESC']],
      offset: getOffset(page, limit),
      limit,
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Epley-estimated 1RM from a single set. Thin alias for the shared
   * `estimateOneRepMaxEpley` (one-rep-max.estimate.ts), which the
   * coach's progress view also uses so both agree to the decimal.
   */
  estimateOneRepMaxEpley(
    reps: number | null,
    weightKg: number | null,
  ): number | null {
    return estimateOneRepMaxEpley(reps, weightKg);
  }

  // ────────────────────────────────────────────────────────────────────
  // List + detail
  // ────────────────────────────────────────────────────────────────────

  /**
   * History's filters. A record is what `_countSessionPrs` counts: an
   * estimated best set inside the workout that beat an earlier one, so a
   * first time on an exercise is none.
   */
  private _historyFilter(has?: WorkoutLogFilter) {
    if (has === 'photo') return { photoPublicId: { [Op.ne]: null } };
    if (has !== 'record') return {};
    return {
      [Op.and]: [
        this.sequelize.literal(`EXISTS (
          SELECT 1 FROM one_rep_max orm
          WHERE orm.user_id = "WorkoutLog"."user_id"
            AND orm.source = '${OneRepMaxSource.EstimatedEpley}'
            AND orm.recorded_at BETWEEN "WorkoutLog"."started_at" AND "WorkoutLog"."completed_at"
            AND orm.recorded_at > (
              SELECT MIN(first.recorded_at) FROM one_rep_max first
              WHERE first.user_id = orm.user_id AND first.exercise_id = orm.exercise_id
            )
        )`),
      ],
    };
  }

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
   * @param coachAssignmentIds when given, the reader is a coach and this
   * is their own assignments with the client: only logs from those, or
   * that the client made visible to coaches (`readableLogsWhere`). The
   * client's own history passes nothing and sees everything.
   */
  async listForUser(
    userId: string,
    query: ListWorkoutLogsQueryDto,
    coachAssignmentIds?: string[],
    /** Only these levels: a profile shows what its viewer may see. */
    onlyLevels?: readonly WorkoutVisibility[],
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // History = completed sessions only. In-progress logs still surface
    // through the active log + plan detail, not here.
    const { rows, count } = await this.logModel.findAndCountAll({
      where: {
        userId,
        status: WorkoutLogStatus.Completed,
        ...(coachAssignmentIds ? readableLogsWhere(coachAssignmentIds) : {}),
        // A profile never shows a workout staff took down.
        ...(onlyLevels ? profileVisibleWhere(userId, onlyLevels) : {}),
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
        ...this._historyFilter(query.has),
      },
      include: this._historyIncludes(),
      order: [['startedAt', 'DESC']],
      offset: getOffset(page, limit),
      limit,
      distinct: true,
    });

    return buildPaginatedResponse(
      await this._historyRows(rows),
      count,
      page,
      limit,
    );
  }

  /** What a history row needs beside the log itself. */
  private _historyIncludes(): Includeable[] {
    return [
      // Eager-load the program name so the row subtitle ("12-week
      // hypertrophy base · W5") doesn't need a follow-up fetch, and the
      // kind so a row can tell a coach's plan from a self-scheduled one.
      // Nullable for freestyle logs.
      {
        model: ProgramAssignment,
        as: 'assignment',
        attributes: [
          'id',
          'programNameSnapshot',
          'masterProgramId',
          'assignmentKind',
        ],
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
    ];
  }

  /**
   * Tag each row with the PR count for the session window; the history
   * view shows a "PR" trophy chip when this is > 0. Sequelize instances
   * drop arbitrary attached props on JSON serialization, so rows are
   * projected to plain objects first, with the photo as a flag, never
   * its Cloudinary id, as on every other read.
   */
  private async _historyRows(rows: WorkoutLog[]) {
    const prCounts =
      rows.length > 0
        ? await this._countSessionPrs(rows)
        : new Map<string, number>();
    return rows.map((r) => {
      const plain = r.get({ plain: true }) as WorkoutLog & { prCount?: number };
      const n = prCounts.get(r.id) ?? 0;
      if (n > 0) plain.prCount = n;
      return withPhotoFlag(plain);
    });
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
      attributes: ['exerciseId', 'recordedAt'],
    });
    if (candidateRows.length === 0) return map;

    // A first time on an exercise beat nothing, so it is no record: only
    // rows after the exercise's earliest one count (as `_findSessionPrs`).
    const firsts = (await this.oneRepMaxModel.findAll({
      where: {
        userId,
        exerciseId: {
          [Op.in]: [...new Set(candidateRows.map((r) => r.exerciseId))],
        },
      },
      attributes: [
        'exerciseId',
        [
          this.sequelize.fn('MIN', this.sequelize.col('recorded_at')),
          'firstAt',
        ],
      ],
      group: ['exerciseId'],
      raw: true,
    })) as unknown as { exerciseId: string; firstAt: Date | string }[];
    const firstAt = new Map(
      firsts.map((f) => [f.exerciseId, new Date(f.firstAt).getTime()]),
    );
    const records = candidateRows.filter(
      (r) =>
        r.recordedAt.getTime() >
        (firstAt.get(r.exerciseId) ?? Number.NEGATIVE_INFINITY),
    );

    for (const log of completedLogs) {
      const start = log.startedAt.getTime();
      const end = log.completedAt!.getTime();
      const n = records.filter((r) => {
        const t = r.recordedAt.getTime();
        return t >= start && t <= end;
      }).length;
      if (n > 0) map.set(log.id, n);
    }
    return map;
  }

  async findById(
    id: string,
    userId: string,
    /** The reader's language, for the names of records set in the session. */
    locale: Locale = DEFAULT_LOCALE,
    /**
     * `summary`: add what the finish screen celebrates (see
     * `_ownerSummary`). Owner reads only: it counts every workout the
     * person did, which a coach may not be allowed to know about.
     */
    options: { summary?: boolean } = {},
  ): Promise<WorkoutLogView> {
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
                // Read by ContentLocaleInterceptor, which also points the
                // name snapshot at the reader's language.
                'translations',
              ],
              required: false,
            },
            {
              // Named, a swap tells the coach what changed; as a bare id
              // it tells them nothing.
              model: Exercise,
              as: 'swappedFromExercise',
              attributes: ['id', 'name', 'translations'],
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
      throw new NotFoundException(apiError('workout.logNotFound'));
    }
    // Attach session PRs as a virtual property so the FE can render
    // the workout-complete trophy tile without a second hop. Sequelize
    // strips arbitrary props on JSON serialization, so we project to
    // a plain object first.
    const prs = await this._findSessionPrs(log, locale);
    const plain = log.get({ plain: true }) as WorkoutLog & {
      personalRecords?: typeof prs;
      summary?: WorkoutSummary;
    };
    if (prs.length > 0) plain.personalRecords = prs;
    if (options.summary) {
      const summary = await this._ownerSummary(log);
      if (summary) plain.summary = summary;
    }
    return withPhotoFlag(plain);
  }

  /**
   * What a finished workout's summary celebrates, each only when true:
   * which workout this was for the person, their current weekly streak,
   * and, for a routine, the volume the last time they did it. Owner
   * only, since all three count workouts a coach may not see.
   */
  private async _ownerSummary(log: WorkoutLog): Promise<WorkoutSummary | null> {
    if (log.status !== WorkoutLogStatus.Completed || !log.completedAt) {
      return null;
    }
    const [workoutNumber, weeks, previousVolumeKg, coachName] =
      await Promise.all([
        this.logModel.count({
          where: {
            userId: log.userId,
            status: WorkoutLogStatus.Completed,
            completedAt: { [Op.lte]: log.completedAt },
          },
        }),
        this._activeWeeks(log.userId),
        this._previousRoutineVolume(log),
        this._coachName(log),
      ]);
    return {
      workoutNumber,
      streakWeeks: streakFromWeeks(weeks).currentWeeks,
      previousVolumeKg,
      coachName,
    };
  }

  /**
   * The coach whose plan this workout came from, for "Program by …" on a
   * shared card. Null for freestyle, a routine, or a plan the person set
   * themselves: nobody is their own coach.
   */
  private async _coachName(log: WorkoutLog): Promise<string | null> {
    if (!log.programAssignmentId) return null;
    const assignment = await this.assignmentModel.findByPk(
      log.programAssignmentId,
      {
        attributes: ['id', 'instructorId', 'assignmentKind'],
        include: [
          {
            model: User,
            as: 'instructor',
            attributes: ['id', 'firstName', 'lastName'],
            required: false,
          },
        ],
      },
    );
    if (
      !assignment ||
      assignment.assignmentKind !== ProgramAssignmentKind.Coach ||
      assignment.instructorId === log.userId
    ) {
      return null;
    }
    const coach = assignment.instructor;
    const name = [coach?.firstName, coach?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || null;
  }

  /** Monday-based weeks with a completed workout, newest first. */
  private async _activeWeeks(userId: string): Promise<string[]> {
    const rows = await this.sequelize.query<{ weekStart: string }>(
      `
      SELECT DISTINCT
        TO_CHAR(DATE_TRUNC('week', COALESCE(completed_at, started_at)), 'YYYY-MM-DD') AS "weekStart"
      FROM workout_log
      WHERE user_id = :userId AND status = 'COMPLETED'
      ORDER BY 1 DESC
      `,
      { replacements: { userId }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => r.weekStart);
  }

  /**
   * Volume (kg × reps over completed sets) the previous time this
   * routine was done, or null. Routines only: a plan's sessions differ
   * day to day, so "last time" would compare different workouts.
   */
  private async _previousRoutineVolume(
    log: WorkoutLog,
  ): Promise<number | null> {
    const source = (log as WorkoutLog & { sourceProgram?: Program | null })
      .sourceProgram;
    if (!log.sourceProgramId || !source?.isSingleWorkout) return null;

    const rows = await this.sequelize.query<{ volume: string | null }>(
      `
      SELECT SUM(ls.weight_kg * ls.reps) AS volume
      FROM workout_log wl
      JOIN logged_exercise le ON le.workout_log_id = wl.id
      JOIN logged_set ls ON ls.logged_exercise_id = le.id
      WHERE wl.id = (
        SELECT id FROM workout_log
        WHERE user_id = :userId
          AND status = 'COMPLETED'
          AND source_program_id = :programId
          AND completed_at < :completedAt
        ORDER BY completed_at DESC
        LIMIT 1
      )
        AND ls.is_completed
        AND ls.weight_kg IS NOT NULL
        AND ls.reps IS NOT NULL
      `,
      {
        replacements: {
          userId: log.userId,
          programId: log.sourceProgramId,
          completedAt: log.completedAt,
        },
        type: QueryTypes.SELECT,
      },
    );
    const volume = Number(rows[0]?.volume ?? 0);
    return volume > 0 ? Math.round(volume) : null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Coach read-only (instructor → client) surface
  // ────────────────────────────────────────────────────────────────────

  /**
   * Coach view of a client's training, newest first: the finished
   * workouts the coach may read (their plans, or what the client shared;
   * the same rule as `listForUser` with coach ids) and the days of the
   * coach's plans the client skipped, which leave no log. Logs come back
   * in `listForUser`'s shape (PR-tagged plain rows); a skip as a row of
   * the same shape with status SKIPPED, the plan day's id and name, and
   * nothing to open. Gated by ACTIVE coach link.
   *
   * `kind` picks: `all` for both, `plan` for the coach's plans, `own` for
   * what is not from them, `skipped` for the skips; omitted, the finished
   * logs alone, as callers before the skips expect. `dateFrom` / `dateTo`
   * bound the day, for a calendar month or one tapped date.
   */
  async listForClientByInstructor(
    instructorId: string,
    clientId: string,
    query: CoachClientLogsQueryDto,
  ): Promise<PaginatedResponse<WorkoutLogView | SkippedPlanDay>> {
    // 404 unless ACTIVE; then the coach's own assignments.
    const own = await this.coachAccess.readableAssignmentIds(
      instructorId,
      clientId,
    );
    return this._timelinePage(clientId, { own }, query);
  }

  /**
   * The trainee's own History. `kind=all` is the timeline: every finished
   * workout and the skipped days of their plans, which leave no log, paged
   * together in date order. Narrowed by a photo or record chip, or a
   * search, it is the finished workouts alone (`listForUser`), as is a
   * request with no `kind`.
   */
  async listHistory(userId: string, query: ListWorkoutLogsQueryDto) {
    if (query.kind === 'all' && !query.has && !query.search) {
      return this._timelinePage(userId, 'owner', query);
    }
    return this.listForUser(userId, query);
  }

  /** One page of a timeline, logs hydrated as history rows. */
  private async _timelinePage(
    userId: string,
    reader: TimelineReader,
    query: TimelineQuery,
  ): Promise<PaginatedResponse<WorkoutLogView | SkippedPlanDay>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { sql, replacements } = this._timeline(userId, reader, query);

    const [entries, totals] = await Promise.all([
      this.sequelize.query<CoachTimelineEntry>(
        `${sql} ORDER BY at DESC, id DESC LIMIT :limit OFFSET :offset`,
        {
          replacements: {
            ...replacements,
            limit,
            offset: getOffset(page, limit),
          },
          type: QueryTypes.SELECT,
        },
      ),
      this.sequelize.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM (${sql}) AS timeline`,
        { replacements, type: QueryTypes.SELECT },
      ),
    ]);

    const logIds = entries.filter((e) => e.kind === 'LOG').map((e) => e.id);
    const logs = logIds.length
      ? await this._historyRows(
          await this.logModel.findAll({
            where: { id: { [Op.in]: logIds } },
            include: this._historyIncludes(),
          }),
        )
      : [];
    const byId = new Map(logs.map((log) => [log.id, log]));
    const items = entries.flatMap(
      (entry): (WorkoutLogView | SkippedPlanDay)[] => {
        if (entry.kind === 'SKIPPED') return [this._skippedRow(entry, userId)];
        const log = byId.get(entry.id);
        return log ? [log as WorkoutLogView] : [];
      },
    );
    return buildPaginatedResponse(
      items,
      Number(totals[0]?.total ?? 0),
      page,
      limit,
    );
  }

  /**
   * The timeline as one query of ids, so the two sources page together:
   * finished logs and skipped plan days. The owner sees all of theirs. A
   * coach sees the logs they may read, and the skipped days of their own
   * plans only: a skip has no visibility level, so only the plan's coach
   * sees it. A skipped day sits at noon UTC, which is its own date in any
   * timezone a client trains in.
   */
  private _timeline(
    clientId: string,
    reader: TimelineReader,
    query: TimelineQuery,
  ): { sql: string; replacements: Record<string, unknown> } {
    const own = reader === 'owner' ? [] : reader.own;
    const hasOwn = own.length > 0;
    const fromOwn = hasOwn ? 'wl.program_assignment_id IN (:own)' : 'FALSE';
    const readable =
      reader === 'owner'
        ? ''
        : `AND (${fromOwn} OR wl.visibility IN (:shared))`;
    const skipsOf =
      reader === 'owner'
        ? 'pa.client_id = :clientId AND pa.deleted_at IS NULL'
        : 'aw.program_assignment_id IN (:own)';
    const withSkips =
      (reader === 'owner' || hasOwn) &&
      (query.kind === 'all' || query.kind === 'skipped');
    const logs =
      query.kind === 'skipped'
        ? null
        : `
        SELECT wl.id, 'LOG' AS kind, wl.started_at AS at,
          NULL::varchar AS name, NULL::char(36) AS assignment_id,
          NULL::varchar AS program_name, NULL::varchar AS assignment_kind,
          NULL::char(36) AS master_program_id
        FROM workout_log wl
        WHERE wl.user_id = :clientId
          AND wl.status = 'COMPLETED'
          ${readable}
          ${query.kind === 'plan' ? `AND ${fromOwn}` : ''}
          ${query.kind === 'own' ? `AND NOT COALESCE(${fromOwn}, FALSE)` : ''}`;
    const skips = withSkips
      ? `
        SELECT aw.id, 'SKIPPED' AS kind,
          (aw.scheduled_date + TIME '12:00') AT TIME ZONE 'UTC' AS at,
          aw.name::varchar AS name, pa.id AS assignment_id,
          pa.program_name_snapshot::varchar AS program_name,
          pa.assignment_kind::varchar AS assignment_kind,
          pa.master_program_id AS master_program_id
        FROM assigned_workout aw
        JOIN program_assignment pa ON pa.id = aw.program_assignment_id
        WHERE ${skipsOf}
          AND aw.status = 'SKIPPED'
          AND aw.scheduled_date IS NOT NULL`
      : null;
    const branches = [logs, skips].filter((b): b is string => b !== null);
    const union = branches.length
      ? branches.join('\n        UNION ALL')
      : // Nothing this reader may see: an empty list, not an error.
        `SELECT NULL::char(36) AS id, NULL::text AS kind, NULL::timestamptz AS at,
          NULL::varchar AS name, NULL::char(36) AS assignment_id,
          NULL::varchar AS program_name, NULL::varchar AS assignment_kind,
          NULL::char(36) AS master_program_id
        WHERE FALSE`;
    const bounds = [
      query.dateFrom ? 'at >= :dateFrom' : null,
      query.dateTo ? 'at < :dateTo' : null,
    ].filter((b): b is string => b !== null);

    return {
      sql: `SELECT * FROM (${union}) AS entries${
        bounds.length ? ` WHERE ${bounds.join(' AND ')}` : ''
      }`,
      replacements: {
        clientId,
        ...(reader === 'owner' ? {} : { shared: [...SHARED_WITH_COACHES] }),
        ...(hasOwn ? { own } : {}),
        ...(query.dateFrom ? { dateFrom: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { dateTo: new Date(query.dateTo) } : {}),
      },
    };
  }

  /** A skipped plan day, in a history row's shape. */
  private _skippedRow(
    entry: CoachTimelineEntry,
    clientId: string,
  ): SkippedPlanDay {
    return {
      id: entry.id,
      userId: clientId,
      name: entry.name ?? '',
      status: WorkoutLogStatus.Skipped,
      startedAt: new Date(entry.at),
      completedAt: null,
      durationSeconds: null,
      feelingRating: null,
      notes: null,
      assignedWorkoutId: entry.id,
      programAssignmentId: entry.assignment_id,
      assignment: entry.assignment_id
        ? {
            id: entry.assignment_id,
            programNameSnapshot: entry.program_name,
            masterProgramId: entry.master_program_id,
            assignmentKind: entry.assignment_kind as ProgramAssignmentKind,
          }
        : null,
      exercises: [],
    };
  }

  /**
   * Coach view of one log. 404 if the log isn't owned by an ACTIVE
   * client of this instructor.
   */
  async findByIdForInstructor(
    id: string,
    instructorId: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<WorkoutLogView> {
    const stub = await this.logModel.findByPk(id, {
      attributes: ['userId', 'programAssignmentId', 'visibility'],
    });
    if (!stub) throw new NotFoundException(apiError('workout.logNotFound'));

    // Same gate as the list: anything off this coach's plans is the
    // client's own business unless they shared it. 404 rather than 403,
    // consistent with the rest of the coach surface: it does not confirm
    // that a private session exists.
    const own = await this.coachAccess.readableAssignmentIds(
      instructorId,
      stub.userId,
    );
    if (!isReadableByCoach(stub, own)) {
      throw new NotFoundException(apiError('workout.logNotFound'));
    }
    return this.findById(id, stub.userId, locale);
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
        'pausedAt',
        'pausedSeconds',
        'assignedWorkoutId',
        'programAssignmentId',
      ],
    });
  }

  /**
   * A workout from a while back, next to how far one of its lifts has come
   * since: History's "A month ago" card. Looks a year, six, three and one
   * month back (a few days either side), oldest first since the longer the
   * span the better the story, and takes the first workout there whose
   * heaviest set on some exercise has since been beaten; a photo is
   * preferred. Null when nothing has improved: no card beats faked praise.
   */
  async memoryFor(
    userId: string,
    locale: Locale = DEFAULT_LOCALE,
    now = new Date(),
  ): Promise<WorkoutMemory | null> {
    for (const monthsAgo of MEMORY_LOOKBACK_MONTHS) {
      const centre = new Date(now);
      centre.setMonth(centre.getMonth() - monthsAgo);
      const candidates = await this.sequelize.query<{
        id: string;
        name: string;
        completedAt: Date;
        hasPhoto: boolean;
        photoVersion: number | null;
      }>(
        `
        SELECT id, name, completed_at AS "completedAt",
               photo_public_id IS NOT NULL AS "hasPhoto", photo_version AS "photoVersion"
        FROM workout_log
        WHERE user_id = :userId
          AND status = 'COMPLETED'
          AND completed_at BETWEEN :from AND :to
        ORDER BY (photo_public_id IS NOT NULL) DESC, completed_at DESC
        LIMIT ${MEMORY_CANDIDATES}
        `,
        {
          replacements: {
            userId,
            from: new Date(centre.getTime() - MEMORY_WINDOW_MS),
            to: new Date(centre.getTime() + MEMORY_WINDOW_MS),
          },
          type: QueryTypes.SELECT,
        },
      );

      for (const workout of candidates) {
        const [gain] = await this.sequelize.query<{
          exerciseId: string;
          fromKg: string;
          toKg: string;
        }>(
          `
          WITH then_best AS (
            SELECT le.exercise_id, MAX(ls.weight_kg) AS kg
            FROM logged_exercise le
            JOIN logged_set ls ON ls.logged_exercise_id = le.id
            WHERE le.workout_log_id = :logId
              AND le.exercise_id IS NOT NULL
              AND ls.is_completed = TRUE
              AND ls.weight_kg > 0
            GROUP BY le.exercise_id
          ),
          since_best AS (
            SELECT le.exercise_id, MAX(ls.weight_kg) AS kg
            FROM workout_log wl
            JOIN logged_exercise le ON le.workout_log_id = wl.id
            JOIN logged_set ls ON ls.logged_exercise_id = le.id
            WHERE wl.user_id = :userId
              AND wl.status = 'COMPLETED'
              AND wl.completed_at > :thenAt
              AND wl.completed_at <= :now
              AND le.exercise_id IN (SELECT exercise_id FROM then_best)
              AND ls.is_completed = TRUE
              AND ls.weight_kg > 0
            GROUP BY le.exercise_id
          )
          SELECT t.exercise_id AS "exerciseId", t.kg AS "fromKg", s.kg AS "toKg"
          FROM then_best t
          JOIN since_best s ON s.exercise_id = t.exercise_id
          WHERE s.kg > t.kg
          ORDER BY (s.kg - t.kg) DESC, t.exercise_id
          LIMIT 1
          `,
          {
            replacements: {
              logId: workout.id,
              userId,
              thenAt: workout.completedAt,
              now,
            },
            type: QueryTypes.SELECT,
          },
        );
        if (!gain) continue;

        const exercise = await this.exerciseModel.findByPk(gain.exerciseId, {
          attributes: ['id', 'name', 'translations'],
        });
        return {
          monthsAgo,
          workout: {
            id: workout.id,
            name: workout.name,
            completedAt: workout.completedAt,
            hasPhoto: workout.hasPhoto,
            photoVersion: workout.hasPhoto ? workout.photoVersion : null,
          },
          exercise: {
            id: gain.exerciseId,
            name: this._exerciseName(exercise, locale),
            fromKg: Number(gain.fromKg),
            toKg: Number(gain.toKg),
          },
        };
      }
    }
    return null;
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
    if (!owned) throw new NotFoundException(apiError('workout.logNotFound'));

    const log = await this.logModel.findOne({
      where: { userId, assignedWorkoutId },
      order: [['startedAt', 'DESC']],
      attributes: ['id'],
    });
    if (!log) throw new NotFoundException(apiError('workout.logNotFound'));
    return log;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  /**
   * The name a log keeps for an exercise: translated when it is one of
   * ours, and a plain "Exercise" in the person's language when the row is
   * gone.
   */
  private _exerciseName(
    exercise: Exercise | null | undefined,
    locale: Locale,
  ): string {
    return exercise
      ? translatedText(exercise, 'name', locale)
      : translate(locale, 'content.unnamedExercise');
  }

  /**
   * A person's workouts as their profile shows them: only `levels`, and
   * only what is safe to show anyone who may see that level. Name, date,
   * duration, sets, records and the share message; never the private
   * note, weights, the plan behind it or a coach's name.
   */
  async listForProfile(
    userId: string,
    levels: readonly WorkoutVisibility[],
    query: PaginationDto,
  ): Promise<PaginatedResponse<ProfileWorkout>> {
    const page = await this.listForUser(userId, query, undefined, levels);
    return {
      ...page,
      items: page.items.map((log) => profileSummary(log, log.prCount ?? 0)),
    };
  }

  /**
   * One workout as its profile card shows it, under the same rule as the
   * list: finished, one of `levels`, not taken down. Anything else is a
   * 404, so the answer never confirms a hidden workout exists.
   */
  async findForProfile(
    userId: string,
    levels: readonly WorkoutVisibility[],
    workoutLogId: string,
  ): Promise<ProfileWorkout> {
    const log = await this.logModel.findOne({
      where: { id: workoutLogId, ...profileVisibleWhere(userId, levels) },
      include: [
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
    });
    if (!log) throw new NotFoundException(apiError('workout.logNotFound'));
    const prCounts = await this._countSessionPrs([log]);
    return profileSummary(log, prCounts.get(log.id) ?? 0);
  }

  /**
   * Cards for workouts shared into group posts: the same safe summary as a
   * profile, plus whether it is also on the author's profile (Public), so
   * a tap can go there. A feed mixes people, so records are counted per
   * author (`_countSessionPrs` reads one person's rows).
   */
  async summariesForPosts(
    ids: readonly string[],
  ): Promise<Map<string, PostWorkout>> {
    if (ids.length === 0) return new Map();
    const logs = await this.logModel.findAll({
      where: {
        id: { [Op.in]: [...new Set(ids)] },
        status: WorkoutLogStatus.Completed,
        takenDownAt: null,
      },
      include: [
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
    });
    const byAuthor = new Map<string, WorkoutLog[]>();
    for (const log of logs) {
      byAuthor.set(log.userId, [...(byAuthor.get(log.userId) ?? []), log]);
    }
    const prCounts = new Map<string, number>();
    for (const authored of byAuthor.values()) {
      for (const [id, n] of await this._countSessionPrs(authored)) {
        prCounts.set(id, n);
      }
    }
    return new Map(
      logs.map((log) => {
        const onProfile = log.visibility === WorkoutVisibility.Public;
        const summary = profileSummary(log, prCounts.get(log.id) ?? 0);
        // A card carries no photo; one is there only to open on a Public
        // profile, through its own endpoint.
        return [
          log.id,
          {
            ...summary,
            hasPhoto: onProfile && summary.hasPhoto,
            photoVersion: onProfile ? summary.photoVersion : null,
            onProfile,
          },
        ];
      }),
    );
  }

  /**
   * Only the author's own finished workout can go into a post. 404
   * otherwise; one taken down after a report cannot go anywhere.
   */
  async assertShareable(workoutLogId: string, userId: string): Promise<void> {
    const log = await this.logModel.findByPk(workoutLogId, {
      attributes: ['id', 'userId', 'status', 'takenDownAt'],
    });
    if (
      !log ||
      log.userId !== userId ||
      log.status !== WorkoutLogStatus.Completed
    ) {
      throw new NotFoundException(apiError('workout.logNotFound'));
    }
    if (log.takenDownAt) {
      throw new BadRequestException(apiError('workout.takenDownNoShare'));
    }
  }

  /** How many of `levels` there are, so a profile can leave the section out. */
  countForProfile(
    userId: string,
    levels: readonly WorkoutVisibility[],
  ): Promise<number> {
    return this.logModel.count({ where: profileVisibleWhere(userId, levels) });
  }

  /**
   * Who sees a workout besides its owner. The coach whose plan it came
   * from sees it at any level (`isReadableByCoach`); this decides for
   * everyone else. One taken down after a report stays Only me: opening
   * it to coaches again would show it to whoever reported it.
   */
  async setVisibility(
    workoutLogId: string,
    userId: string,
    visibility: WorkoutVisibility,
  ): Promise<{ id: string; visibility: WorkoutVisibility }> {
    const log = await this._loadOwnedLog(workoutLogId, userId);
    if (log.takenDownAt && visibility !== WorkoutVisibility.OnlyMe) {
      throw new BadRequestException(apiError('workout.takenDownStaysPrivate'));
    }
    if (log.visibility !== visibility) await log.update({ visibility });
    return { id: log.id, visibility };
  }

  /** The level a new workout starts at: the person's own default, else private. */
  private async _defaultVisibility(userId: string): Promise<WorkoutVisibility> {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'privacySettings'],
    });
    return resolveLevel(user?.privacySettings, 'workouts');
  }

  private async _loadOwnedLog(id: string, userId: string): Promise<WorkoutLog> {
    const log = await this.logModel.findByPk(id);
    if (!log || log.userId !== userId) {
      throw new NotFoundException(apiError('workout.logNotFound'));
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
