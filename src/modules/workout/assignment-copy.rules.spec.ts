import {
  CopyDayLocks,
  CopyExerciseChanges,
  CopySetValues,
  copyDayLock,
  copyExerciseChange,
  copyLockError,
  copyMoveFrom,
  copyMoveRefusal,
  copySlotOn,
  sameSetValues,
} from './assignment-copy.rules';
import {
  ExerciseSetType,
  ProgramAssignmentStatus,
  WorkoutLogStatus,
} from './entities/workout.enums';

/**
 * The rules of a coach editing one client's copy (owner, 2026-11-20):
 * which days can change, where a day may move, and how a changed exercise
 * is labelled.
 */
describe('client copy rules', () => {
  const today = '2026-11-20';
  const open = {
    planStatus: ProgramAssignmentStatus.Active,
    dayStatus: null,
    scheduledDate: '2026-11-23',
    hasLog: false,
    today,
  };

  describe('copyDayLock: which days can change', () => {
    it('lets an upcoming day the client has not started change', () => {
      expect(copyDayLock(open)).toBeNull();
    });

    it("lets today's day change while it is not started", () => {
      expect(copyDayLock({ ...open, scheduledDate: today })).toBeNull();
    });

    it('lets a paused plan change', () => {
      expect(
        copyDayLock({ ...open, planStatus: ProgramAssignmentStatus.Paused }),
      ).toBeNull();
    });

    it('keeps a day whose date has passed', () => {
      expect(copyDayLock({ ...open, scheduledDate: '2026-11-19' })).toBe(
        CopyDayLocks.Past,
      );
    });

    it('keeps a day in progress', () => {
      expect(
        copyDayLock({ ...open, dayStatus: WorkoutLogStatus.InProgress }),
      ).toBe(CopyDayLocks.Started);
    });

    it('keeps a day with a workout log, whatever its status says', () => {
      expect(copyDayLock({ ...open, hasLog: true })).toBe(CopyDayLocks.Started);
    });

    it('keeps a finished day and a skipped day', () => {
      expect(
        copyDayLock({ ...open, dayStatus: WorkoutLogStatus.Completed }),
      ).toBe(CopyDayLocks.Done);
      expect(
        copyDayLock({ ...open, dayStatus: WorkoutLogStatus.Skipped }),
      ).toBe(CopyDayLocks.Skipped);
    });

    it.each([
      ProgramAssignmentStatus.Cancelled,
      ProgramAssignmentStatus.Completed,
      ProgramAssignmentStatus.Pending,
    ])('keeps every day of a %s plan', (planStatus) => {
      expect(copyDayLock({ ...open, planStatus })).toBe(
        CopyDayLocks.PlanClosed,
      );
    });

    it('names a catalog error for every lock', () => {
      expect(copyLockError(CopyDayLocks.Past)).toBe('workout.copyDayPast');
      expect(copyLockError(CopyDayLocks.Started)).toBe(
        'workout.copyDayStarted',
      );
      expect(copyLockError(CopyDayLocks.Done)).toBe('workout.copyDayDone');
      expect(copyLockError(CopyDayLocks.Skipped)).toBe(
        'workout.copyDaySkipped',
      );
      expect(copyLockError(CopyDayLocks.PlanClosed)).toBe(
        'workout.copyPlanClosed',
      );
    });
  });

  describe('copyMoveRefusal: where a day may move', () => {
    const plan = {
      today,
      startDate: '2026-11-02',
      endDate: '2026-12-25',
      takenDates: ['2026-11-25'],
    };

    it('takes a free date inside the plan', () => {
      expect(copyMoveRefusal({ ...plan, date: '2026-11-26' })).toBeNull();
      expect(copyMoveRefusal({ ...plan, date: today })).toBeNull();
      expect(copyMoveRefusal({ ...plan, date: '2026-12-25' })).toBeNull();
    });

    it('refuses the past', () => {
      expect(copyMoveRefusal({ ...plan, date: '2026-11-19' })).toBe(
        'workout.copyDatePast',
      );
    });

    it('refuses a date after the plan ends, or before it starts', () => {
      expect(copyMoveRefusal({ ...plan, date: '2026-12-26' })).toBe(
        'workout.copyDateOutsidePlan',
      );
      expect(
        copyMoveRefusal({
          ...plan,
          startDate: '2026-11-30',
          date: '2026-11-27',
        }),
      ).toBe('workout.copyDateOutsidePlan');
    });

    it('refuses a date another day holds', () => {
      expect(copyMoveRefusal({ ...plan, date: '2026-11-25' })).toBe(
        'workout.copyDateTaken',
      );
    });

    it('has no last date for a plan without an end', () => {
      expect(
        copyMoveRefusal({ ...plan, endDate: null, date: '2027-06-01' }),
      ).toBeNull();
    });

    it('starts at today, or at the plan start when that is later', () => {
      expect(copyMoveFrom(today, '2026-11-02')).toBe(today);
      expect(copyMoveFrom(today, '2026-11-30')).toBe('2026-11-30');
    });
  });

  describe('copyExerciseChange: the label', () => {
    const row = {
      isModifiedFromMaster: true,
      masterExerciseId: 'pe-1',
      exerciseId: 'bench',
    };

    it('says nothing for an unchanged row', () => {
      expect(
        copyExerciseChange({ ...row, isModifiedFromMaster: false }, 'press'),
      ).toBe(CopyExerciseChanges.None);
    });

    it('says Changed for a changed row on its own movement', () => {
      expect(copyExerciseChange(row, 'bench')).toBe(
        CopyExerciseChanges.Changed,
      );
    });

    it("says Replaced when its movement is not its program row's", () => {
      expect(copyExerciseChange(row, 'press')).toBe(
        CopyExerciseChanges.Replaced,
      );
    });

    it('says Added for a row with no program row', () => {
      expect(copyExerciseChange({ ...row, masterExerciseId: null }, null)).toBe(
        CopyExerciseChanges.Added,
      );
    });

    it('says Changed when the program row is out of reach', () => {
      expect(copyExerciseChange(row, null)).toBe(CopyExerciseChanges.Changed);
    });
  });

  describe('copySlotOn: the week and day follow the date', () => {
    // Week 2 (third week), Monday slot, on Monday 16 Nov.
    const day = { scheduledDate: '2026-11-16', weekIndex: 2, dayIndex: 0 };

    it('changes the day inside the week', () => {
      expect(copySlotOn(day, '2026-11-19')).toEqual({
        weekIndex: 2,
        dayIndex: 3,
      });
    });

    it('moves into the next week', () => {
      expect(copySlotOn(day, '2026-11-24')).toEqual({
        weekIndex: 3,
        dayIndex: 1,
      });
    });

    it('keeps a day on a grid that does not start on a Monday', () => {
      // Counted from a Wednesday start: week 0, slot 2 is the Friday.
      const wednesdayPlan = {
        scheduledDate: '2026-11-06',
        weekIndex: 0,
        dayIndex: 2,
      };
      expect(copySlotOn(wednesdayPlan, '2026-11-11')).toEqual({
        weekIndex: 1,
        dayIndex: 0,
      });
    });

    it('stays in week 0 before the grid begins', () => {
      const first = { scheduledDate: '2026-11-23', weekIndex: 0, dayIndex: 0 };
      expect(copySlotOn(first, '2026-11-21')).toEqual({
        weekIndex: 0,
        dayIndex: 5,
      });
    });
  });

  describe('sameSetValues', () => {
    const values: CopySetValues = {
      orderIndex: 0,
      setType: ExerciseSetType.Normal,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetWeightKg: 60,
      targetWeightPercent1rm: null,
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      targetRpe: null,
      targetRir: null,
      restAfterSeconds: 120,
      tempo: null,
      notes: null,
    };

    it('is true for a set that already holds the values', () => {
      expect(sameSetValues({ ...values }, values)).toBe(true);
    });

    it('is false when one target differs, or the set moved', () => {
      expect(sameSetValues({ ...values, targetWeightKg: 57.5 }, values)).toBe(
        false,
      );
      expect(sameSetValues({ ...values, orderIndex: 1 }, values)).toBe(false);
    });
  });
});
