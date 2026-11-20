export const workout = {
  programAssigned: {
    title: 'New program assigned',
    body: '{coach, select, null {Your coach} other {{coach}}} assigned you "{program}", starting {start}.',
  },
  clientCompletedWorkout: {
    title:
      '{client, select, null {Your client} other {{client}}} finished a workout',
    body: '{workout} is logged, {sets, plural, one {# set} other {# sets}} completed.',
  },
  clientCompletedPlan: {
    title:
      '{client, select, null {Your client} other {{client}}} finished {program}',
    body: '{count, plural, one {# session done} other {All # sessions done}}. Time to debrief and set what comes next.',
  },
  planPaused: {
    title:
      '{coach, select, null {Your coach} other {{coach}}} paused "{program}"',
    body: 'Its days wait for you, and paused days don\'t count as missed.{note, select, null {} other { "{note}"}}',
  },
  planResumed: {
    title:
      '{coach, select, null {Your coach} other {{coach}}} resumed "{program}"',
    body: '{weeks, plural, =0 {Your workouts are on the days they were.} one {Your workouts still to do moved one week later, on the same weekdays.} other {Your workouts still to do moved # weeks later, on the same weekdays.}}{note, select, null {} other { "{note}"}}',
  },
  planFinishedByCoach: {
    title:
      '{coach, select, null {Your coach} other {{coach}}} marked "{program}" as finished',
    body: 'It stays in your history as finished, at {percent}% done.{note, select, null {} other { "{note}"}}',
  },
  planCancelled: {
    title:
      '{coach, select, null {Your coach} other {{coach}}} cancelled "{program}"',
    body: '{done, plural, =0 {Its days still to come are off your calendar.} one {Its days still to come are off your calendar. The workout you finished stays in your history.} other {Its days still to come are off your calendar. The # workouts you finished stay in your history.}}{note, select, null {} other { "{note}"}}',
  },
  planAdjusted: {
    title:
      '{coach, select, null {Your coach} other {{coach}}} adjusted your plan',
    body: '{day}, week {week}{others, plural, =0 {} one { and one more day} other { and # more days}} of "{program}".',
  },
  workoutAutoSaved: {
    title: 'We saved your workout',
    body: '"{workout}" was still open, so we saved it with the sets you ticked, ending at the last one. Open it if the duration needs a fix.',
  },
  workoutTakenDown: {
    title: 'A workout was removed from your profile',
    body: 'After a report, we removed "{workout}" from your profile for {reason, select, SPAM {spam} SCAM {fraud} HARASSMENT {harassment} IMPERSONATION {impersonation} SEXUAL {sexual content} other {breaking our rules}}. It stays in your history, but it can no longer go on your profile or be shared.',
  },
};
