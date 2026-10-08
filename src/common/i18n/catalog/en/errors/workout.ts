export const workout = {
  // ─── Not found ───────────────────────────────────────────────────
  programNotFound: 'Program not found.',
  routineNotFound: 'Routine not found.',
  workoutNotFound: 'Workout not found.',
  weekNotFound: 'Week not found.',
  setNotFound: 'Set not found.',
  assignmentNotFound: 'Assignment not found.',
  clientNotFound: 'Client not found.',
  logNotFound: 'Workout log not found.',

  // ─── Program builder ─────────────────────────────────────────────
  exercisesOnlyOnRoutine:
    'Exercises can be added directly only to a routine. In a multi-week program, add them to each workout.',
  routineHasNoWorkout: 'This routine has no workout to put exercises in.',
  reorderDuplicate:
    'The same item appears twice in the new order. Refresh and try again.',
  reorderPositionClash:
    'Two items would end up in position {position}. Refresh and try again.',
  slotTaken: 'A workout already exists at week {week}, day {day}.',
  slotClash: 'Two workouts would occupy week {week}, day {day}.',
  copyWeekSameWeek: 'Source and target week must differ.',
  weekEmpty: 'That week has nothing to copy.',
  copyDayOneWeek:
    'Copying onto a different day works with one target week at a time.',
  copyDayNoTarget: 'Pick at least one other week to copy into.',
  dayEmpty: 'That day has nothing to copy.',
  routineNoWeeksToRepeat: 'A routine has no weeks to repeat.',
  programNeedsLength:
    'Give the program a length first, so there are weeks to fill.',
  nothingToRepeat: 'There is nothing to repeat yet.',
  routineNoWeeksToDelete: 'A routine has no weeks to delete.',
  programNeedsOneWeek: 'A program needs at least one week.',
  cannotDeleteLiveWeek:
    '{clients, plural, one {# client is} other {# clients are}} on this program, so week {week} cannot be deleted. That would drop {days, plural, one {# day} other {# days}} they are still training. Finish or cancel their assignments first.',
  cannotShortenLiveProgram:
    '{clients, plural, one {# client is} other {# clients are}} on this program, so it cannot be shortened to {weeks, plural, one {# week} other {# weeks}}. That would drop {days, plural, one {# day} other {# days}} they are still training. Finish or cancel their assignments first.',
  repRangeInvalid: 'The minimum reps cannot be higher than the maximum.',
  weightModeConflict:
    'Pick either a weight in kg or a percentage of 1RM, not both.',

  // ─── Assignments ─────────────────────────────────────────────────
  cannotAssignDeleted: 'Cannot assign a deleted program.',
  assignActiveClientsOnly:
    'You can only assign programs to your active clients.',
  routineNothingToSchedule:
    'This routine has no exercises yet, so there is nothing to schedule.',
  blockNeedsWeeks: 'A block schedule needs to know how many weeks it runs for.',
  cannotSkipCompleted: "This workout is already complete and can't be skipped.",
  pickTrainingDays:
    'This program trains on {count, plural, one {# day} other {# days}} a week. Pick exactly that many.',
  assignmentClosed:
    'This assignment is {status, select, COMPLETED {completed} CANCELLED {cancelled} other {closed}}, so its status can no longer change.',

  // ─── Workout logging ─────────────────────────────────────────────
  startOneSource:
    'Start either a workout from your plan or a routine, not both.',
  freestyleNameRequired: 'Give your freestyle workout a name to start it.',
  programNothingToStart:
    'This program has no workouts yet, so there is nothing to start.',
  nothingToSaveAsRoutine: 'This workout has no exercises to save as a routine.',
  cannotLogSetsNotInProgress:
    'Cannot log sets on a workout that is no longer in progress.',
  cannotAddExercisesNotInProgress:
    'Cannot add exercises to a workout that is no longer in progress.',
  cannotEditNotInProgress:
    'Cannot edit a workout that is no longer in progress.',
  cannotAddSetsNotInProgress:
    'Cannot add sets to a workout that is no longer in progress.',
  sameExerciseSwap: 'That is already the exercise being logged.',
  cannotDiscardFinished:
    'Only a workout in progress can be cancelled. Finished workouts stay in your history.',
  alreadyInProgress:
    '{name} is still in progress. Finish or discard it before starting another workout.',
};
