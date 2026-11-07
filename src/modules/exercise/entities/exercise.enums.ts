// Exercise catalog domain enums — single source of truth used by
// entities, DTOs, and services. const + type pattern (runtime accessible
// + TypeScript narrowing). Keep in sync with migration 047.

export const ExerciseSource = {
  System: 'SYSTEM', // seeded from a public dataset (free-exercise-db, etc.)
  Instructor: 'INSTRUCTOR', // user-created
  Admin: 'ADMIN', // created by MotionHive staff
  /**
   * Created by someone who is not a coach, for their own training
   * (migration 079). Always PRIVATE: a CHECK keeps it that way.
   */
  User: 'USER',
} as const;
export type ExerciseSource =
  (typeof ExerciseSource)[keyof typeof ExerciseSource];

export const ExerciseVisibility = {
  Private: 'PRIVATE',
  Public: 'PUBLIC',
} as const;
export type ExerciseVisibility =
  (typeof ExerciseVisibility)[keyof typeof ExerciseVisibility];

export const ExerciseKind = {
  Strength: 'STRENGTH', // weight × reps
  Cardio: 'CARDIO', // duration + distance + HR
  Duration: 'DURATION', // time-based (plank, isometric)
  Distance: 'DISTANCE', // distance-based (run, swim)
  Bodyweight: 'BODYWEIGHT', // reps only
  Mobility: 'MOBILITY', // stretches, foam rolling
} as const;
export type ExerciseKind = (typeof ExerciseKind)[keyof typeof ExerciseKind];

export const ExerciseForce = {
  Push: 'PUSH',
  Pull: 'PULL',
  Static: 'STATIC',
} as const;
export type ExerciseForce = (typeof ExerciseForce)[keyof typeof ExerciseForce];

export const ExerciseMechanic = {
  Compound: 'COMPOUND',
  Isolation: 'ISOLATION',
} as const;
export type ExerciseMechanic =
  (typeof ExerciseMechanic)[keyof typeof ExerciseMechanic];

export const ExerciseLevel = {
  Beginner: 'BEGINNER',
  Intermediate: 'INTERMEDIATE',
  Advanced: 'ADVANCED',
} as const;
export type ExerciseLevel = (typeof ExerciseLevel)[keyof typeof ExerciseLevel];

export const MovementPattern = {
  Squat: 'SQUAT',
  Hinge: 'HINGE',
  Lunge: 'LUNGE',
  PushHorizontal: 'PUSH_HORIZONTAL',
  PushVertical: 'PUSH_VERTICAL',
  PullHorizontal: 'PULL_HORIZONTAL',
  PullVertical: 'PULL_VERTICAL',
  Carry: 'CARRY',
  Rotation: 'ROTATION',
  AntiRotation: 'ANTI_ROTATION',
  Locomotion: 'LOCOMOTION',
  Isolation: 'ISOLATION',
} as const;
export type MovementPattern =
  (typeof MovementPattern)[keyof typeof MovementPattern];

export const MuscleRole = {
  Primary: 'PRIMARY',
  Secondary: 'SECONDARY',
  Stabilizer: 'STABILIZER',
} as const;
export type MuscleRole = (typeof MuscleRole)[keyof typeof MuscleRole];

export const ExerciseMediaKind = {
  Youtube: 'YOUTUBE',
  Video: 'VIDEO',
  Image: 'IMAGE',
  Gif: 'GIF',
  None: 'NONE',
} as const;
export type ExerciseMediaKind =
  (typeof ExerciseMediaKind)[keyof typeof ExerciseMediaKind];
