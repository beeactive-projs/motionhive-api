import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { RecurrenceRule } from '../entities/session-template.entity';

/** About 20 years of weeks: the weekly loop never scans more than this. */
const MAX_WEEKS_SCANNED = 1_040;

export interface ComputeResult {
  dates: Date[];
  truncated: boolean;
}

@Injectable()
export class RecurrenceService {
  computeOccurrences(
    firstStartAt: Date,
    rule: RecurrenceRule,
    timezone: string,
    cap: number,
  ): ComputeResult {
    const origin = DateTime.fromJSDate(firstStartAt, { zone: 'utc' }).setZone(
      timezone,
    );
    const results: DateTime[] = [];
    let hitCap = false;

    const limit = rule.endAfterOccurrences ?? Infinity;
    const stopDate = rule.endDate
      ? DateTime.fromISO(rule.endDate, { zone: timezone }).endOf('day')
      : null;

    const push = (dt: DateTime): boolean => {
      if (results.length >= cap) {
        hitCap = true;
        return false;
      }
      results.push(dt);
      return results.length < cap;
    };

    if (rule.frequency === 'WEEKLY') {
      // Only real weekdays, once each. With none (a rule stored before the
      // DTO required one) there is nothing to generate: an empty list used
      // to loop forever, since no week ever adds a date.
      const sortedDays = [...new Set(rule.daysOfWeek ?? [])]
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
        .sort((a, b) => a - b);
      if (sortedDays.length === 0) {
        return { dates: [], truncated: false };
      }
      let cursor = origin;
      // A backstop on the week count, far past any cap a caller passes.
      let weeksLeft = MAX_WEEKS_SCANNED;

      while (results.length < limit && results.length < cap && weeksLeft > 0) {
        weeksLeft -= 1;
        const weekStart = cursor.startOf('week');
        if (stopDate && weekStart > stopDate) {
          break;
        }

        for (const dow of sortedDays) {
          const candidate = weekStart.plus({ days: dow - 1 }).set({
            hour: origin.hour,
            minute: origin.minute,
            second: 0,
            millisecond: 0,
          });

          if (candidate < origin) continue;
          if (stopDate && candidate > stopDate) {
            hitCap = false;
            return { dates: this.toUtcDates(results), truncated: false };
          }
          if (!push(candidate))
            return { dates: this.toUtcDates(results), truncated: true };
          if (results.length >= limit)
            return { dates: this.toUtcDates(results), truncated: false };
        }
        cursor = cursor.plus({ weeks: rule.interval });
      }
    } else if (rule.frequency === 'DAILY') {
      let cursor = origin;

      while (results.length < limit && results.length < cap) {
        if (stopDate && cursor > stopDate) break;
        if (!push(cursor))
          return { dates: this.toUtcDates(results), truncated: true };
        if (results.length >= limit) break;
        cursor = cursor.plus({ days: rule.interval });
      }
    } else if (rule.frequency === 'MONTHLY') {
      // Always compute from origin to preserve the original day-of-month intent.
      // e.g. Jan 31 + 2 months = Mar 31 (not Mar 28 if we stepped through Feb 28).
      let step = 0;

      while (results.length < limit && results.length < cap) {
        const cursor = origin.plus({ months: step });
        if (stopDate && cursor > stopDate) break;
        if (!push(cursor))
          return { dates: this.toUtcDates(results), truncated: true };
        if (results.length >= limit) break;
        step += rule.interval;
      }
    }

    return { dates: this.toUtcDates(results), truncated: hitCap };
  }

  private toUtcDates(dts: DateTime[]): Date[] {
    return dts.map((dt) => dt.toUTC().toJSDate());
  }
}
