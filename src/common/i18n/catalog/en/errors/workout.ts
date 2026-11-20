export const workout = {
  planTooLarge:
    'This plan would hold more than {max, number} sets. Schedule fewer weeks or days, or a shorter routine.',
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
  routineNoWeeksToAdd: 'A routine has no weeks to add to.',
  routineNoWeeksToClear: 'A routine has no weeks to clear.',
  programNeedsOneWeek: 'A program needs at least one week.',
  programTooLong:
    'A program runs for at most {weeks, plural, one {# week} other {# weeks}}.',
  setListDuplicate:
    'The same set appears twice in the list. Refresh and try again.',
  cannotPublishWithoutName:
    '{kind, select, routine {Give the routine a name before you publish it.} other {Give the program a name before you publish it.}}',
  cannotPublishWithoutExercises:
    '{kind, select, routine {Add at least one exercise to the routine before you publish it.} other {Add exercises to at least one day before you publish the program.}}',
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
  dayAlreadyFinished:
    "This day of the plan is already done, so it can't be started again.",
  planNotActive:
    "This plan is {status, select, PAUSED {paused} COMPLETED {finished} CANCELLED {cancelled} other {not active}}, so its workouts can't be started.",
  pickTrainingDays:
    'This program trains on {count, plural, one {# day} other {# days}} a week. Pick exactly that many.',
  assignmentClosed:
    'This assignment is {status, select, COMPLETED {completed} CANCELLED {cancelled} other {closed}}, so its status can no longer change.',

  // ─── A client's copy of a plan ───────────────────────────────────
  copyPlanClosed:
    'This plan is no longer running, so its days can no longer change.',
  copyDayDone: "This day is done, so it can't change.",
  copyDaySkipped: "This day was skipped, so it can't change.",
  copyDayStarted: "This day has been started, so it can't change.",
  copyDayPast: "This day's date has passed, so it can't change.",
  copyDatePast: "A day can't move to a date that has passed.",
  copyDateOutsidePlan:
    'Pick a date inside the plan, between its first and last day.',
  copyDateTaken:
    'Another day of this plan is already on that date. Pick a free one.',
  copyCannotRevert:
    'This exercise has no program values to go back to: it was added for this client, or its row in the program was removed.',

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
  cannotCompleteNotInProgress: 'Only a workout in progress can be finished.',
  photoNotFinished: 'Add a photo once the workout is finished.',
  photoJpegOnly: 'Send the photo as a JPEG.',
  photoNotFound: 'This workout has no photo.',
  durationNotFinished: 'Only a finished workout can have its length corrected.',
  durationOutOfRange: 'A workout lasts between 1 minute and 6 hours.',
  pauseGapTooLong:
    'That is longer than the workout has been running, so it cannot be paused for that long.',

  // ─── Reports and takedowns ───────────────────────────────────────
  takenDownNoShare:
    "This workout was removed after a report, so it can't be shared.",
  takenDownStaysPrivate:
    'This workout was removed after a report, so it has to stay private.',
  cannotReportOwn: "You can't report your own workout.",
  reportAlreadyOpen:
    "You've already reported this workout. We're looking into it.",
  reportNotFound: 'Report not found.',
  reportTransition: 'This report can no longer move to that status.',
  takeDownNeedsResolve:
    'Taking a workout down resolves its report, so set the status to resolved.',
  alreadyInProgress:
    '{name} is still in progress. Finish or discard it before starting another workout.',
};
