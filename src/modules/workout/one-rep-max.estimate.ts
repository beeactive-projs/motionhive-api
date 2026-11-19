import { ExerciseKind } from '../exercise/entities/exercise.enums';

/**
 * Compute an Epley-estimated 1RM from a single heavy set. Returns
 * null when not enough info (no reps, or no weight, or > 12 reps —
 * Epley breaks down beyond ~10 reps).
 *
 *   1RM ≈ weight × (1 + reps / 30)
 *
 * A plain function rather than a service method because two places
 * must agree on it to the decimal: the completion flow, which writes
 * ESTIMATED_EPLEY rows into one_rep_max, and the coach's progress view,
 * which replays the same estimate over only the logs the coach may see.
 */
/**
 * `one_rep_max.weight_kg` is DECIMAL(6,2): an estimate past this is a typo
 * (1000 for 100), and writing it would fail the whole finish.
 */
export const MAX_ONE_REP_MAX_KG = 9999.99;

export function estimateOneRepMaxEpley(
  reps: number | null,
  weightKg: number | null,
): number | null {
  if (reps == null || weightKg == null) return null;
  if (reps < 1 || reps > 12 || weightKg <= 0) return null;
  // A single is its own max: Epley at one rep says 103.3% of what was lifted.
  let estimate = weightKg;
  if (reps > 1) {
    estimate = Math.round(weightKg * (1 + reps / 30) * 100) / 100;
  }
  if (estimate > MAX_ONE_REP_MAX_KG) {
    return null;
  }
  return estimate;
}

/**
 * Whether an exercise can set a record at all: a bodyweight movement with a
 * belt of added weight does not lift that weight alone, so its "1RM" would
 * be the belt. Every other kind, a custom exercise with no kind included,
 * counts by its weight × reps.
 * @Arguments kind?
 */
export function countsForRecords(kind: string | null | undefined): boolean {
  return kind !== ExerciseKind.Bodyweight;
}
