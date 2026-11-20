/**
 * The calendar rules of pausing a client's plan (owner, 2026-11-20).
 *
 * While a plan is paused its days are not auto-skipped. When the coach
 * resumes it, every day left open that was scheduled on or after the day
 * the pause began moves forward by the fewest whole weeks that put none of
 * them in the past: the client keeps the same weekdays, nothing counts as
 * missed, the percent done is untouched, and the plan ends later. Days that
 * were due before the pause keep the ordinary rules (the nightly sweep
 * skips them once the plan is active again).
 *
 * All of it is `YYYY-MM-DD` arithmetic in UTC, the space `assigned_workout`
 * stores its dates in and the nightly sweep compares them in, so a
 * daylight saving change never moves a day.
 */

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;

/** Midnight UTC of a `YYYY-MM-DD`, as a timestamp. */
function utcDay(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole calendar days from one date to another (negative when `to` is
 * earlier).
 * @Arguments from, to
 */
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

/**
 * A date moved by whole weeks, so it keeps its weekday.
 * @Arguments isoDate, weeks
 */
export function shiftByWeeks(isoDate: string, weeks: number): string {
  const moved = new Date(utcDay(isoDate) + weeks * DAYS_PER_WEEK * DAY_MS);
  return moved.toISOString().slice(0, 10);
}

/**
 * How many weeks the open days of a resumed plan move: the fewest that put
 * the earliest of them on today or later. Zero when none is in the past.
 * @Arguments earliestOpen, today
 */
export function resumeShiftWeeks(earliestOpen: string, today: string): number {
  const behind = daysBetweenDates(earliestOpen, today);
  if (behind <= 0) {
    return 0;
  }
  return Math.ceil(behind / DAYS_PER_WEEK);
}

/**
 * The calendar day a pause began, in the sweep's UTC space. The status
 * change's time when it is known; a plan paused before that was stored
 * (migration 088) falls back to its last update, which for a paused plan
 * was the pause itself.
 * @Arguments statusChangedAt, updatedAt
 */
export function pauseStartDate(
  statusChangedAt: Date | null,
  updatedAt: Date | null,
): string | null {
  let when = statusChangedAt;
  if (!when) {
    when = updatedAt;
  }
  if (!when) {
    return null;
  }
  return new Date(when).toISOString().slice(0, 10);
}
