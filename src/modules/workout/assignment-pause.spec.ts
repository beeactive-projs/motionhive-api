import {
  daysBetweenDates,
  pauseStartDate,
  resumeShiftWeeks,
  shiftByWeeks,
} from './assignment-pause';

describe('assignment pause rules', () => {
  describe('resumeShiftWeeks', () => {
    it('moves nothing when the earliest open day is still ahead or today', () => {
      expect(resumeShiftWeeks('2026-11-25', '2026-11-20')).toBe(0);
      expect(resumeShiftWeeks('2026-11-20', '2026-11-20')).toBe(0);
    });

    it('moves one week for a short pause', () => {
      // Paused on a Wednesday, resumed that Friday.
      expect(resumeShiftWeeks('2026-11-18', '2026-11-20')).toBe(1);
    });

    it('moves exactly as many weeks as the pause lasted when it lands on the weekday', () => {
      expect(resumeShiftWeeks('2026-11-02', '2026-11-16')).toBe(2);
    });

    it('rounds a partial week up, so no day stays in the past', () => {
      expect(resumeShiftWeeks('2026-11-02', '2026-11-17')).toBe(3);
    });

    it('counts across a month end', () => {
      expect(resumeShiftWeeks('2026-01-28', '2026-02-05')).toBe(2);
    });

    it('counts across a year end', () => {
      expect(resumeShiftWeeks('2026-12-28', '2027-01-04')).toBe(1);
    });

    it('counts across the spring and autumn clock changes as plain days', () => {
      // Europe moves its clocks on 29 March and 25 October 2026.
      expect(resumeShiftWeeks('2026-03-26', '2026-04-02')).toBe(1);
      expect(resumeShiftWeeks('2026-10-22', '2026-10-29')).toBe(1);
    });
  });

  describe('shiftByWeeks', () => {
    it('keeps the weekday', () => {
      const moved = shiftByWeeks('2026-11-18', 3);
      expect(moved).toBe('2026-12-09');
      expect(new Date(`${moved}T00:00:00Z`).getUTCDay()).toBe(3);
    });

    it('crosses a month end and a leap day', () => {
      expect(shiftByWeeks('2026-01-28', 1)).toBe('2026-02-04');
      expect(shiftByWeeks('2028-02-26', 1)).toBe('2028-03-04');
      expect(shiftByWeeks('2028-02-22', 1)).toBe('2028-02-29');
    });

    it('crosses a year end', () => {
      expect(shiftByWeeks('2026-12-30', 1)).toBe('2027-01-06');
    });

    it('does not lose or gain a day over a clock change', () => {
      expect(shiftByWeeks('2026-03-26', 1)).toBe('2026-04-02');
      expect(shiftByWeeks('2026-10-22', 1)).toBe('2026-10-29');
    });

    it('leaves a date alone for zero weeks', () => {
      expect(shiftByWeeks('2026-11-20', 0)).toBe('2026-11-20');
    });
  });

  describe('daysBetweenDates', () => {
    it('is negative when the second date is earlier', () => {
      expect(daysBetweenDates('2026-11-20', '2026-11-18')).toBe(-2);
    });
  });

  describe('pauseStartDate', () => {
    it('is the UTC day the pause was recorded', () => {
      expect(pauseStartDate(new Date('2026-11-19T23:30:00Z'), new Date())).toBe(
        '2026-11-19',
      );
    });

    it('falls back to the last update for a plan paused before it was recorded', () => {
      expect(pauseStartDate(null, new Date('2026-11-10T08:00:00Z'))).toBe(
        '2026-11-10',
      );
    });

    it('is null with nothing to read', () => {
      expect(pauseStartDate(null, null)).toBeNull();
    });
  });
});
