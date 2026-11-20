import type { ErrorKey } from '../../common/i18n';
import {
  ExerciseSetType,
  ProgramAssignmentStatus,
  WorkoutLogStatus,
} from './entities/workout.enums';

/**
 * The rules of a coach editing one client's copy of a plan (owner,
 * 2026-11-20), as pure functions so each one is tested on its own.
 * `AssignmentCopyService` applies them; nothing here reads the database.
 */

/**
 * Why a day of the copy can't change: the plan is no longer running, the
 * day is done or skipped, the client started it, or its date has passed.
 * No lock means the coach can edit it.
 */
export const CopyDayLocks = {
  PlanClosed: 'PLAN_CLOSED',
  Done: 'DONE',
  Skipped: 'SKIPPED',
  Started: 'STARTED',
  Past: 'PAST',
} as const;
export type CopyDayLock = (typeof CopyDayLocks)[keyof typeof CopyDayLocks];

/** A plan whose days a coach may still edit: running, or paused. */
export const EDITABLE_PLAN_STATUSES: readonly ProgramAssignmentStatus[] = [
  ProgramAssignmentStatus.Active,
  ProgramAssignmentStatus.Paused,
];

/** The error a write to a locked day answers with. */
const LOCK_ERRORS: Record<CopyDayLock, ErrorKey> = {
  [CopyDayLocks.PlanClosed]: 'workout.copyPlanClosed',
  [CopyDayLocks.Done]: 'workout.copyDayDone',
  [CopyDayLocks.Skipped]: 'workout.copyDaySkipped',
  [CopyDayLocks.Started]: 'workout.copyDayStarted',
  [CopyDayLocks.Past]: 'workout.copyDayPast',
};

/**
 * What keeps a day of the copy as it is, or null when the coach may edit
 * it: an upcoming day (today or later) the client has not started,
 * finished or skipped, on a plan that is running or paused. A day with any
 * workout log is started, whatever its status says.
 * @Arguments planStatus, dayStatus, scheduledDate, hasLog, today
 */
export function copyDayLock(input: {
  planStatus: ProgramAssignmentStatus;
  dayStatus: WorkoutLogStatus | null;
  scheduledDate: string | null;
  hasLog: boolean;
  today: string;
}): CopyDayLock | null {
  if (!EDITABLE_PLAN_STATUSES.includes(input.planStatus)) {
    return CopyDayLocks.PlanClosed;
  }
  if (input.dayStatus === WorkoutLogStatus.Completed) {
    return CopyDayLocks.Done;
  }
  if (input.dayStatus === WorkoutLogStatus.Skipped) {
    return CopyDayLocks.Skipped;
  }
  if (input.dayStatus !== null || input.hasLog) {
    return CopyDayLocks.Started;
  }
  if (input.scheduledDate !== null && input.scheduledDate < input.today) {
    return CopyDayLocks.Past;
  }
  return null;
}

/** @Arguments lock */
export function copyLockError(lock: CopyDayLock): ErrorKey {
  return LOCK_ERRORS[lock];
}

/**
 * Why a day can't move to `date`, or null when it can: never into the
 * past, inside the plan's start and end dates, and only to a date no other
 * day of the plan holds.
 * @Arguments date, today, startDate, endDate, takenDates
 */
export function copyMoveRefusal(input: {
  date: string;
  today: string;
  startDate: string;
  endDate: string | null;
  takenDates: readonly string[];
}): ErrorKey | null {
  if (input.date < input.today) {
    return 'workout.copyDatePast';
  }
  if (input.date < input.startDate) {
    return 'workout.copyDateOutsidePlan';
  }
  if (input.endDate !== null && input.date > input.endDate) {
    return 'workout.copyDateOutsidePlan';
  }
  if (input.takenDates.includes(input.date)) {
    return 'workout.copyDateTaken';
  }
  return null;
}

/** The first date a day may move to: today, or the plan's start if later. */
export function copyMoveFrom(today: string, startDate: string): string {
  if (startDate > today) {
    return startDate;
  }
  return today;
}

/** How an exercise of the copy differs from the program, as the app labels it. */
export const CopyExerciseChanges = {
  None: 'NONE',
  /** Its sets, rest or note were changed for this client. */
  Changed: 'CHANGED',
  /** Its exercise is not the one its program row names. */
  Replaced: 'REPLACED',
  /** The coach added it to this copy; no program row behind it. */
  Added: 'ADDED',
} as const;
export type CopyExerciseChange =
  (typeof CopyExerciseChanges)[keyof typeof CopyExerciseChanges];

/**
 * The label an exercise of the copy carries. Unchanged rows carry none,
 * even when the program changed since: the copy is what was assigned. A
 * changed row with no program row behind it was added for the client (or
 * its program row is gone, so it is only theirs either way). A changed
 * row whose exercise is not its program row's was replaced.
 * @Arguments row (isModifiedFromMaster, masterExerciseId, exerciseId), masterExerciseId of its program row
 */
export function copyExerciseChange(
  row: {
    isModifiedFromMaster: boolean;
    masterExerciseId: string | null;
    exerciseId: string;
  },
  programExerciseId: string | null,
): CopyExerciseChange {
  if (!row.isModifiedFromMaster) {
    return CopyExerciseChanges.None;
  }
  if (row.masterExerciseId === null) {
    return CopyExerciseChanges.Added;
  }
  if (programExerciseId !== null && programExerciseId !== row.exerciseId) {
    return CopyExerciseChanges.Replaced;
  }
  return CopyExerciseChanges.Changed;
}

/**
 * The week and day slot a day takes on `date`, on its own grid: the grid
 * its present date and slot put it on (week × 7 + day days after an
 * anchor), so a move inside a week changes only the day and a move into
 * the next week adds one to the week. The plan pages group days by week
 * and sort them by day, so both follow the date. A date before the grid's
 * first week stays in week 0.
 * @Arguments day (scheduledDate, weekIndex, dayIndex), date
 */
export function copySlotOn(
  day: { scheduledDate: string; weekIndex: number; dayIndex: number },
  date: string,
): { weekIndex: number; dayIndex: number } {
  const anchor =
    dayNumber(day.scheduledDate) - (day.weekIndex * 7 + day.dayIndex);
  const offset = dayNumber(date) - anchor;
  const dayIndex = ((offset % 7) + 7) % 7;
  let weekIndex = Math.floor(offset / 7);
  if (weekIndex < 0) {
    weekIndex = 0;
  }
  return { weekIndex, dayIndex };
}

/** Whole days since 1970-01-01 for a `YYYY-MM-DD` date, in UTC. */
function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** The target fields one set of the copy is written with. */
export interface CopySetValues {
  orderIndex: number;
  setType: ExerciseSetType;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetWeightKg: number | null;
  targetWeightPercent1rm: number | null;
  targetDurationSeconds: number | null;
  targetDistanceMeters: number | null;
  targetRpe: number | null;
  targetRir: number | null;
  restAfterSeconds: number | null;
  tempo: string | null;
  notes: string | null;
}

const SET_FIELDS: (keyof CopySetValues)[] = [
  'orderIndex',
  'setType',
  'targetRepsMin',
  'targetRepsMax',
  'targetWeightKg',
  'targetWeightPercent1rm',
  'targetDurationSeconds',
  'targetDistanceMeters',
  'targetRpe',
  'targetRir',
  'restAfterSeconds',
  'tempo',
  'notes',
];

/**
 * True when a saved set already holds these values, so saving them would
 * change nothing: an unchanged save must not mark the exercise as changed
 * for the client.
 * @Arguments saved, values
 */
export function sameSetValues(
  saved: Partial<Record<keyof CopySetValues, unknown>>,
  values: CopySetValues,
): boolean {
  for (const field of SET_FIELDS) {
    let current = saved[field];
    if (current === undefined) {
      current = null;
    }
    if (current !== values[field]) {
      return false;
    }
  }
  return true;
}
