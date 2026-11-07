import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

const loggedSetExample = {
  id: 'c1d2e3f4-0000-1111-2222-3333abcd5555',
  loggedExerciseId: 'b1c2d3e4-0000-1111-2222-3333abcd6666',
  assignedSetId: null,
  prescribedSetId: 'e1f2a3b4-0000-1111-2222-3333abcd7777',
  orderIndex: 0,
  setType: 'NORMAL',
  reps: 8,
  weightKg: 62.5,
  rpe: 8,
  restAfterSeconds: 150,
  restSource: 'TAP',
  isCompleted: true,
  completedAt: '2026-11-02T09:12:00.000Z',
  notes: null,
  assignedSet: null,
  prescribedSet: {
    id: 'e1f2a3b4-0000-1111-2222-3333abcd7777',
    targetRepsMin: 8,
    targetRepsMax: 10,
    targetWeightKg: 62.5,
    restAfterSeconds: 120,
  },
  plannedRestSeconds: 120,
};

/** Workout logs (`/workout-logs/...`), the owner's own routes. */
export const WorkoutLogDocs = {
  get: {
    summary: 'One of my workouts, with its exercises and sets',
    description:
      'Owner only (404 otherwise). What the logger and the finished ' +
      'workout read. Each logged exercise carries its plan note: ' +
      '`assignedExercise` `{ id, notes }` for a coach plan, ' +
      '`prescribedExercise` `{ id, notes, programWorkoutId }` for a ' +
      'routine (each null otherwise), and `personalNote` (string or ' +
      'null), the owner’s private note on the exercise, which a ' +
      'coach’s read never carries. Each set carries its plan set ' +
      '(`assignedSet` or `prescribedSet`, targets and rest), ' +
      '`restAfterSeconds` + `restSource` (the rest actually taken: TAP, ' +
      'ESTIMATED, BREAK, or null from the older logger) and ' +
      '`plannedRestSeconds`: the set’s planned rest, else the day’s, ' +
      'else the program’s default, null when nothing is planned (the ' +
      'app then uses the person’s default rest, then 90 s). A finished ' +
      'workout adds `personalRecords` and `summary`. `summary.volume` ' +
      'compares it with last time, over working sets (completed, not ' +
      'warm-ups): `totalKg`; `previous` `{ workoutLogId, name, ' +
      'completedAt, totalKg }`, the last time this routine or plan day ' +
      'was done (null for freestyle or a first time); `changeKg` and ' +
      '`changePercent` (null without a previous); and `exercises`, one ' +
      'per exercise done, `{ exerciseId, loggedExerciseId, unit, volume, ' +
      'previous: { workoutLogId, performedAt, volume } | null, ' +
      'changePercent }`, today against the last session of that exercise ' +
      'in any workout, in its unit (`kg` | `reps` | `seconds` | `meters`).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'The workout',
        example: {
          id: 'a1b2c3d4-0000-1111-2222-3333abcd4444',
          name: 'Push day A',
          status: 'IN_PROGRESS',
          sourceProgramId: 'f1a2b3c4-0000-1111-2222-3333abcd8888',
          sourceProgram: {
            id: 'f1a2b3c4-0000-1111-2222-3333abcd8888',
            name: 'Push day A',
            isSingleWorkout: true,
            defaultRestSeconds: 90,
          },
          hasPhoto: false,
          exercises: [
            {
              id: 'b1c2d3e4-0000-1111-2222-3333abcd6666',
              exerciseId: 'ab12cd34-0000-1111-2222-3333abcd9999',
              exerciseNameSnapshot: 'Bench press',
              supersetGroupId: null,
              assignedExercise: null,
              prescribedExercise: {
                id: 'd1e2f3a4-0000-1111-2222-3333abcd0000',
                notes: 'Pause on the chest.',
                programWorkoutId: 'aa11bb22-0000-1111-2222-3333abcd1111',
              },
              personalNote: 'Seat on 4, elbows in.',
              sets: [loggedSetExample],
            },
          ],
        },
      },
      { status: 404, description: 'No such workout, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  logSet: {
    summary: 'Log one set',
    description:
      'Owner only, workout IN_PROGRESS. Any subset of the actuals. ' +
      '`restAfterSeconds` is the rest actually taken after this set, and ' +
      '`restSource` says how it was measured: TAP (the person ended the ' +
      'rest), ESTIMATED (from the next tick) or BREAK (away: ' +
      '`restAfterSeconds` is stored as null whatever is sent). A tick ' +
      'is stamped now, or at `completedAt` when the app saves a lock ' +
      'screen ✓ later (held between the workout start and now). Answers ' +
      'with the set row, `restSource` included.',
    auth: true,
    responses: [
      { status: 200, description: 'The set as stored' },
      {
        status: 400,
        description:
          'Invalid body, or the workout is not in progress (`workout.cannotLogSetsNotInProgress`)',
      },
      { status: 404, description: 'No such workout or set, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  remove: {
    summary: 'Delete a workout',
    description:
      'Owner only. A workout IN_PROGRESS is discarded, as before: its plan ' +
      'day goes back to not started. A finished one (COMPLETED, or any ' +
      'status that is no longer running) is deleted in one transaction ' +
      'with its sets, its records (one-rep maxes it set), its reports; a ' +
      'group post that shared it keeps its text and loses the card. Its ' +
      'plan day goes back to not started, a plan it had completed is ' +
      'ACTIVE again with its percent recomputed, the routine’s ' +
      '`lastPerformedAt` is worked out again, and its photo is deleted.',
    auth: true,
    responses: [
      { status: 204, description: 'Deleted' },
      { status: 404, description: 'No such workout, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  removeSets: {
    summary: 'Delete several sets of a running workout',
    description:
      'Owner only, IN_PROGRESS only. Deletes the given sets in one ' +
      'transaction (a whole round of a superset is the reason). All or ' +
      'nothing: if any id is not a set of this workout, none is deleted ' +
      'and the answer is 404. At most 20 ids, no repeats.',
    auth: true,
    responses: [
      { status: 204, description: 'Deleted' },
      { status: 400, description: 'The workout is not in progress' },
      { status: 404, description: 'No such workout or set, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  resume: {
    summary: 'Start the clock again',
    description:
      'Owner only, workout IN_PROGRESS. Folds the pause into ' +
      '`pausedSeconds`. The pause ends now, or at `at` when Continue was ' +
      'tapped on the lock screen and the app saves it later (held between ' +
      'the start of the pause and now). A running workout is left as it is.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'The workout, running again',
        example: {
          id: 'a1b2c3d4-0000-1111-2222-3333abcd4444',
          status: 'IN_PROGRESS',
          startedAt: '2026-11-02T08:30:00.000Z',
          pausedAt: null,
          pausedSeconds: 420,
        },
      },
      {
        status: 400,
        description: 'Not in progress (`workout.cannotEditNotInProgress`)',
      },
      { status: 404, description: 'No such workout, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  pauseGap: {
    summary: 'Pause a workout for time already spent away',
    description:
      'Owner only, workout IN_PROGRESS. "You were away 25 min. Pause the ' +
      'workout for that time?" Adds `seconds` (60 or more) to ' +
      '`pausedSeconds`, so the time leaves the duration. Never more than ' +
      'the active time so far (`workout.pauseGapTooLong`). Answers with ' +
      'the workout row, as pause and resume do.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'The workout, with the new paused time',
        example: {
          id: 'a1b2c3d4-0000-1111-2222-3333abcd4444',
          status: 'IN_PROGRESS',
          startedAt: '2026-11-02T08:30:00.000Z',
          pausedAt: null,
          pausedSeconds: 1500,
        },
      },
      {
        status: 400,
        description:
          'Under 60 seconds, longer than the workout has run (`workout.pauseGapTooLong`), or not in progress (`workout.cannotEditNotInProgress`)',
      },
      { status: 404, description: 'No such workout, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setDuration: {
    summary: 'Correct how long a finished workout took',
    description:
      'Owner only. Replaces the measured `durationSeconds` of a COMPLETED ' +
      'workout, so History, Progress and the share card read the corrected ' +
      'length. Between 60 seconds and 6 hours: past 6 hours a measured ' +
      'duration is stored as unknown, so a correction cannot claim more. ' +
      '`startedAt`, `completedAt` and `pausedSeconds` are left as they are, ' +
      'so the measured length can still be worked out from them.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Corrected',
        example: {
          id: 'a1b2c3d4-0000-1111-2222-3333abcd4444',
          durationSeconds: 4320,
        },
      },
      {
        status: 400,
        description:
          'Out of range (`workout.durationOutOfRange`) or not finished (`workout.durationNotFinished`)',
      },
      { status: 404, description: 'No such workout, or not yours' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
