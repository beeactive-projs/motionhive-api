/**
 * The person's workout logger settings (migration 079), stored in
 * `user.workout_settings` the way privacy settings are stored: only the
 * keys someone changed. Missing keys resolve to these defaults when read,
 * so `{}` on every existing account behaves correctly.
 */
export interface WorkoutSettings {
  /** Rest after a set when nothing more specific is planned, in seconds. */
  defaultRestSeconds: number;
  /** A sound when rest ends, while the app is open. */
  sound: boolean;
  /** Vibrate when rest ends. */
  vibration: boolean;
  /** Show the rest timer on the lock screen. */
  lockScreen: boolean;
  /** Ask how hard each set was (RPE) after ticking it. */
  askEffort: boolean;
  /** In a superset, jump to the next exercise of the round after a tick. */
  supersetJump: boolean;
  /** Keep the screen on while the logger is open. */
  keepScreenOn: boolean;
}

/** What is stored: any subset of the keys. */
export type StoredWorkoutSettings = Partial<WorkoutSettings>;

/** Bounds of `defaultRestSeconds`, shared by the DTO and the resolver. */
export const WORKOUT_DEFAULT_REST_MIN = 15;
export const WORKOUT_DEFAULT_REST_MAX = 600;

export const WORKOUT_SETTINGS_DEFAULTS: Readonly<WorkoutSettings> = {
  defaultRestSeconds: 90,
  sound: true,
  vibration: true,
  lockScreen: true,
  askEffort: false,
  supersetJump: true,
  keepScreenOn: true,
};

/** The on/off keys, in the order Settings › Workouts lists them. */
export const WORKOUT_SETTINGS_SWITCHES = [
  'sound',
  'vibration',
  'lockScreen',
  'askEffort',
  'supersetJump',
  'keepScreenOn',
] as const;

/**
 * Every key, from what is stored or else its default. A stored value of
 * the wrong type or out of range (written by hand, or under an older
 * rule) falls back to the default rather than reaching the app.
 */
export function resolveWorkoutSettings(
  stored: StoredWorkoutSettings | null | undefined,
): WorkoutSettings {
  const resolved: WorkoutSettings = { ...WORKOUT_SETTINGS_DEFAULTS };
  const rest = stored?.defaultRestSeconds;
  if (
    typeof rest === 'number' &&
    Number.isInteger(rest) &&
    rest >= WORKOUT_DEFAULT_REST_MIN &&
    rest <= WORKOUT_DEFAULT_REST_MAX
  ) {
    resolved.defaultRestSeconds = rest;
  }
  for (const key of WORKOUT_SETTINGS_SWITCHES) {
    const value = stored?.[key];
    if (typeof value === 'boolean') resolved[key] = value;
  }
  return resolved;
}
