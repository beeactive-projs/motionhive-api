export const workout = {
  programAssigned: {
    title: 'New program assigned',
    body: '{coach} assigned you "{program}", starting {start}.',
  },
  clientCompletedWorkout: {
    title: '{client} finished a workout',
    body: '{workout} is logged, {sets, plural, one {# set} other {# sets}} completed.',
  },
  clientCompletedPlan: {
    title: '{client} finished {program}',
    body: '{count, plural, one {# session done} other {All # sessions done}}. Time to debrief and set what comes next.',
  },
  workoutTakenDown: {
    title: 'A workout was removed from your profile',
    body: 'After a report, we removed "{workout}" from your profile for {reason, select, SPAM {spam} SCAM {fraud} HARASSMENT {harassment} IMPERSONATION {impersonation} SEXUAL {sexual content} other {breaking our rules}}. It stays in your history, but it can no longer go on your profile or be shared.',
  },
};
