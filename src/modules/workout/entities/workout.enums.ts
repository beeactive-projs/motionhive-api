// Workout module enums — single source of truth for entities + DTOs.
// Const + type pattern (runtime accessible + TS narrowing). Keep in
// sync with migration 047.

export const ProgramKind = {
  Workout: 'WORKOUT',
  Meal: 'MEAL', // reserved
  Habit: 'HABIT', // reserved
  Hybrid: 'HYBRID', // reserved
} as const;
export type ProgramKind = (typeof ProgramKind)[keyof typeof ProgramKind];

/**
 * Who authored a program. SYSTEM rows are MotionHive-seeded starter
 * routines with no owner — the first-run path for someone training
 * without a coach. See migration 056.
 */
export const ProgramSource = {
  System: 'SYSTEM',
  User: 'USER',
  Instructor: 'INSTRUCTOR',
} as const;
export type ProgramSource = (typeof ProgramSource)[keyof typeof ProgramSource];

/**
 * COACH — an instructor assigned this. SELF — the person training
 * scheduled it themselves, which skips the ACTIVE relationship check.
 */
export const ProgramAssignmentKind = {
  Coach: 'COACH',
  Self: 'SELF',
} as const;
export type ProgramAssignmentKind =
  (typeof ProgramAssignmentKind)[keyof typeof ProgramAssignmentKind];

/** Scheduler mode. BLOCK repeats for `repeatWeeks` then completes. */
export const ProgramRepeatMode = {
  None: 'NONE',
  Weekly: 'WEEKLY',
  Block: 'BLOCK',
} as const;
export type ProgramRepeatMode =
  (typeof ProgramRepeatMode)[keyof typeof ProgramRepeatMode];

export const ProgramStatus = {
  Draft: 'DRAFT',
  Published: 'PUBLISHED',
  Archived: 'ARCHIVED',
} as const;
export type ProgramStatus = (typeof ProgramStatus)[keyof typeof ProgramStatus];

export const ProgramAssignmentStatus = {
  Pending: 'PENDING',
  Active: 'ACTIVE',
  Completed: 'COMPLETED',
  Paused: 'PAUSED',
  Cancelled: 'CANCELLED',
} as const;
export type ProgramAssignmentStatus =
  (typeof ProgramAssignmentStatus)[keyof typeof ProgramAssignmentStatus];

export const WorkoutLogStatus = {
  InProgress: 'IN_PROGRESS',
  Completed: 'COMPLETED',
  Skipped: 'SKIPPED',
  Abandoned: 'ABANDONED',
} as const;
export type WorkoutLogStatus =
  (typeof WorkoutLogStatus)[keyof typeof WorkoutLogStatus];

/**
 * Who besides the owner sees a workout (migration 073). The same three
 * levels as the profile privacy settings (`ProfilePrivacyLevel`), so the
 * app says them the same way everywhere. The coach whose plan a workout
 * came from sees it whatever the level.
 */
export const WorkoutVisibility = {
  OnlyMe: 'ONLY_ME',
  CoachesOnly: 'COACHES_ONLY',
  Public: 'PUBLIC',
} as const;
export type WorkoutVisibility =
  (typeof WorkoutVisibility)[keyof typeof WorkoutVisibility];

export const ExerciseBlockKind = {
  None: 'NONE',
  Superset: 'SUPERSET',
  Circuit: 'CIRCUIT',
  Emom: 'EMOM',
  Amrap: 'AMRAP',
  Tabata: 'TABATA',
} as const;
export type ExerciseBlockKind =
  (typeof ExerciseBlockKind)[keyof typeof ExerciseBlockKind];

export const ExerciseSetType = {
  Normal: 'NORMAL',
  Warmup: 'WARMUP',
  Working: 'WORKING',
  Dropset: 'DROPSET',
  Failure: 'FAILURE',
  Amrap: 'AMRAP',
  RestPause: 'REST_PAUSE',
  Cluster: 'CLUSTER',
} as const;
export type ExerciseSetType =
  (typeof ExerciseSetType)[keyof typeof ExerciseSetType];

export const OneRepMaxSource = {
  Tested: 'TESTED',
  EstimatedEpley: 'ESTIMATED_EPLEY',
  EstimatedBrzycki: 'ESTIMATED_BRZYCKI',
  Manual: 'MANUAL',
} as const;
export type OneRepMaxSource =
  (typeof OneRepMaxSource)[keyof typeof OneRepMaxSource];
