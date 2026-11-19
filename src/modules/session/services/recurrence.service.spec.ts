import { RecurrenceService } from './recurrence.service';
import { DateTime } from 'luxon';

describe('RecurrenceService', () => {
  let service: RecurrenceService;

  beforeEach(() => {
    service = new RecurrenceService();
  });

  // §6.1 test case 1: Weekly Mon/Wed for 24 occurrences → 24 dates, alternating Mon/Wed
  it('weekly Mon/Wed for 24 occurrences produces 24 dates alternating Mon then Wed', () => {
    // Start on a Monday
    const firstStart = DateTime.fromISO('2026-01-05T09:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    const { dates, truncated } = service.computeOccurrences(
      firstStart,
      {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [1, 3],
        endAfterOccurrences: 24,
      },
      'Europe/Bucharest',
      100,
    );

    expect(dates).toHaveLength(24);
    expect(truncated).toBe(false);

    // Verify strict Mon/Wed alternation in Bucharest timezone
    for (let i = 0; i < dates.length; i++) {
      const dow = DateTime.fromJSDate(dates[i], {
        zone: 'Europe/Bucharest',
      }).weekday;
      // Even indices (0, 2, 4...) → Monday (1), odd indices (1, 3, 5...) → Wednesday (3)
      expect(dow).toBe(i % 2 === 0 ? 1 : 3);
    }
  });

  // §6.1 test case 2: Weekly across DST transition — wall-clock time preserved
  it('weekly across DST transition preserves wall-clock time', () => {
    // Europe/Bucharest transitions clocks forward on last Sunday in March (2026-03-29 at 03:00 → 04:00)
    // and back on last Sunday in October (2026-10-25 at 04:00 → 03:00).
    // A weekly 09:00 Bucharest session spanning these dates should always appear at 09:00 local.
    const firstStart = DateTime.fromISO('2026-03-16T09:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    const { dates } = service.computeOccurrences(
      firstStart,
      {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [1],
        endAfterOccurrences: 8,
      },
      'Europe/Bucharest',
      100,
    );

    expect(dates).toHaveLength(8);

    for (const d of dates) {
      const local = DateTime.fromJSDate(d, { zone: 'Europe/Bucharest' });
      expect(local.hour).toBe(9);
      expect(local.minute).toBe(0);
    }
  });

  // §6.1 test case 3: Monthly on 31st starting Jan 31 → clamped dates
  it('monthly on the 31st clamps to last day of shorter months', () => {
    const firstStart = DateTime.fromISO('2026-01-31T10:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    const { dates } = service.computeOccurrences(
      firstStart,
      { frequency: 'MONTHLY', interval: 1, endAfterOccurrences: 5 },
      'Europe/Bucharest',
      100,
    );

    expect(dates).toHaveLength(5);

    const locals = dates.map((d) =>
      DateTime.fromJSDate(d, { zone: 'Europe/Bucharest' }),
    );
    expect(locals[0].day).toBe(31); // Jan 31
    expect(locals[1].day).toBe(28); // Feb 28 (2026 is not a leap year)
    expect(locals[2].day).toBe(31); // Mar 31
    expect(locals[3].day).toBe(30); // Apr 30
    expect(locals[4].day).toBe(31); // May 31
  });

  // §6.1 test case 4: Daily interval=2, endDate=10 days out → 5 occurrences
  it('daily interval 2 with endDate 10 days out produces 5 occurrences', () => {
    const firstStart = DateTime.fromISO('2026-06-01T08:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();
    const endDate = '2026-06-10'; // 10 days out; days 1,3,5,7,9 = 5 occurrences

    const { dates, truncated } = service.computeOccurrences(
      firstStart,
      { frequency: 'DAILY', interval: 2, endDate },
      'Europe/Bucharest',
      100,
    );

    expect(dates).toHaveLength(5);
    expect(truncated).toBe(false);

    const locals = dates.map((d) =>
      DateTime.fromJSDate(d, { zone: 'Europe/Bucharest' }),
    );
    expect(locals[0].day).toBe(1);
    expect(locals[1].day).toBe(3);
    expect(locals[2].day).toBe(5);
    expect(locals[3].day).toBe(7);
    expect(locals[4].day).toBe(9);
  });

  // §6.1 test case 5: Empty result if endDate < firstStartAt
  it('returns empty result when endDate is before firstStartAt', () => {
    const firstStart = DateTime.fromISO('2026-06-10T08:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    const { dates, truncated } = service.computeOccurrences(
      firstStart,
      { frequency: 'DAILY', interval: 1, endDate: '2026-06-09' },
      'Europe/Bucharest',
      100,
    );

    expect(dates).toHaveLength(0);
    expect(truncated).toBe(false);
  });

  // Additional: cap triggers truncated flag
  it('sets truncated=true when cap is hit before rule natural end', () => {
    const firstStart = DateTime.fromISO('2026-01-01T09:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    const { dates, truncated } = service.computeOccurrences(
      firstStart,
      { frequency: 'DAILY', interval: 1, endAfterOccurrences: 100 },
      'Europe/Bucharest',
      10, // cap at 10
    );

    expect(dates).toHaveLength(10);
    expect(truncated).toBe(true);
  });

  // An empty day list used to spin the event loop forever: no week ever
  // added a date, and the end date was only checked inside the empty loop.
  it('returns nothing, at once, for a weekly rule with no days', () => {
    const firstStart = DateTime.fromISO('2026-06-10T08:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    for (const rule of [
      { frequency: 'WEEKLY' as const, interval: 1, daysOfWeek: [] },
      {
        frequency: 'WEEKLY' as const,
        interval: 1,
        daysOfWeek: [],
        endDate: '2026-07-01',
      },
      { frequency: 'WEEKLY' as const, interval: 1, daysOfWeek: [0, 9] },
    ]) {
      const { dates, truncated } = service.computeOccurrences(
        firstStart,
        rule,
        'Europe/Bucharest',
        100,
      );
      expect(dates).toHaveLength(0);
      expect(truncated).toBe(false);
    }
  });

  it('stops a weekly rule at its end date even between occurrences', () => {
    const firstStart = DateTime.fromISO('2026-06-10T08:00:00', {
      zone: 'Europe/Bucharest',
    })
      .toUTC()
      .toJSDate();

    const { dates } = service.computeOccurrences(
      firstStart,
      {
        frequency: 'WEEKLY',
        interval: 1,
        daysOfWeek: [3],
        endDate: '2026-06-30',
      },
      'Europe/Bucharest',
      100,
    );

    // Wednesdays 10, 17 and 24 June.
    expect(dates).toHaveLength(3);
  });
});
