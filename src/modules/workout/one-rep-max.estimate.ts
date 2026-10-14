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
export function estimateOneRepMaxEpley(
  reps: number | null,
  weightKg: number | null,
): number | null {
  if (reps == null || weightKg == null) return null;
  if (reps < 1 || reps > 12 || weightKg <= 0) return null;
  return Math.round(weightKg * (1 + reps / 30) * 100) / 100;
}
