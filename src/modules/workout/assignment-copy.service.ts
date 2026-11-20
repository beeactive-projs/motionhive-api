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
import { Op, QueryTypes, type Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { apiError, toLocale, translatedText } from '../../common/i18n';
import type { Locale } from '../../common/i18n';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import {
  ExerciseSource,
  ExerciseVisibility,
} from '../exercise/entities/exercise.enums';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import {
  CopyDayLock,
  CopyExerciseChange,
  CopySetValues,
  EDITABLE_PLAN_STATUSES,
  copyDayLock,
  copyExerciseChange,
  copyLockError,
  copyMoveFrom,
  copyMoveRefusal,
  copySlotOn,
  sameSetValues,
} from './assignment-copy.rules';
import {
  CoachAccessService,
  SHARED_WITH_COACHES,
} from './coach-access.service';
import { MoveCopyDayDto, UpdateCopyExerciseDto } from './dto/client-copy.dto';
import { AddPrescribedExercisesDto } from './dto/add-prescribed-exercises.dto';
import { ReorderPrescribedRowsDto } from './dto/reorder-prescribed-rows.dto';
import {
  PrescribedSetItemDto,
  SetPrescribedSetsDto,
} from './dto/set-prescribed-sets.dto';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { ExerciseSetType, WorkoutLogStatus } from './entities/workout.enums';
import { planAdjustedForClient } from './notifications';
import { plannedSetRest } from './planned-rest';

/** The calendar date now in UTC, as the nightly sweep compares in. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What the editor shows of a movement; `translations` so it is localised. */
const EXERCISE_ATTRIBUTES = [
  'id',
  'name',
  'slug',
  'kind',
  'level',
  'thumbnailUrl',
  'isUnilateral',
  'translations',
];

/** The client as the copy's header names them. */
export interface CopyClient {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  handle: string | null;
}

/** The plan a copy belongs to, as both reads carry it. */
export interface CopyPlanSummary {
  id: string;
  status: string;
  programNameSnapshot: string;
  masterProgramId: string | null;
  startDate: string;
  endDate: string | null;
  completionPercent: number;
  clientId: string;
  client: CopyClient | null;
}

/** One day of the copy: when it is, and whether the coach may change it. */
export interface CopyDayView {
  id: string;
  name: string;
  notes: string | null;
  weekIndex: number;
  dayIndex: number;
  scheduledDate: string | null;
  status: WorkoutLogStatus | null;
  /** Why it can't change; null when it can. */
  lock: CopyDayLock | null;
  editable: boolean;
  /** The coach changed this day of the copy at some point. */
  changed: boolean;
}

/** `GET /program-assignments/:id/copy`: every day, in date order. */
export interface CopyOverview {
  assignment: CopyPlanSummary;
  today: string;
  days: (CopyDayView & { exerciseCount: number })[];
}

/** An exercise as the program holds it now, for the line and the revert. */
export interface CopyProgramValues {
  exerciseId: string;
  exercise: Exercise | null;
  notes: string | null;
  sets: CopySetValues[];
}

/** One completed working set of the client's last time on the movement. */
export interface CopyLastSet {
  setType: string;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: number | null;
}

/** The client's last finished session of a movement the coach may read. */
export interface CopyLastResult {
  workoutLogId: string;
  performedAt: Date;
  sets: CopyLastSet[];
  /** The effort they logged, averaged over the sets that have one. */
  averageRpe: number | null;
}

/** One exercise of a day of the copy, with how it differs from the program. */
export interface CopyExerciseView {
  id: string;
  exerciseId: string;
  masterExerciseId: string | null;
  supersetGroupId: number | null;
  orderIndex: number;
  notes: string | null;
  isModifiedFromMaster: boolean;
  exercise: Exercise | null;
  sets: AssignedSet[];
  change: CopyExerciseChange;
  /** "Back to the program's values" applies: changed, and its program row is there. */
  canRevert: boolean;
  /** Its program row as it is now; null when added here or that row is gone. */
  program: CopyProgramValues | null;
  lastResult: CopyLastResult | null;
}

/** `GET /program-assignments/:id/copy/days/:dayId`. */
export interface CopyDayDetail {
  assignment: CopyPlanSummary;
  today: string;
  /** Where the day may move: first and last date, and the dates other days hold. */
  move: { from: string; to: string | null; taken: string[] };
  day: CopyDayView & { exercises: CopyExerciseView[] };
}

/** What a write inside an editable day hands back. */
interface DayWrite<T> {
  result: T;
  /** The client's copy changed, so the day is dated for the notice. */
  changed: boolean;
}

/** The locked rows a write works on. */
interface DayContext {
  assignment: ProgramAssignment;
  day: AssignedWorkout;
  tx: Transaction;
}

/** A row of the last-result query: one completed set of the latest session. */
interface LastSetRow {
  exerciseId: string;
  workoutLogId: string;
  performedAt: Date;
  setType: string;
  reps: number | null;
  weightKg: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  rpe: string | null;
}

/** A program row with the day and program its planned rest falls back to. */
type ProgramRow = PrescribedExercise & {
  workout: ProgramWorkout & { program: Program };
};

/**
 * AssignmentCopyService — a coach edits one client's copy of a plan
 * (owner, 2026-11-20). The copy is the client's own (`assigned_*`, made at
 * assign time); a change here never reaches the program or anyone else on
 * it.
 *
 * Only the plan's coach, while they still coach the client, may read or
 * change it (404 otherwise, as every coach read of a client). Only upcoming
 * days the client has not started, on a running or paused plan, can change
 * (`copyDayLock`). Each write is one request and one transaction, with the
 * day locked and checked again inside it.
 *
 * Every exercise the coach changes, replaces or adds is marked
 * (`is_modified_from_master`), and every changed day is dated
 * (`coach_changed_at`). Done tells the client once about the days changed
 * since the last notice, never per tap.
 */
@Injectable()
export class AssignmentCopyService {
  constructor(
    @InjectModel(ProgramAssignment)
    private readonly assignmentModel: typeof ProgramAssignment,
    @InjectModel(AssignedWorkout)
    private readonly assignedWorkoutModel: typeof AssignedWorkout,
    @InjectModel(AssignedExercise)
    private readonly assignedExerciseModel: typeof AssignedExercise,
    @InjectModel(AssignedSet)
    private readonly assignedSetModel: typeof AssignedSet,
    @InjectModel(PrescribedExercise)
    private readonly prescribedExerciseModel: typeof PrescribedExercise,
    @InjectModel(Exercise) private readonly exerciseModel: typeof Exercise,
    @InjectModel(WorkoutLog) private readonly logModel: typeof WorkoutLog,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly coachAccess: CoachAccessService,
    private readonly sequelize: Sequelize,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // Reads
  // ────────────────────────────────────────────────────────────────────

  /**
   * Every day of the copy in date order, each with whether it can change
   * and why not, how many exercises it holds and whether the coach changed
   * it. The weeks and the lock line are drawn from this.
   * @Arguments id, instructorId, today?
   */
  async overview(
    id: string,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<CopyOverview> {
    const assignment = await this._loadOwned(id, instructorId);
    const client = await this._client(assignment.clientId);
    const days = await this.assignedWorkoutModel.findAll({
      where: { programAssignmentId: assignment.id },
      attributes: [
        'id',
        'name',
        'notes',
        'weekIndex',
        'dayIndex',
        'scheduledDate',
        'status',
        'sequenceNumber',
        'coachChangedAt',
      ],
      order: [
        ['scheduledDate', 'ASC'],
        ['sequenceNumber', 'ASC'],
      ],
    });
    const ids = days.map((day) => day.id);
    const [logged, counts] = await Promise.all([
      this._loggedDayIds(ids),
      this._exerciseCounts(ids),
    ]);
    return {
      assignment: this._summary(assignment, client),
      today,
      days: days.map((day) => {
        let exerciseCount = 0;
        const counted = counts.get(day.id);
        if (counted !== undefined) {
          exerciseCount = counted;
        }
        return {
          ...this._dayView(assignment, day, logged.has(day.id), today),
          exerciseCount,
        };
      }),
    };
  }

  /**
   * One day of the copy, whole: its exercises and sets, how each differs
   * from the program (with the program's values as they are now), the
   * client's last result on each movement, and where the day may move.
   * @Arguments id, dayId, instructorId, today?
   */
  async day(
    id: string,
    dayId: string,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<CopyDayDetail> {
    const assignment = await this._loadOwned(id, instructorId);
    const client = await this._client(assignment.clientId);
    const day = await this.assignedWorkoutModel.findOne({
      where: { id: dayId, programAssignmentId: assignment.id },
    });
    if (!day) {
      throw new NotFoundException(apiError('workout.workoutNotFound'));
    }
    const exercises = await this.assignedExerciseModel.findAll({
      where: { assignedWorkoutId: day.id },
      order: [['orderIndex', 'ASC']],
      include: [
        {
          model: Exercise,
          as: 'exercise',
          attributes: EXERCISE_ATTRIBUTES,
          paranoid: false,
        },
        {
          model: AssignedSet,
          as: 'sets',
          separate: true,
          order: [['orderIndex', 'ASC']],
        },
      ],
    });

    const masterIds: string[] = [];
    for (const row of exercises) {
      if (row.masterExerciseId) {
        masterIds.push(row.masterExerciseId);
      }
    }
    const movementIds = [...new Set(exercises.map((row) => row.exerciseId))];
    let locale: Locale = toLocale(null);
    if (client) {
      locale = toLocale(client.language);
    }
    const [logged, programRows, lastResults, taken] = await Promise.all([
      this._loggedDayIds([day.id]),
      this._programRows(masterIds),
      this._lastResults(instructorId, assignment.clientId, movementIds),
      this._takenDates(assignment.id, day.id),
    ]);

    return {
      assignment: this._summary(assignment, client),
      today,
      move: {
        from: copyMoveFrom(today, assignment.startDate),
        to: assignment.endDate,
        taken,
      },
      day: {
        ...this._dayView(assignment, day, logged.has(day.id), today),
        exercises: exercises.map((row) => {
          let program: ProgramRow | null = null;
          if (row.masterExerciseId) {
            const found = programRows.get(row.masterExerciseId);
            if (found) {
              program = found;
            }
          }
          let lastResult: CopyLastResult | null = null;
          const last = lastResults.get(row.exerciseId);
          if (last) {
            lastResult = last;
          }
          return this._exerciseView(row, program, lastResult, locale);
        }),
      },
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Writes, one request each, inside an editable day
  // ────────────────────────────────────────────────────────────────────

  /**
   * Every set of one exercise, as the editor holds them: a set sent with
   * its id is updated in place, one without is added, one left out is
   * removed, and the list's order is the sets' order (the rules of
   * `PUT /programs/…/exercises/:id/sets`). The exercise is marked changed
   * for the client unless nothing actually changed.
   * @Arguments id, dayId, exerciseId, dto (sets), instructorId, today?
   */
  async setSets(
    id: string,
    dayId: string,
    exerciseId: string,
    dto: SetPrescribedSetsDto,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<AssignedSet[]> {
    for (const item of dto.sets) {
      this._assertSetCoherent(item);
    }
    const sentIds = new Set<string>();
    for (const item of dto.sets) {
      if (!item.id) {
        continue;
      }
      if (sentIds.has(item.id)) {
        throw new BadRequestException(apiError('workout.setListDuplicate'));
      }
      sentIds.add(item.id);
    }

    return this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ day, tx }) => {
        const row = await this._exerciseOf(day.id, exerciseId, tx);
        const existing = await this.assignedSetModel.findAll({
          where: { assignedExerciseId: row.id },
          transaction: tx,
        });
        const byId = new Map(existing.map((set) => [set.id, set]));
        for (const setId of sentIds) {
          if (!byId.has(setId)) {
            throw new NotFoundException(apiError('workout.setNotFound'));
          }
        }

        const removed = existing
          .filter((set) => !sentIds.has(set.id))
          .map((set) => set.id);
        let changed = removed.length > 0;
        if (removed.length) {
          await this.assignedSetModel.destroy({
            where: { id: removed },
            transaction: tx,
          });
        }

        for (const [index, item] of dto.sets.entries()) {
          const values = this._itemValues(item, index);
          let saved: AssignedSet | undefined;
          if (item.id) {
            saved = byId.get(item.id);
          }
          if (saved) {
            if (!sameSetValues(saved, values)) {
              changed = true;
              await saved.update(
                { ...values, resolvedWeightKg: null, resolvedAt: null },
                { transaction: tx },
              );
            }
          } else {
            changed = true;
            await this.assignedSetModel.create(
              { assignedExerciseId: row.id, masterSetId: null, ...values },
              { transaction: tx },
            );
          }
        }

        if (changed && !row.isModifiedFromMaster) {
          await row.update({ isModifiedFromMaster: true }, { transaction: tx });
        }
        const sets = await this.assignedSetModel.findAll({
          where: { assignedExerciseId: row.id },
          order: [['orderIndex', 'ASC']],
          transaction: tx,
        });
        return { result: sets, changed };
      },
    );
  }

  /**
   * Swap the movement for another (its sets stay) or change the coach's
   * note on it. Either marks the exercise changed for the client; a swap
   * shows as Replaced while its program row names another movement.
   * @Arguments id, dayId, exerciseId, dto (exerciseId?, notes?), instructorId, today?
   */
  async updateExercise(
    id: string,
    dayId: string,
    exerciseId: string,
    dto: UpdateCopyExerciseDto,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<AssignedExercise> {
    if (dto.exerciseId) {
      await this._assertExercisesUsable([dto.exerciseId], instructorId);
    }
    return this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ day, tx }) => {
        const row = await this._exerciseOf(day.id, exerciseId, tx);
        const changes: Partial<AssignedExercise> = {};
        if (dto.exerciseId && dto.exerciseId !== row.exerciseId) {
          changes.exerciseId = dto.exerciseId;
        }
        if (dto.notes !== undefined) {
          let notes: string | null = null;
          if (dto.notes && dto.notes.trim()) {
            notes = dto.notes.trim();
          }
          if (notes !== row.notes) {
            changes.notes = notes;
          }
        }
        const changed = Object.keys(changes).length > 0;
        if (changed) {
          changes.isModifiedFromMaster = true;
          await row.update(changes, { transaction: tx });
        }
        return { result: row, changed };
      },
    );
  }

  /**
   * Add several movements to the day at once, after what it holds, each
   * with its empty sets: one transaction, every movement checked first.
   * Added exercises have no program row behind them.
   * @Arguments id, dayId, dto (exercises), instructorId, today?
   */
  async addExercises(
    id: string,
    dayId: string,
    dto: AddPrescribedExercisesDto,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<AssignedExercise[]> {
    const ids = [...new Set(dto.exercises.map((item) => item.exerciseId))];
    await this._assertExercisesUsable(ids, instructorId);

    return this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ day, tx }) => {
        const last = await this.assignedExerciseModel.max('orderIndex', {
          where: { assignedWorkoutId: day.id },
          transaction: tx,
        });
        let first = 0;
        if (last !== null && last !== undefined) {
          first = Number(last) + 1;
        }
        const created: AssignedExercise[] = [];
        for (const [index, item] of dto.exercises.entries()) {
          let notes: string | null = null;
          if (item.notes && item.notes.trim()) {
            notes = item.notes.trim();
          }
          const row = await this.assignedExerciseModel.create(
            {
              assignedWorkoutId: day.id,
              exerciseId: item.exerciseId,
              masterExerciseId: null,
              supersetGroupId: null,
              orderIndex: first + index,
              notes,
              alternateExerciseId: null,
              isModifiedFromMaster: true,
            },
            { transaction: tx },
          );
          if (item.defaultSets) {
            let rest: number | null = null;
            if (item.restAfterSeconds !== undefined) {
              rest = item.restAfterSeconds;
            }
            await this.assignedSetModel.bulkCreate(
              Array.from({ length: item.defaultSets }, (_, i) => ({
                assignedExerciseId: row.id,
                masterSetId: null,
                orderIndex: i,
                setType: ExerciseSetType.Normal,
                restAfterSeconds: rest,
              })),
              { transaction: tx },
            );
          }
          created.push(row);
        }
        return { result: created, changed: true };
      },
    );
  }

  /**
   * Take an exercise out of the day, with its sets. A superset left with
   * one exercise is undone in the same transaction.
   * @Arguments id, dayId, exerciseId, instructorId, today?
   */
  async removeExercise(
    id: string,
    dayId: string,
    exerciseId: string,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<void> {
    await this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ day, tx }) => {
        const row = await this._exerciseOf(day.id, exerciseId, tx);
        const group = row.supersetGroupId;
        await row.destroy({ transaction: tx });
        if (group !== null) {
          await this._dissolveLoneSuperset(day.id, group, tx);
        }
        return { result: null, changed: true };
      },
    );
  }

  /**
   * New positions for the day's exercises, in one transaction. Rows left
   * out keep theirs; two rows on one position is refused before anything
   * is written. Reordering marks the day, not the exercises.
   * @Arguments id, dayId, dto (items), instructorId, today?
   */
  async reorderExercises(
    id: string,
    dayId: string,
    dto: ReorderPrescribedRowsDto,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<AssignedExercise[]> {
    return this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ day, tx }) => {
        const rows = await this.assignedExerciseModel.findAll({
          where: { assignedWorkoutId: day.id },
          transaction: tx,
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        const seen = new Set<string>();
        for (const item of dto.items) {
          if (!byId.has(item.id)) {
            throw new NotFoundException(apiError('exercise.notFound'));
          }
          if (seen.has(item.id)) {
            throw new BadRequestException(apiError('workout.reorderDuplicate'));
          }
          seen.add(item.id);
        }
        const target = new Map(
          dto.items.map((item) => [item.id, item.orderIndex]),
        );
        const taken = new Set<number>();
        for (const row of rows) {
          let index = row.orderIndex;
          const moved = target.get(row.id);
          if (moved !== undefined) {
            index = moved;
          }
          if (taken.has(index)) {
            throw new ConflictException(
              apiError('workout.reorderPositionClash', { position: index + 1 }),
            );
          }
          taken.add(index);
        }

        let changed = false;
        for (const item of dto.items) {
          const row = byId.get(item.id);
          if (row && row.orderIndex !== item.orderIndex) {
            changed = true;
            await row.update(
              { orderIndex: item.orderIndex },
              { transaction: tx },
            );
          }
        }
        const ordered = [...rows].sort((a, b) => a.orderIndex - b.orderIndex);
        return { result: ordered, changed };
      },
    );
  }

  /**
   * "Back to the program's values": the exercise, its note and its sets
   * as its program row is now. Sets are matched by their links: a linked
   * set takes its program set's targets and planned rest, a program set
   * with no copy is created, and a set the coach added (or whose program
   * set is gone) is removed. The mark is cleared. Refused (409) for an
   * exercise added here or whose program row is gone.
   * @Arguments id, dayId, exerciseId, instructorId, today?
   */
  async revert(
    id: string,
    dayId: string,
    exerciseId: string,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<AssignedExercise> {
    return this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ assignment, day, tx }) => {
        const row = await this._exerciseOf(day.id, exerciseId, tx);
        if (!row.masterExerciseId) {
          throw new ConflictException(apiError('workout.copyCannotRevert'));
        }
        const programRows = await this._programRows([row.masterExerciseId], tx);
        const program = programRows.get(row.masterExerciseId);
        if (!program) {
          throw new ConflictException(apiError('workout.copyCannotRevert'));
        }
        const client = await this._client(assignment.clientId, tx);
        let locale: Locale = toLocale(null);
        if (client) {
          locale = toLocale(client.language);
        }

        await row.update(
          {
            exerciseId: program.exerciseId,
            notes: translatedText(program, 'notes', locale),
            isModifiedFromMaster: false,
          },
          { transaction: tx },
        );

        const programSets = this._sortedSets(program.sets);
        const programSetIds = new Set(programSets.map((set) => set.id));
        const existing = await this.assignedSetModel.findAll({
          where: { assignedExerciseId: row.id },
          transaction: tx,
        });
        const linked = new Map<string, AssignedSet>();
        const removed: string[] = [];
        for (const set of existing) {
          const link = set.masterSetId;
          if (link && programSetIds.has(link) && !linked.has(link)) {
            linked.set(link, set);
          } else {
            removed.push(set.id);
          }
        }
        if (removed.length) {
          await this.assignedSetModel.destroy({
            where: { id: removed },
            transaction: tx,
          });
        }
        for (const set of programSets) {
          const values = this._programSetValues(set, program);
          const saved = linked.get(set.id);
          if (saved) {
            await saved.update(
              { ...values, resolvedWeightKg: null, resolvedAt: null },
              { transaction: tx },
            );
          } else {
            await this.assignedSetModel.create(
              { assignedExerciseId: row.id, masterSetId: set.id, ...values },
              { transaction: tx },
            );
          }
        }
        return { result: row, changed: true };
      },
    );
  }

  /**
   * Move the day to another date: today or later, inside the plan's start
   * and end dates, and only to a date no other day of the plan holds. Its
   * week and day slot follow the date (`copySlotOn`), so the client's plan
   * shows it where it now falls.
   * @Arguments id, dayId, dto (date), instructorId, today?
   */
  async moveDay(
    id: string,
    dayId: string,
    dto: MoveCopyDayDto,
    instructorId: string,
    today: string = utcToday(),
  ): Promise<AssignedWorkout> {
    return this._inEditableDay(
      id,
      dayId,
      instructorId,
      today,
      async ({ assignment, day, tx }) => {
        if (day.scheduledDate === dto.date) {
          return { result: day, changed: false };
        }
        const other = await this.assignedWorkoutModel.findOne({
          where: {
            programAssignmentId: assignment.id,
            id: { [Op.ne]: day.id },
            scheduledDate: dto.date,
          },
          attributes: ['id'],
          transaction: tx,
        });
        const takenDates: string[] = [];
        if (other && other.id) {
          takenDates.push(dto.date);
        }
        const refusal = copyMoveRefusal({
          date: dto.date,
          today,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
          takenDates,
        });
        if (refusal === 'workout.copyDateTaken') {
          throw new ConflictException(apiError(refusal));
        }
        if (refusal) {
          throw new BadRequestException(apiError(refusal));
        }

        let weekIndex = day.weekIndex;
        let dayIndex = day.dayIndex;
        if (day.scheduledDate) {
          const slot = copySlotOn(
            {
              scheduledDate: day.scheduledDate,
              weekIndex: day.weekIndex,
              dayIndex: day.dayIndex,
            },
            dto.date,
          );
          weekIndex = slot.weekIndex;
          dayIndex = slot.dayIndex;
        }
        await day.update(
          { scheduledDate: dto.date, weekIndex, dayIndex },
          { transaction: tx },
        );
        return { result: day, changed: true };
      },
    );
  }

  /**
   * Done: tell the client once about every day the coach changed since the
   * last notice, then remember that they were told. Nothing changed, no
   * notice, so tapping Done twice (or leaving without changing anything)
   * sends nothing. A plan that stopped running meanwhile is not news.
   * @Arguments id, instructorId
   */
  async finishEditing(
    id: string,
    instructorId: string,
  ): Promise<{ notified: boolean; days: number }> {
    const owned = await this._loadOwned(id, instructorId);
    let res: ProgramAssignment = owned;
    // Widened on purpose: it is set inside the callback, where the
    // compiler cannot see it.
    let changedDays = [] as AssignedWorkout[];
    await this.sequelize.transaction(async (tx) => {
      // Under a lock: two taps on Done must not tell the client twice.
      const assignment = await this.assignmentModel.findByPk(owned.id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!assignment) {
        throw new NotFoundException(apiError('workout.assignmentNotFound'));
      }
      let since = new Date(0);
      if (assignment.coachChangesNotifiedAt) {
        since = assignment.coachChangesNotifiedAt;
      }
      changedDays = await this.assignedWorkoutModel.findAll({
        where: {
          programAssignmentId: assignment.id,
          coachChangedAt: { [Op.gt]: since },
        },
        attributes: [
          'id',
          'name',
          'weekIndex',
          'scheduledDate',
          'sequenceNumber',
        ],
        order: [
          ['scheduledDate', 'ASC'],
          ['sequenceNumber', 'ASC'],
        ],
        transaction: tx,
      });
      if (!changedDays.length) {
        return;
      }
      await assignment.update(
        { coachChangesNotifiedAt: new Date() },
        { transaction: tx },
      );
      res = assignment;
    });

    if (!changedDays.length) {
      return { notified: false, days: 0 };
    }
    // notify-after-commit
    let notified = false;
    if (EDITABLE_PLAN_STATUSES.includes(res.status)) {
      notified = await this._notifyAdjusted(res, changedDays);
    }
    return { notified, days: changedDays.length };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  /**
   * The plan, when the caller is its coach and still coaches the client.
   * 404 otherwise, so a past relationship or another coach's plan is not
   * revealed. A self-scheduled plan has no coach and is nobody's to edit.
   */
  private async _loadOwned(
    id: string,
    instructorId: string,
  ): Promise<ProgramAssignment> {
    const assignment = await this.assignmentModel.findByPk(id);
    if (!assignment || assignment.instructorId !== instructorId) {
      throw new NotFoundException(apiError('workout.assignmentNotFound'));
    }
    const link = await this.instructorClientModel.findOne({
      where: {
        instructorId,
        clientId: assignment.clientId,
        status: InstructorClientStatus.ACTIVE,
      },
      attributes: ['id'],
    });
    if (!link || !link.id) {
      throw new NotFoundException(apiError('workout.assignmentNotFound'));
    }
    return assignment;
  }

  /**
   * Runs one write in a transaction with the plan and the day locked, after
   * checking again inside it that the day can change. A write that changed
   * the client's copy dates the day, so Done knows to tell them.
   */
  private async _inEditableDay<T>(
    id: string,
    dayId: string,
    instructorId: string,
    today: string,
    work: (context: DayContext) => Promise<DayWrite<T>>,
  ): Promise<T> {
    const owned = await this._loadOwned(id, instructorId);
    // Widened on purpose: it is set inside the callback.
    let res = null as { value: T } | null;
    await this.sequelize.transaction(async (tx) => {
      const assignment = await this.assignmentModel.findByPk(owned.id, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!assignment) {
        throw new NotFoundException(apiError('workout.assignmentNotFound'));
      }
      const day = await this.assignedWorkoutModel.findOne({
        where: { id: dayId, programAssignmentId: assignment.id },
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!day) {
        throw new NotFoundException(apiError('workout.workoutNotFound'));
      }
      const log = await this.logModel.findOne({
        where: { assignedWorkoutId: day.id },
        attributes: ['id'],
        transaction: tx,
      });
      let hasLog = false;
      if (log && log.id) {
        hasLog = true;
      }
      const lock = copyDayLock({
        planStatus: assignment.status,
        dayStatus: day.status,
        scheduledDate: day.scheduledDate,
        hasLog,
        today,
      });
      if (lock) {
        throw new ConflictException(apiError(copyLockError(lock)));
      }

      const out = await work({ assignment, day, tx });
      if (out.changed) {
        await day.update({ coachChangedAt: new Date() }, { transaction: tx });
      }
      res = { value: out.result };
    });
    if (!res) {
      throw new NotFoundException(apiError('workout.workoutNotFound'));
    }
    return res.value;
  }

  private async _exerciseOf(
    dayId: string,
    exerciseId: string,
    tx: Transaction,
  ): Promise<AssignedExercise> {
    const row = await this.assignedExerciseModel.findOne({
      where: { id: exerciseId, assignedWorkoutId: dayId },
      transaction: tx,
    });
    if (!row) {
      throw new NotFoundException(apiError('exercise.notFound'));
    }
    return row;
  }

  private async _client(
    clientId: string,
    tx?: Transaction,
  ): Promise<User | null> {
    return this.userModel.findByPk(clientId, {
      attributes: [
        'id',
        'firstName',
        'lastName',
        'avatarUrl',
        'handle',
        'language',
      ],
      transaction: tx,
    });
  }

  private _summary(
    assignment: ProgramAssignment,
    client: User | null,
  ): CopyPlanSummary {
    let person: CopyClient | null = null;
    if (client) {
      person = {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        avatarUrl: client.avatarUrl,
        handle: client.handle,
      };
    }
    return {
      id: assignment.id,
      status: assignment.status,
      programNameSnapshot: assignment.programNameSnapshot,
      masterProgramId: assignment.masterProgramId,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      completionPercent: assignment.completionPercent,
      clientId: assignment.clientId,
      client: person,
    };
  }

  private _dayView(
    assignment: ProgramAssignment,
    day: AssignedWorkout,
    hasLog: boolean,
    today: string,
  ): CopyDayView {
    const lock = copyDayLock({
      planStatus: assignment.status,
      dayStatus: day.status,
      scheduledDate: day.scheduledDate,
      hasLog,
      today,
    });
    return {
      id: day.id,
      name: day.name,
      notes: day.notes,
      weekIndex: day.weekIndex,
      dayIndex: day.dayIndex,
      scheduledDate: day.scheduledDate,
      status: day.status,
      lock,
      editable: lock === null,
      changed: day.coachChangedAt !== null && day.coachChangedAt !== undefined,
    };
  }

  private _exerciseView(
    row: AssignedExercise,
    program: ProgramRow | null,
    lastResult: CopyLastResult | null,
    locale: Locale,
  ): CopyExerciseView {
    let programExerciseId: string | null = null;
    let programValues: CopyProgramValues | null = null;
    if (program) {
      programExerciseId = program.exerciseId;
      let exercise: Exercise | null = null;
      if (program.exercise) {
        exercise = program.exercise;
      }
      programValues = {
        exerciseId: program.exerciseId,
        exercise,
        notes: translatedText(program, 'notes', locale),
        sets: this._sortedSets(program.sets).map((set) =>
          this._programSetValues(set, program),
        ),
      };
    }
    let exercise: Exercise | null = null;
    if (row.exercise) {
      exercise = row.exercise;
    }
    let sets: AssignedSet[] = [];
    if (row.sets) {
      sets = row.sets;
    }
    return {
      id: row.id,
      exerciseId: row.exerciseId,
      masterExerciseId: row.masterExerciseId,
      supersetGroupId: row.supersetGroupId,
      orderIndex: row.orderIndex,
      notes: row.notes,
      isModifiedFromMaster: row.isModifiedFromMaster,
      exercise,
      sets,
      change: copyExerciseChange(row, programExerciseId),
      canRevert: row.isModifiedFromMaster && program !== null,
      program: programValues,
      lastResult,
    };
  }

  /**
   * The program rows the copy's exercises link to, as the program is now,
   * with their movement, sets, and the day and program their planned rest
   * falls back to. A row of a deleted program is left out: there is
   * nothing to go back to.
   */
  private async _programRows(
    ids: string[],
    tx?: Transaction,
  ): Promise<Map<string, ProgramRow>> {
    const map = new Map<string, ProgramRow>();
    if (!ids.length) {
      return map;
    }
    const rows = await this.prescribedExerciseModel.findAll({
      where: { id: [...new Set(ids)] },
      include: [
        {
          model: Exercise,
          as: 'exercise',
          attributes: EXERCISE_ATTRIBUTES,
          paranoid: false,
        },
        { model: PrescribedSet, as: 'sets' },
        {
          model: ProgramWorkout,
          as: 'workout',
          required: true,
          attributes: ['id', 'programId', 'defaultRestSeconds'],
          include: [
            {
              model: Program,
              as: 'program',
              required: true,
              attributes: ['id', 'defaultRestSeconds'],
            },
          ],
        },
      ],
      transaction: tx,
    });
    for (const row of rows) {
      map.set(row.id, row as ProgramRow);
    }
    return map;
  }

  private _sortedSets(sets: PrescribedSet[] | undefined): PrescribedSet[] {
    if (!sets) {
      return [];
    }
    return [...sets].sort((a, b) => a.orderIndex - b.orderIndex);
  }

  /** A program set as the copy holds it: the planned rest filled, as on assign. */
  private _programSetValues(
    set: PrescribedSet,
    program: ProgramRow,
  ): CopySetValues {
    return {
      orderIndex: set.orderIndex,
      setType: set.setType,
      targetRepsMin: set.targetRepsMin,
      targetRepsMax: set.targetRepsMax,
      targetWeightKg: set.targetWeightKg,
      targetWeightPercent1rm: set.targetWeightPercent1rm,
      targetDurationSeconds: set.targetDurationSeconds,
      targetDistanceMeters: set.targetDistanceMeters,
      targetRpe: set.targetRpe,
      targetRir: set.targetRir,
      restAfterSeconds: plannedSetRest(
        set,
        program.workout,
        program.workout.program,
      ),
      tempo: set.tempo,
      notes: set.notes,
    };
  }

  /** A set's whole target as the editor sent it: what is not sent is cleared. */
  private _itemValues(
    item: PrescribedSetItemDto,
    orderIndex: number,
  ): CopySetValues {
    let notes: string | null = null;
    if (item.notes && item.notes.trim()) {
      notes = item.notes.trim();
    }
    return {
      orderIndex,
      setType: item.setType ?? ExerciseSetType.Normal,
      targetRepsMin: item.targetRepsMin ?? null,
      targetRepsMax: item.targetRepsMax ?? null,
      targetWeightKg: item.targetWeightKg ?? null,
      targetWeightPercent1rm: item.targetWeightPercent1rm ?? null,
      targetDurationSeconds: item.targetDurationSeconds ?? null,
      targetDistanceMeters: item.targetDistanceMeters ?? null,
      targetRpe: item.targetRpe ?? null,
      targetRir: item.targetRir ?? null,
      restAfterSeconds: item.restAfterSeconds ?? null,
      tempo: item.tempo ?? null,
      notes,
    };
  }

  /** The rep range and weight mode rules of a program set, with the same errors. */
  private _assertSetCoherent(item: PrescribedSetItemDto): void {
    if (
      item.targetRepsMin != null &&
      item.targetRepsMax != null &&
      item.targetRepsMin > item.targetRepsMax
    ) {
      throw new BadRequestException(apiError('workout.repRangeInvalid'));
    }
    if (item.targetWeightKg != null && item.targetWeightPercent1rm != null) {
      throw new BadRequestException(apiError('workout.weightModeConflict'));
    }
  }

  /**
   * A movement the coach may put in a plan: MotionHive's, a public one, or
   * their own (the rule program authoring applies). 404 otherwise, so a
   * private exercise of someone else is not revealed.
   */
  private async _assertExercisesUsable(
    ids: string[],
    instructorId: string,
  ): Promise<void> {
    const exercises = await this.exerciseModel.findAll({
      where: { id: ids },
      attributes: ['id', 'source', 'visibility', 'ownerId'],
    });
    const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
    for (const exerciseId of ids) {
      const exercise = byId.get(exerciseId);
      if (!exercise) {
        throw new NotFoundException(apiError('exercise.notFound'));
      }
      const readable =
        exercise.source === ExerciseSource.System ||
        exercise.visibility === ExerciseVisibility.Public ||
        exercise.ownerId === instructorId;
      if (!readable) {
        throw new NotFoundException(apiError('exercise.notFound'));
      }
    }
  }

  /** A superset left with one exercise is no superset. Same transaction. */
  private async _dissolveLoneSuperset(
    dayId: string,
    groupId: number,
    tx: Transaction,
  ): Promise<void> {
    const members = await this.assignedExerciseModel.findAll({
      where: { assignedWorkoutId: dayId, supersetGroupId: groupId },
      attributes: ['id'],
      transaction: tx,
    });
    if (members.length !== 1) {
      return;
    }
    await this.assignedExerciseModel.update(
      { supersetGroupId: null },
      { where: { id: members[0].id }, transaction: tx },
    );
  }

  /** The days with any workout log: started, whatever their status says. */
  private async _loggedDayIds(dayIds: string[]): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!dayIds.length) {
      return ids;
    }
    const logs = await this.logModel.findAll({
      where: { assignedWorkoutId: dayIds },
      attributes: ['assignedWorkoutId'],
    });
    for (const log of logs) {
      if (log.assignedWorkoutId) {
        ids.add(log.assignedWorkoutId);
      }
    }
    return ids;
  }

  private async _exerciseCounts(
    dayIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!dayIds.length) {
      return counts;
    }
    const rows = await this.assignedExerciseModel.findAll({
      where: { assignedWorkoutId: dayIds },
      attributes: ['assignedWorkoutId'],
    });
    for (const row of rows) {
      let count = 0;
      const current = counts.get(row.assignedWorkoutId);
      if (current !== undefined) {
        count = current;
      }
      counts.set(row.assignedWorkoutId, count + 1);
    }
    return counts;
  }

  /** The dates the plan's other days hold: a move may not land on one. */
  private async _takenDates(
    assignmentId: string,
    dayId: string,
  ): Promise<string[]> {
    const others = await this.assignedWorkoutModel.findAll({
      where: {
        programAssignmentId: assignmentId,
        id: { [Op.ne]: dayId },
        scheduledDate: { [Op.ne]: null },
      },
      attributes: ['scheduledDate'],
    });
    const dates = new Set<string>();
    for (const other of others) {
      if (other.scheduledDate) {
        dates.add(other.scheduledDate);
      }
    }
    return [...dates].sort();
  }

  /**
   * The client's last finished session of each movement, as the coach may
   * read it: the logs from the coach's own plans and the ones the client
   * shared with coaches (`CoachAccessService`, the rule the coach's
   * progress and history reads apply). Its completed working sets, and the
   * effort they logged on average. One query for the whole day.
   */
  private async _lastResults(
    instructorId: string,
    clientId: string,
    exerciseIds: string[],
  ): Promise<Map<string, CopyLastResult>> {
    const results = new Map<string, CopyLastResult>();
    if (!exerciseIds.length) {
      return results;
    }
    const own = await this.coachAccess.visibleAssignmentIds(
      instructorId,
      clientId,
    );
    let scope = 'wl.visibility IN (:shared)';
    if (own.length) {
      scope =
        '(wl.program_assignment_id IN (:own) OR wl.visibility IN (:shared))';
    }
    const rows = await this.sequelize.query<LastSetRow>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (le.exercise_id)
          le.exercise_id                           AS exercise_id,
          le.id                                    AS logged_exercise_id,
          wl.id                                    AS workout_log_id,
          COALESCE(wl.completed_at, wl.started_at) AS performed_at
        FROM logged_exercise le
        JOIN workout_log wl ON wl.id = le.workout_log_id
        WHERE wl.user_id = :clientId
          AND wl.status = :completed
          AND le.exercise_id IN (:exerciseIds)
          AND le.is_skipped = FALSE
          AND ${scope}
          AND EXISTS (
            SELECT 1 FROM logged_set s
            WHERE s.logged_exercise_id = le.id
              AND s.is_completed = TRUE
              AND s.set_type <> :warmup
          )
        ORDER BY le.exercise_id, COALESCE(wl.completed_at, wl.started_at) DESC
      )
      SELECT
        l.exercise_id        AS "exerciseId",
        l.workout_log_id     AS "workoutLogId",
        l.performed_at       AS "performedAt",
        ls.set_type          AS "setType",
        ls.reps              AS "reps",
        ls.weight_kg         AS "weightKg",
        ls.duration_seconds  AS "durationSeconds",
        ls.distance_meters   AS "distanceMeters",
        ls.rpe               AS "rpe"
      FROM latest l
      JOIN logged_set ls ON ls.logged_exercise_id = l.logged_exercise_id
      WHERE ls.is_completed = TRUE
        AND ls.set_type <> :warmup
      ORDER BY l.exercise_id, ls.order_index
      `,
      {
        replacements: {
          clientId,
          exerciseIds,
          own,
          shared: [...SHARED_WITH_COACHES],
          completed: WorkoutLogStatus.Completed,
          warmup: ExerciseSetType.Warmup,
        },
        type: QueryTypes.SELECT,
      },
    );

    const efforts = new Map<string, number[]>();
    for (const row of rows) {
      let result = results.get(row.exerciseId);
      if (!result) {
        result = {
          workoutLogId: row.workoutLogId,
          performedAt: row.performedAt,
          sets: [],
          averageRpe: null,
        };
        results.set(row.exerciseId, result);
        efforts.set(row.exerciseId, []);
      }
      let weightKg: number | null = null;
      if (row.weightKg !== null) {
        weightKg = Number(row.weightKg);
      }
      let rpe: number | null = null;
      if (row.rpe !== null) {
        rpe = Number(row.rpe);
        const logged = efforts.get(row.exerciseId);
        if (logged) {
          logged.push(rpe);
        }
      }
      result.sets.push({
        setType: row.setType,
        reps: row.reps,
        weightKg,
        durationSeconds: row.durationSeconds,
        distanceMeters: row.distanceMeters,
        rpe,
      });
    }
    for (const [exerciseId, logged] of efforts) {
      const result = results.get(exerciseId);
      if (!result || !logged.length) {
        continue;
      }
      const sum = logged.reduce((total, value) => total + value, 0);
      result.averageRpe = Math.round((sum / logged.length) * 10) / 10;
    }
    return results;
  }

  /**
   * "Andrei adjusted your plan · Push A, week 3": the first day that
   * changed, and how many others did. Best effort: the changes are saved,
   * and a lost notice is not worth failing Done over.
   */
  private async _notifyAdjusted(
    assignment: ProgramAssignment,
    days: AssignedWorkout[],
  ): Promise<boolean> {
    if (
      !assignment.instructorId ||
      assignment.instructorId === assignment.clientId
    ) {
      return false;
    }
    try {
      const coach = await this.userModel.findByPk(assignment.instructorId, {
        attributes: ['firstName', 'lastName'],
      });
      // No name yet reads as "Your coach", in the reader's language.
      let coachName: string | null = null;
      if (coach) {
        const name = [coach.firstName, coach.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        if (name) {
          coachName = name;
        }
      }
      const first = days[0];
      await this.notificationService.notify(
        planAdjustedForClient({
          clientId: assignment.clientId,
          assignmentId: assignment.id,
          programName: assignment.programNameSnapshot,
          coachName,
          dayName: first.name,
          week: first.weekIndex + 1,
          otherDays: days.length - 1,
        }),
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Plan adjusted notification failed for ${assignment.id}: ${(err as Error).message}`,
        'AssignmentCopyService',
      );
      return false;
    }
  }
}
