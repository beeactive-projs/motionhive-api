/**
 * A plan's "% done": the days completed, of all its days. A skipped day is
 * not done, so it counts in the total and never as progress (the apps say
 * "40% done"). Every path that changes a day's status (finish, discard,
 * delete, skip, the nightly auto-skip) uses this one rule, so the number
 * never goes down when a workout is finished.
 * @Arguments completed, total
 */
export function completionPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((completed / total) * 100));
}
