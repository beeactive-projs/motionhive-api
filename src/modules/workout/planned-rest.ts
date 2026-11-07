/**
 * Planned rest, the API's half of "first match wins" (handoff §4): the
 * set's own rest, then the day's (`program_workout.default_rest_seconds`),
 * then the program's default. Null when none is planned; the app then
 * falls back to the person's default (`workoutSettings.defaultRestSeconds`)
 * and to 90 seconds.
 *
 * Exercise-level rest has no column of its own: setting it writes every
 * set of the exercise, so it arrives here as the set's own rest.
 */

interface HasRest {
  restAfterSeconds?: number | null;
}

interface HasDefaultRest {
  defaultRestSeconds?: number | null;
}

/** A prescribed set's planned rest: its own, the day's, the program's. */
export function plannedSetRest(
  set: HasRest,
  day: HasDefaultRest | null | undefined,
  program: HasDefaultRest | null | undefined,
): number | null {
  return (
    set.restAfterSeconds ??
    day?.defaultRestSeconds ??
    program?.defaultRestSeconds ??
    null
  );
}

/**
 * A logged set's planned rest. A coach plan's set reads its assigned copy,
 * which the assignment filled with the day's or program's rest when it
 * had none; a routine's set reads the routine's set, then the routine's
 * day and program. A set added during the workout has no set of its own
 * and takes the routine's default, if any.
 */
export function plannedLoggedSetRest(
  set: { assignedSet?: HasRest | null; prescribedSet?: HasRest | null },
  day: HasDefaultRest | null | undefined,
  program: HasDefaultRest | null | undefined,
): number | null {
  return (
    set.assignedSet?.restAfterSeconds ??
    plannedSetRest(set.prescribedSet ?? {}, day, program)
  );
}
