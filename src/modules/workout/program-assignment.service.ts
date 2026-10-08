import {
  BadRequestException,
  ForbiddenException,
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
  apiError,
  toLocale,
  translatedText,
  type Locale,
} from '../../common/i18n';
import { escapeLikeWildcards } from '../../common/utils/search.utils';

import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import {
  buildPaginatedResponse,
  getOffset,
} from '../../common/dto/pagination.dto';
import { Exercise } from '../exercise/entities/exercise.entity';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import {
  ProgramAssignmentKind,
  ProgramAssignmentStatus,
  ProgramRepeatMode,
  ProgramSource,
  ProgramStatus,
  WorkoutLogStatus,
} from './entities/workout.enums';
import { AssignProgramDto } from './dto/assign-program.dto';
import { ListAssignmentsQueryDto } from './dto/list-assignments.query.dto';
import { ScheduleRoutineDto } from './dto/schedule-routine.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import {
  clientCompletedPlanForInstructor,
  programAssignedForClient,
} from './notifications';

/**
 * ProgramAssignmentService — the copy-on-assign headliner (locked
 * decision §10). Atomically clones the entire program tree into the
 * `assigned_*` tables so the client's view is independent of the
 * master forever.
 *
 * Status lifecycle:
 *   PENDING → ACTIVE ↔ PAUSED → COMPLETED
 *                              ↘
 *                               CANCELLED   (terminal)
 *
 * V1 defaults new assignments to ACTIVE — the client should see them
 * immediately. PENDING is reserved for future "instructor sends an
 * invitation, client accepts" flows.
 */
@Injectable()
export class ProgramAssignmentService {
  constructor(
    @InjectModel(ProgramAssignment)
    private readonly assignmentModel: typeof ProgramAssignment,
    @InjectModel(AssignedWorkout)
    private readonly assignedWorkoutModel: typeof AssignedWorkout,
    @InjectModel(AssignedExercise)
    private readonly assignedExerciseModel: typeof AssignedExercise,
    @InjectModel(AssignedSet)
    private readonly assignedSetModel: typeof AssignedSet,
    @InjectModel(Program) private readonly programModel: typeof Program,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // The deep-copy headliner
  // ────────────────────────────────────────────────────────────────────

  /**
   * Atomically clone a program → assignment for a single client.
   *
   * Steps in one transaction:
   *   1. Load the master program with full include tree.
   *   2. Validate instructor owns the program + has an ACTIVE
   *      relationship with the client.
   *   3. Create `program_assignment` (status ACTIVE by default,
   *      snapshots program name).
   *   4. For each program_workout: create assigned_workout with
   *      `scheduled_date = start_date + week*7 + day`.
   *   5. For each prescribed_exercise: create assigned_exercise.
   *   6. For each prescribed_set: create assigned_set (targets
   *      copied verbatim; %1RM resolution defers to log start).
   *   7. After commit: notify the client.
   *
   * Rollback is automatic — any failure unwinds all writes.
   */
  async assignProgramToClient(
    instructorId: string,
    instructorName: string,
    dto: AssignProgramDto,
  ): Promise<ProgramAssignment> {
    const program = await this.programModel.findByPk(dto.programId, {
      include: [
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

    // Assignable programs are either owned by the caller, or one of
    // MotionHive's published SYSTEM starters (ownerless). Anything else
    // — a draft, an archived starter, another instructor's private
    // program — 404s with the same "not found" so we don't leak the
    // program's existence.
    const isOwnedByCaller = !!program && program.ownerId === instructorId;
    const isSystemStarter =
      !!program &&
      program.ownerId === null &&
      program.source === ProgramSource.System &&
      program.status === ProgramStatus.Published;
    if (!program || (!isOwnedByCaller && !isSystemStarter)) {
      throw new NotFoundException(apiError('workout.programNotFound'));
    }
    if (program.deletedAt) {
      throw new BadRequestException(apiError('workout.cannotAssignDeleted'));
    }

    // The client must be in an ACTIVE instructor↔client relationship.
    const relationship = await this.instructorClientModel.findOne({
      where: {
        instructorId,
        clientId: dto.clientId,
        status: InstructorClientStatus.ACTIVE,
      },
    });
    if (!relationship) {
      throw new ForbiddenException(apiError('workout.assignActiveClientsOnly'));
    }

    // Pull the client display name for the notification (we already
    // have instructorName via the controller).
    const client = await this.userModel.findByPk(dto.clientId, {
      attributes: ['id', 'firstName', 'lastName', 'language'],
    });
    if (!client) {
      throw new NotFoundException(apiError('workout.clientNotFound'));
    }
    // The assignment is the client's copy of the plan, so a starter's text
    // is written in the language they train in.
    const clientLocale = toLocale(client.language);
    const programName = translatedText(program, 'name', clientLocale);

    // Resolved before the transaction opens: a day-count mismatch is a bad
    // request and should be refused before anything is written.
    const dayMap = this.buildDayMap(program.workouts ?? [], dto.daysOfWeek);

    const created = await this.sequelize.transaction(async (tx) => {
      const assignment = await this.assignmentModel.create(
        {
          instructorId,
          clientId: dto.clientId,
          instructorClientId: relationship.id,
          masterProgramId: program.id,
          programNameSnapshot: programName,
          status: ProgramAssignmentStatus.Active,
          startDate: dto.startDate,
          endDate: this.computeEndDate(program, dto.startDate, dayMap),
          completionPercent: 0,
          notes: dto.notes?.trim() || null,
        },
        { transaction: tx },
      );

      await this.cloneTree(
        assignment.id,
        program,
        dto.startDate,
        tx,
        dayMap,
        clientLocale,
      );
      return assignment;
    });

    // notify-after-commit (best-effort — failure here doesn't roll the assignment back)
    try {
      const instructorDisplayName = instructorName.trim() || 'Your coach';
      await this.notificationService.notify(
        programAssignedForClient({
          clientId: dto.clientId,
          assignmentId: created.id,
          programName,
          startDate: dto.startDate,
          instructorName: instructorDisplayName,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `PROGRAM_ASSIGNED notification failed for ${created.id}: ${(err as Error).message}`,
        'ProgramAssignmentService',
      );
    }

    return created;
  }

  // ────────────────────────────────────────────────────────────────────
  // Listing / detail
  // ────────────────────────────────────────────────────────────────────

  async listForInstructor(
    instructorId: string,
    query: ListAssignmentsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      instructorId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...this._searchWhere(query.search),
    };
    const { rows, count } = await this.assignmentModel.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'client',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl', 'handle'],
        },
      ],
      order: [['updatedAt', 'DESC']],
      offset: getOffset(page, limit),
      limit,
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * `iLike` on the denormalised name, so search needs no join. Escapes
   * the LIKE wildcards — otherwise a stray `%` matches everything and a
   * `_` silently matches any character.
   */
  private _searchWhere(search?: string) {
    const term = search?.trim();
    if (!term) return {};
    const escaped = escapeLikeWildcards(term);
    return { programNameSnapshot: { [Op.iLike]: `%${escaped}%` } };
  }

  /**
   * Same escaping as `_searchWhere`, widened to the eager-loaded coach.
   *
   * The `$instructor.x$` form is resolved as raw SQL against the joined
   * table, so it needs the *column* name, not the model attribute —
   * `underscored: true` means `firstName` is `first_name` on disk and
   * the camelCase form errors with "column does not exist".
   */
  private _clientSearchWhere(search?: string) {
    const term = search?.trim();
    if (!term) return {};
    const like = `%${escapeLikeWildcards(term)}%`;
    return {
      [Op.or]: [
        { programNameSnapshot: { [Op.iLike]: like } },
        { '$instructor.first_name$': { [Op.iLike]: like } },
        { '$instructor.last_name$': { [Op.iLike]: like } },
      ],
    };
  }

  async listForClient(clientId: string, query: ListAssignmentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      clientId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      // Program name OR coach name, because that is what the client-side
      // search box has always claimed to cover. It used to filter only
      // the page already in memory, so a plan on page 2 was unfindable.
      ...this._clientSearchWhere(query.search),
    };
    const { rows, count } = await this.assignmentModel.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl', 'handle'],
        },
      ],
      order: [['startDate', 'DESC']],
      offset: getOffset(page, limit),
      limit,
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Detail with full nested tree — readable by either party. 404 on
   * cross-tenant access (hides existence).
   */
  async findById(id: string, userId: string): Promise<ProgramAssignment> {
    const assignment = await this.assignmentModel.findByPk(id, {
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl', 'handle'],
        },
        {
          model: User,
          as: 'client',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl', 'handle'],
        },
        {
          model: AssignedWorkout,
          as: 'workouts',
          separate: true,
          order: [['sequenceNumber', 'ASC']],
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
                  model: AssignedSet,
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
    if (!assignment) {
      throw new NotFoundException(apiError('workout.assignmentNotFound'));
    }
    if (assignment.instructorId !== userId && assignment.clientId !== userId) {
      throw new NotFoundException(apiError('workout.assignmentNotFound'));
    }
    return assignment;
  }

  // ────────────────────────────────────────────────────────────────────
  // Mutations
  // ────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateAssignmentDto,
    instructorId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this._loadOwnedByInstructor(id, instructorId);
    if (dto.status) {
      this._assertStatusTransition(assignment.status, dto.status);
    }
    await assignment.update({
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
    });
    return assignment;
  }

  async softDelete(id: string, instructorId: string): Promise<void> {
    const assignment = await this._loadOwnedByInstructor(id, instructorId);
    await assignment.destroy();
  }

  /**
   * How far ahead a rolling (WEEKLY) schedule materialises. A fixed
   * horizon rather than infinite generation: enough that the week strip
   * and "today" always have something to read, small enough that
   * changing your mind doesn't orphan a year of rows. Extending it as
   * time passes is a cron job, mirroring `sessions.generate_recurring`.
   */
  private static readonly ROLLING_HORIZON_WEEKS = 8;

  /**
   * Schedule one of your own routines across the week.
   *
   * This is self-assignment: the same copy-on-assign machinery a coach
   * gets, with no coach involved. It reuses `program_assignment` so the
   * Workouts front door, the week strip and progress all read one
   * table, whether the plan came from an instructor or from you.
   *
   * A routine is a single workout, so it fans out: one `assigned_workout`
   * per selected weekday per week.
   */
  async scheduleRoutine(
    userId: string,
    dto: ScheduleRoutineDto,
    today: string,
  ): Promise<ProgramAssignment> {
    const program = await this.programModel.findByPk(dto.programId, {
      include: [
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

    // Own it or it doesn't exist, same hide-existence rule as elsewhere.
    if (!program || program.ownerId !== userId) {
      throw new NotFoundException(apiError('workout.routineNotFound'));
    }
    const source = program.workouts?.[0];
    if (!source) {
      throw new BadRequestException(
        apiError('workout.routineNothingToSchedule'),
      );
    }

    const repeatMode = dto.repeatMode ?? ProgramRepeatMode.Weekly;
    if (repeatMode === ProgramRepeatMode.Block && !dto.repeatWeeks) {
      throw new BadRequestException(apiError('workout.blockNeedsWeeks'));
    }

    const startDate = dto.startDate ?? today;
    const weeks =
      repeatMode === ProgramRepeatMode.Block
        ? (dto.repeatWeeks as number)
        : ProgramAssignmentService.ROLLING_HORIZON_WEEKS;

    const days = [...dto.daysOfWeek].sort((a, b) => a - b);
    const dates = this._expandWeekdays(startDate, days, weeks);

    return this.sequelize.transaction(async (tx) => {
      const assignment = await this.assignmentModel.create(
        {
          instructorId: null,
          assignmentKind: ProgramAssignmentKind.Self,
          clientId: userId,
          instructorClientId: null,
          masterProgramId: program.id,
          programNameSnapshot: program.name,
          status: ProgramAssignmentStatus.Active,
          startDate,
          endDate: dates.length ? dates[dates.length - 1] : startDate,
          repeatMode,
          repeatWeeks:
            repeatMode === ProgramRepeatMode.Block
              ? (dto.repeatWeeks as number)
              : null,
        },
        { transaction: tx },
      );

      for (const [index, date] of dates.entries()) {
        const aw = await this.assignedWorkoutModel.create(
          {
            programAssignmentId: assignment.id,
            masterWorkoutId: source.id,
            name: program.name,
            notes: source.notes,
            weekIndex: Math.floor(index / days.length),
            dayIndex: this._isoWeekdayToDayIndex(date),
            sequenceNumber: index,
            estimatedDurationMinutes: source.estimatedDurationMinutes,
            scheduledDate: date,
            status: null,
          },
          { transaction: tx },
        );

        for (const px of source.exercises ?? []) {
          const ae = await this.assignedExerciseModel.create(
            {
              assignedWorkoutId: aw.id,
              exerciseId: px.exerciseId,
              masterExerciseId: px.id,
              supersetGroupId: px.supersetGroupId,
              orderIndex: px.orderIndex,
              notes: px.notes,
              alternateExerciseId: px.alternateExerciseId,
            },
            { transaction: tx },
          );

          await this.assignedSetModel.bulkCreate(
            (px.sets ?? []).map((ps) => ({
              assignedExerciseId: ae.id,
              masterSetId: ps.id,
              orderIndex: ps.orderIndex,
              setType: ps.setType,
              targetRepsMin: ps.targetRepsMin,
              targetRepsMax: ps.targetRepsMax,
              targetWeightKg: ps.targetWeightKg,
              targetWeightPercent1rm: ps.targetWeightPercent1rm,
              targetDurationSeconds: ps.targetDurationSeconds,
              targetDistanceMeters: ps.targetDistanceMeters,
              targetRpe: ps.targetRpe,
              targetRir: ps.targetRir,
              restAfterSeconds: ps.restAfterSeconds,
              tempo: ps.tempo,
              notes: ps.notes,
            })),
            { transaction: tx },
          );
        }
      }

      return assignment;
    });
  }

  /**
   * Every date matching `daysOfWeek` for `weeks` weeks, starting from
   * the week containing `startDate` but never before it — scheduling on
   * Wednesday shouldn't back-fill Monday.
   */
  private _expandWeekdays(
    startDate: string,
    daysOfWeek: number[],
    weeks: number,
  ): string[] {
    const start = new Date(`${startDate}T00:00:00Z`);
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    const monday = new Date(start);
    monday.setUTCDate(start.getUTCDate() - daysSinceMonday);

    const out: string[] = [];
    for (let w = 0; w < weeks; w++) {
      for (const iso of daysOfWeek) {
        const d = new Date(monday);
        d.setUTCDate(monday.getUTCDate() + w * 7 + (iso - 1));
        const asIso = d.toISOString().slice(0, 10);
        if (asIso >= startDate) out.push(asIso);
      }
    }
    return out;
  }

  /** `assigned_workout.day_index` is 0=Mon..6=Sun (CHECK 0..6). */
  private _isoWeekdayToDayIndex(date: string): number {
    const d = new Date(`${date}T00:00:00Z`);
    return (d.getUTCDay() + 6) % 7;
  }

  /**
   * The Workouts front door: what am I doing today, and what does the
   * rest of this week look like.
   *
   * One read on purpose. Composing this on the client would mean
   * listing assignments and then fetching each one's tree to find
   * today — an N+1 on the most-visited surface in the app.
   *
   * Scoped to assignments only. Routines and any in-progress log come
   * from their own endpoints, which the client already calls; there is
   * no reason to duplicate them here.
   *
   * @param today client-calendar date as `YYYY-MM-DD`, so the day
   *   boundary follows the person training rather than the server.
   */
  async getTrainingDay(clientId: string, today: string) {
    const activePlans = await this.assignmentModel.findAll({
      where: {
        clientId,
        deletedAt: null,
        status: {
          [Op.in]: [
            ProgramAssignmentStatus.Active,
            ProgramAssignmentStatus.Pending,
          ],
        },
      },
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl', 'handle'],
        },
      ],
      order: [['startDate', 'DESC']],
    });

    if (!activePlans.length) {
      return { today: null, week: [], activePlans: [] };
    }

    const planIds = activePlans.map((p) => p.id);
    const { weekStart, weekEnd } = this._weekBounds(today);

    const workouts = await this.assignedWorkoutModel.findAll({
      where: {
        programAssignmentId: { [Op.in]: planIds },
        scheduledDate: { [Op.between]: [weekStart, weekEnd] },
      },
      order: [['scheduledDate', 'ASC']],
    });

    const planById = new Map(activePlans.map((p) => [p.id, p]));
    const week = workouts.map((w) => {
      const plan = planById.get(w.programAssignmentId);
      return {
        assignedWorkoutId: w.id,
        programAssignmentId: w.programAssignmentId,
        name: w.name,
        scheduledDate: w.scheduledDate,
        status: w.status,
        weekIndex: w.weekIndex,
        dayIndex: w.dayIndex,
        estimatedDurationMinutes: w.estimatedDurationMinutes,
        planName: plan?.programNameSnapshot ?? null,
        instructor: plan?.instructor ?? null,
      };
    });

    // A rest day is a real answer, so "nothing today" is null rather
    // than an error or a silent fallback to the next workout.
    const todaysWorkout = week.find((w) => w.scheduledDate === today) ?? null;

    // Today alone carries its exercises, so the card can say what the
    // session holds without a second read. One workout's worth, never
    // the week's.
    const todaysExercises = todaysWorkout
      ? await this.assignedExerciseModel.findAll({
          where: { assignedWorkoutId: todaysWorkout.assignedWorkoutId },
          order: [['orderIndex', 'ASC']],
          include: [
            {
              model: Exercise,
              as: 'exercise',
              // `translations` lets the content interceptor answer in
              // the reader's language.
              attributes: ['id', 'name', 'translations'],
            },
            {
              model: AssignedSet,
              as: 'sets',
              separate: true,
              order: [['orderIndex', 'ASC']],
            },
          ],
        })
      : [];

    return {
      today: todaysWorkout
        ? { ...todaysWorkout, exercises: todaysExercises }
        : null,
      week,
      activePlans: activePlans.map((p) => ({
        id: p.id,
        programNameSnapshot: p.programNameSnapshot,
        status: p.status,
        completionPercent: p.completionPercent,
        startDate: p.startDate,
        endDate: p.endDate,
        assignmentKind: p.assignmentKind,
        instructor: p.instructor ?? null,
      })),
    };
  }

  /** Monday-to-Sunday bounds around a `YYYY-MM-DD`, as ISO dates. */
  private _weekBounds(today: string): { weekStart: string; weekEnd: string } {
    const d = new Date(`${today}T00:00:00Z`);
    const daysSinceMonday = (d.getUTCDay() + 6) % 7;
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - daysSinceMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return {
      weekStart: start.toISOString().slice(0, 10),
      weekEnd: end.toISOString().slice(0, 10),
    };
  }

  /**
   * Client manually marks an assigned workout as skipped. Locked V1
   * decision: clients can skip ahead — no reason capture in V1. This
   * mirrors what the auto-skip cron would do once it lands.
   *
   * 404s on cross-tenant access (hides existence). Won't reopen a
   * COMPLETED workout (would lie about the client's history).
   */
  async skipAssignedWorkoutAsClient(
    assignedWorkoutId: string,
    clientId: string,
  ): Promise<AssignedWorkout> {
    const aw = await this.assignedWorkoutModel.findByPk(assignedWorkoutId, {
      include: [
        {
          model: this.assignmentModel,
          as: 'assignment',
          attributes: ['id', 'clientId'],
        },
      ],
    });
    if (!aw || !aw.assignment || aw.assignment.clientId !== clientId) {
      throw new NotFoundException(apiError('workout.workoutNotFound'));
    }
    if (aw.status === WorkoutLogStatus.Completed) {
      throw new BadRequestException(apiError('workout.cannotSkipCompleted'));
    }
    await aw.update({ status: WorkoutLogStatus.Skipped });
    // Bump completion% so the plan progress reflects the skip. SKIPPED
    // counts toward "this workout is done with" the same way COMPLETED
    // does — the client moves past it either way.
    await this._recomputeProgressForSkip(aw.programAssignmentId);
    return aw;
  }

  // ────────────────────────────────────────────────────────────────────
  // System sweeps (jobs module)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Skip never-started assigned workouts whose scheduled date is in the
   * past, for ACTIVE assignments only. Driven by the daily
   * `workouts.auto_skip_past_workouts` cron — the system equivalent of
   * `skipAssignedWorkoutAsClient`, reusing the same progress recompute.
   *
   * Only touches `status IS NULL` rows: an IN_PROGRESS log (client opened
   * it but didn't finish) is left alone — auto-skip must never clobber
   * real logged work. Per-assignment tx so the skip + recompute commit
   * together; the `status = null` guard in the UPDATE keeps it idempotent
   * across retries. Silent.
   *
   * @param today client-calendar date as `YYYY-MM-DD` (DATEONLY space).
   */
  async autoSkipPastWorkouts(
    today: string,
  ): Promise<{ skipped: number; assignmentsTouched: number }> {
    const candidates = await this.assignedWorkoutModel.findAll({
      where: { status: null, scheduledDate: { [Op.lt]: today } },
      include: [
        {
          model: this.assignmentModel,
          as: 'assignment',
          required: true,
          where: { status: ProgramAssignmentStatus.Active },
          attributes: ['id'],
        },
      ],
      attributes: ['id', 'programAssignmentId'],
    });
    if (candidates.length === 0) {
      return { skipped: 0, assignmentsTouched: 0 };
    }

    const byAssignment = new Map<string, string[]>();
    for (const c of candidates) {
      const list = byAssignment.get(c.programAssignmentId) ?? [];
      list.push(c.id);
      byAssignment.set(c.programAssignmentId, list);
    }

    let skipped = 0;
    for (const [assignmentId, workoutIds] of byAssignment) {
      await this.sequelize.transaction(async (tx) => {
        const [count] = await this.assignedWorkoutModel.update(
          { status: WorkoutLogStatus.Skipped },
          {
            where: { id: { [Op.in]: workoutIds }, status: null },
            transaction: tx,
          },
        );
        skipped += count;
        await this._recomputeProgressForSkip(assignmentId, tx);
      });
    }

    if (skipped > 0) {
      this.logger.log?.(
        `Auto-skipped ${skipped} past workout(s) across ${byAssignment.size} assignment(s)`,
        'ProgramAssignmentService',
      );
    }
    return { skipped, assignmentsTouched: byAssignment.size };
  }

  /**
   * Complete ACTIVE assignments whose every workout is now COMPLETED or
   * SKIPPED. Driven by the daily `workouts.auto_complete_assignments`
   * cron (scheduled after auto-skip so a same-day skip can finish the
   * plan). Skeleton assignments (zero workouts) never auto-complete.
   *
   * Idempotent: the `status = ACTIVE` guard on the UPDATE means a re-run
   * is a no-op — which is also what keeps the notification from firing
   * twice, since only the run that actually flips the row notifies.
   */
  /**
   * Best-effort, and deliberately outside the status update: a coach's
   * notification is not worth failing a completed plan over.
   */
  private async _notifyInstructorOfPlanCompletion(
    assignment: ProgramAssignment,
    workoutsCompleted: number,
  ): Promise<void> {
    if (!assignment.instructorId || !assignment.clientId) return;
    // Self-assigned plans have the trainee on both sides; nobody needs
    // telling they finished their own programme.
    if (assignment.instructorId === assignment.clientId) return;
    try {
      const client = await this.userModel.findByPk(assignment.clientId, {
        attributes: ['firstName', 'lastName'],
      });
      const clientName =
        [client?.firstName, client?.lastName].filter(Boolean).join(' ') ||
        'Your client';

      await this.notificationService.notify(
        clientCompletedPlanForInstructor({
          instructorId: assignment.instructorId,
          clientId: assignment.clientId,
          clientName,
          programName: assignment.programNameSnapshot,
          workoutsCompleted,
        }),
      );
    } catch (err) {
      this.logger.warn?.(
        `Failed to notify instructor of completed plan ${assignment.id}: ${(err as Error).message}`,
        'ProgramAssignmentService',
      );
    }
  }

  async autoCompleteAssignments(): Promise<{ completed: number }> {
    const active = await this.assignmentModel.findAll({
      where: { status: ProgramAssignmentStatus.Active },
      // Beyond `id` because finishing a plan now notifies the coach, and
      // the builder needs who to tell and what to call it. Selecting only
      // `id` left those undefined and the notification silently skipped
      // its own guard.
      attributes: ['id', 'instructorId', 'clientId', 'programNameSnapshot'],
    });

    let completed = 0;
    for (const assignment of active) {
      const [total, outstanding] = await Promise.all([
        this.assignedWorkoutModel.count({
          where: { programAssignmentId: assignment.id },
        }),
        this.assignedWorkoutModel.count({
          where: {
            programAssignmentId: assignment.id,
            [Op.or]: [
              { status: null },
              {
                status: {
                  [Op.in]: [
                    WorkoutLogStatus.InProgress,
                    WorkoutLogStatus.Abandoned,
                  ],
                },
              },
            ],
          },
        }),
      ]);
      if (total === 0 || outstanding > 0) continue;

      // A COMPLETED assignment is 100% done by definition — pin the
      // percent too so the state is self-consistent regardless of how
      // the workouts reached done/skipped.
      const [n] = await this.assignmentModel.update(
        {
          status: ProgramAssignmentStatus.Completed,
          completionPercent: 100,
        },
        {
          where: {
            id: assignment.id,
            status: ProgramAssignmentStatus.Active,
          },
        },
      );
      completed += n;

      // Only the run that actually flipped the row notifies (n === 0 on
      // a re-run), so the cron staying idempotent keeps this to one.
      if (n > 0) {
        await this._notifyInstructorOfPlanCompletion(assignment, total);
      }
    }

    if (completed > 0) {
      this.logger.log?.(
        `Auto-completed ${completed} assignment(s)`,
        'ProgramAssignmentService',
      );
    }
    return { completed };
  }

  private async _recomputeProgressForSkip(
    assignmentId: string,
    tx?: Transaction,
  ): Promise<void> {
    const [total, done] = await Promise.all([
      this.assignedWorkoutModel.count({
        where: { programAssignmentId: assignmentId },
        transaction: tx,
      }),
      this.assignedWorkoutModel.count({
        where: {
          programAssignmentId: assignmentId,
          status: {
            [Op.in]: [WorkoutLogStatus.Completed, WorkoutLogStatus.Skipped],
          },
        },
        transaction: tx,
      }),
    ]);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    await this.assignmentModel.update(
      { completionPercent: percent },
      { where: { id: assignmentId }, transaction: tx },
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async cloneTree(
    assignmentId: string,
    program: Program,
    startDate: string,
    tx: Transaction,
    dayMap: Map<number, number> | null | undefined,
    /** Language a starter's text is copied in; a coach's own is as written. */
    locale: Locale,
  ): Promise<void> {
    const workouts = program.workouts ?? [];
    if (workouts.length === 0) {
      // Empty program is a UX choice — allow it (a "skeleton" program
      // an instructor will fill in later). No nested writes needed.
      return;
    }

    for (const pw of workouts) {
      const aw = await this.assignedWorkoutModel.create(
        {
          programAssignmentId: assignmentId,
          masterWorkoutId: pw.id,
          name: translatedText(pw, 'name', locale),
          notes: translatedText(pw, 'notes', locale),
          weekIndex: pw.weekIndex,
          // The slot the client sees, not the one the program was drawn on.
          dayIndex: dayMap?.get(pw.dayIndex) ?? pw.dayIndex,
          sequenceNumber: pw.sequenceNumber,
          phase: pw.phase,
          estimatedDurationMinutes: pw.estimatedDurationMinutes,
          scheduledDate: this.computeScheduledDate(
            startDate,
            pw,
            dayMap ?? undefined,
          ),
          status: null,
        },
        { transaction: tx },
      );

      const exercises = pw.exercises ?? [];
      for (const pe of exercises) {
        const ae = await this.assignedExerciseModel.create(
          {
            assignedWorkoutId: aw.id,
            exerciseId: pe.exerciseId,
            masterExerciseId: pe.id,
            supersetGroupId: pe.supersetGroupId,
            orderIndex: pe.orderIndex,
            notes: translatedText(pe, 'notes', locale),
            alternateExerciseId: pe.alternateExerciseId,
            isModifiedFromMaster: false,
          },
          { transaction: tx },
        );

        const sets = pe.sets ?? [];
        if (sets.length === 0) continue;

        await this.assignedSetModel.bulkCreate(
          sets.map((ps) => ({
            assignedExerciseId: ae.id,
            masterSetId: ps.id,
            orderIndex: ps.orderIndex,
            setType: ps.setType,
            targetRepsMin: ps.targetRepsMin,
            targetRepsMax: ps.targetRepsMax,
            targetWeightKg: ps.targetWeightKg,
            targetWeightPercent1rm: ps.targetWeightPercent1rm,
            targetDurationSeconds: ps.targetDurationSeconds,
            targetDistanceMeters: ps.targetDistanceMeters,
            targetRpe: ps.targetRpe,
            targetRir: ps.targetRir,
            restAfterSeconds: ps.restAfterSeconds,
            tempo: ps.tempo,
            notes: ps.notes,
          })),
          { transaction: tx },
        );
      }
    }
  }

  private async _loadOwnedByInstructor(
    id: string,
    instructorId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.assignmentModel.findByPk(id);
    if (!assignment || assignment.instructorId !== instructorId) {
      throw new NotFoundException(apiError('workout.assignmentNotFound'));
    }
    return assignment;
  }

  /**
   * Day 0 of the program lands on `startDate`; advance one calendar
   * day per (week*7 + day). We keep the math in pure string-date
   * space so timezone is not a concern (`DATEONLY` storage).
   */
  private computeScheduledDate(
    startDate: string,
    pw: ProgramWorkout,
    dayMap?: ReadonlyMap<number, number>,
  ): string {
    // Without a mapping, days land by counting forward from the start —
    // the original behaviour, kept for every assignment that does not ask
    // for anything else.
    if (!dayMap) {
      return this.addDays(startDate, pw.weekIndex * 7 + pw.dayIndex);
    }

    // With one, the program's day slot names a weekday instead. Week 0 is
    // the week containing `startDate`, so its Monday anchors the grid the
    // same way `_expandWeekdays` does.
    const targetDayIndex = dayMap.get(pw.dayIndex);
    if (targetDayIndex === undefined) {
      return this.addDays(startDate, pw.weekIndex * 7 + pw.dayIndex);
    }
    const daysSinceMonday = this._isoWeekdayToDayIndex(startDate);
    const mondayOfStartWeek = this.addDays(startDate, -daysSinceMonday);
    return this.addDays(mondayOfStartWeek, pw.weekIndex * 7 + targetDayIndex);
  }

  /**
   * Maps a program's own day slots onto the weekdays a coach picked.
   *
   * The program's distinct days, in order, pair with `daysOfWeek` in order:
   * a Mon/Wed/Fri program assigned to Tue/Thu/Sat keeps its shape and moves
   * wholesale. Returns null when nothing was asked for.
   *
   * The counts must match. Folding three training days into two would have
   * to drop or double up a day, and either choice is one the coach should
   * make rather than discover.
   */
  private buildDayMap(
    workouts: ProgramWorkout[],
    daysOfWeek?: number[],
  ): Map<number, number> | null {
    if (!daysOfWeek?.length) return null;

    const programDays = [...new Set(workouts.map((w) => w.dayIndex))].sort(
      (a, b) => a - b,
    );
    const chosen = [...new Set(daysOfWeek)].sort((a, b) => a - b);

    if (chosen.length !== programDays.length) {
      throw new BadRequestException(
        apiError('workout.pickTrainingDays', { count: programDays.length }),
      );
    }

    // ISO 1=Mon..7=Sun on the way in; `dayIndex` is 0=Mon..6=Sun.
    return new Map(programDays.map((d, i) => [d, chosen[i] - 1]));
  }

  private computeEndDate(
    program: Program,
    startDate: string,
    dayMap?: Map<number, number> | null,
  ): string | null {
    // The work decides the window. Counting `durationDays` forward instead
    // would end the plan before its own last session whenever the declared
    // length disagrees with the weeks that actually hold workouts — the
    // client would still have those sessions scheduled past their end date.
    const workouts = program.workouts ?? [];
    if (workouts.length) {
      const last = workouts
        .map((pw) =>
          this.computeScheduledDate(startDate, pw, dayMap ?? undefined),
        )
        .sort()
        .at(-1);
      if (last) return last;
    }

    // Nothing built yet: fall back to the declared length so a shell
    // program assigned early still has a window.
    if (!program.durationDays) return null;
    return this.addDays(startDate, program.durationDays - 1);
  }

  private addDays(isoDate: string, days: number): string {
    // Avoid Date timezone shenanigans by working in y-m-d arithmetic.
    const [y, m, d] = isoDate.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
  }

  /**
   * Status transition gate. Terminal states (COMPLETED, CANCELLED)
   * cannot move backward. Anything else can flow freely.
   */
  private _assertStatusTransition(
    current: ProgramAssignmentStatus,
    next: ProgramAssignmentStatus,
  ): void {
    if (current === next) return;
    const terminal: ProgramAssignmentStatus[] = [
      ProgramAssignmentStatus.Completed,
      ProgramAssignmentStatus.Cancelled,
    ];
    if (terminal.includes(current)) {
      throw new BadRequestException(
        apiError('workout.assignmentClosed', { status: current }),
      );
    }
  }
}
