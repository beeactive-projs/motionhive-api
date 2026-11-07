/**
 * Weekly training streaks, shared by the progress overview and the
 * workout summary.
 *
 * `weeks` are the distinct Monday-based weeks holding at least one
 * completed workout, as ISO dates, newest first: what Postgres
 * `DATE_TRUNC('week', …)::DATE` returns. Current counts back from this
 * week or last week, so someone who trains Mon-Fri does not watch their
 * streak die every Sunday before they have had a chance to train.
 */
export function streakFromWeeks(
  weeks: string[],
  now: Date = new Date(),
): { currentWeeks: number; bestWeeks: number } {
  if (!weeks.length) return { currentWeeks: 0, bestWeeks: 0 };

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const asTime = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const times = weeks.map(asTime);

  // Longest run of consecutive weeks anywhere in the history.
  let best = 1;
  let run = 1;
  for (let i = 1; i < times.length; i++) {
    if (times[i - 1] - times[i] === WEEK_MS) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  const day = now.getUTCDay();
  // Postgres DATE_TRUNC('week') is Monday-based; match it.
  const daysSinceMonday = (day + 6) % 7;
  const thisWeek = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday,
  );

  let current = 0;
  if (times[0] === thisWeek || times[0] === thisWeek - WEEK_MS) {
    current = 1;
    for (let i = 1; i < times.length; i++) {
      if (times[i - 1] - times[i] === WEEK_MS) current += 1;
      else break;
    }
  }

  return { currentWeeks: current, bestWeeks: best };
}
