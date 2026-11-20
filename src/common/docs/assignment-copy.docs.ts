import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

/**
 * A coach edits one client's copy of a plan (`/program-assignments/:id/copy`).
 * The copy is the client's own; nothing here reaches the program or its
 * other clients.
 */

const WHO =
  "Coach only: the plan's own coach, while they still coach the client " +
  '(ACTIVE relationship). Anyone else gets 404 `workout.assignmentNotFound`.';

const EDITABLE =
  'Only an upcoming day can change: scheduled today or later, with no ' +
  'workout log (not started, finished or skipped), on an ACTIVE or PAUSED ' +
  'plan. Otherwise 409 `workout.copyPlanClosed`, `workout.copyDayDone`, ' +
  '`workout.copyDaySkipped`, `workout.copyDayStarted` or ' +
  '`workout.copyDayPast`. One transaction, with the plan and the day locked.';

const daySummaryExample = {
  id: 'c3d4e5f6-2222-3333-4444-5555cdef6666',
  name: 'Push A',
  notes: null,
  weekIndex: 2,
  dayIndex: 0,
  scheduledDate: '2026-11-23',
  status: null,
  lock: null,
  editable: true,
  changed: false,
};

const assignmentExample = {
  id: 'a1b2c3d4-0000-1111-2222-3333abcd4444',
  status: 'ACTIVE',
  programNameSnapshot: 'Strength Base',
  masterProgramId: 'b2c3d4e5-1111-2222-3333-4444bcde5555',
  startDate: '2026-11-09',
  endDate: '2027-01-01',
  completionPercent: 42,
  clientId: '5c1a8b9d-2e3f-4a01-9b8c-7d6e5f4a3b2c',
  client: {
    id: '5c1a8b9d-2e3f-4a01-9b8c-7d6e5f4a3b2c',
    firstName: 'Anna',
    lastName: 'Popescu',
    avatarUrl: null,
    handle: 'anna',
  },
};

export const AssignmentCopyDocs = {
  overview: {
    summary: "Every day of one client's copy of a plan",
    description:
      `${WHO} Every day in date order, each with \`editable\` and its ` +
      '`lock` (PLAN_CLOSED, DONE, SKIPPED, STARTED, PAST or null), its ' +
      '`exerciseCount`, and `changed` (the coach changed it at some point).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'The copy',
        example: {
          assignment: assignmentExample,
          today: '2026-11-20',
          days: [{ ...daySummaryExample, exerciseCount: 5 }],
        },
      },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  day: {
    summary: "One day of a client's copy, whole",
    description:
      `${WHO} The day with its exercises and sets. Each exercise carries ` +
      '`change` (NONE, CHANGED, REPLACED or ADDED), `canRevert`, `program` ' +
      '(its program row as the program is now: movement, note, sets with ' +
      'the planned rest; null when added here or that row is gone) and ' +
      "`lastResult` (the client's last finished session of the movement " +
      'the coach may read: date, completed working sets, average logged ' +
      'effort; null when none). `move` says where the day may go: `from`, ' +
      "`to` and the dates the plan's other days hold (`taken`).",
    auth: true,
    responses: [
      { status: 200, description: 'The day' },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setSets: {
    summary: "Set every set of one exercise of a client's copy (atomic)",
    description:
      `${WHO} ${EDITABLE} Body \`{ sets: [{ id?, setType?, ` +
      'targetRepsMin?, targetRepsMax?, targetWeightKg?, ' +
      'targetWeightPercent1rm?, targetDurationSeconds?, ' +
      'targetDistanceMeters?, targetRpe?, targetRir?, restAfterSeconds?, ' +
      'tempo?, notes? }] }`, the rules of the program route: a set with ' +
      'its `id` is updated in place, one without is added, one left out is ' +
      'removed, and a field left out is cleared. Marks the exercise ' +
      'changed for the client unless nothing changed. Returns the sets in ' +
      'order.',
    auth: true,
    responses: [
      { status: 200, description: 'Sets saved' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      { status: 409, description: 'The day cannot change' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateExercise: {
    summary: "Swap an exercise or change its note, in a client's copy",
    description:
      `${WHO} ${EDITABLE} Body \`{ exerciseId?, notes? }\`. A new ` +
      '`exerciseId` swaps the movement and keeps its sets; it must be ' +
      'readable by the coach (404 `exercise.notFound`). Marks it changed; a ' +
      'swap shows as REPLACED while its program row names another movement.',
    auth: true,
    responses: [
      { status: 200, description: 'Exercise saved' },
      ApiStandardResponses.NotFound,
      { status: 409, description: 'The day cannot change' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  addExercises: {
    summary: "Add several exercises to a day of a client's copy (atomic)",
    description:
      `${WHO} ${EDITABLE} Body \`{ exercises: [{ exerciseId, ` +
      'defaultSets?, restAfterSeconds?, notes? }] }`, 1 to 30, appended in ' +
      'order with their empty sets. They have no program row (ADDED).',
    auth: true,
    responses: [
      { status: 201, description: 'Exercises added' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      { status: 409, description: 'The day cannot change' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  removeExercise: {
    summary: "Remove an exercise from a day of a client's copy",
    description:
      `${WHO} ${EDITABLE} Its sets go with it; a superset left with one ` +
      'exercise is undone.',
    auth: true,
    responses: [
      ApiStandardResponses.NoContent,
      ApiStandardResponses.NotFound,
      { status: 409, description: 'The day cannot change' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  reorder: {
    summary: "Reorder the exercises of a day of a client's copy (atomic)",
    description:
      `${WHO} ${EDITABLE} Body \`{ items: [{ id, orderIndex }] }\`. Rows ` +
      'left out keep their place; two rows on one place is refused (409 ' +
      '`workout.reorderPositionClash`). Returns the exercises in order.',
    auth: true,
    responses: [
      { status: 200, description: 'Exercises reordered' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      { status: 409, description: 'The day cannot change' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  revert: {
    summary: "Put an exercise of a client's copy back to the program's values",
    description:
      `${WHO} ${EDITABLE} The movement, note and sets of its program row ` +
      "as the program is now: linked sets take their program set's " +
      'targets and planned rest, missing ones are created, sets added for ' +
      'the client are removed, and the mark is cleared. 409 ' +
      '`workout.copyCannotRevert` for an exercise added here or whose ' +
      'program row is gone.',
    auth: true,
    responses: [
      { status: 201, description: 'Exercise reverted' },
      ApiStandardResponses.NotFound,
      {
        status: 409,
        description: 'Nothing to go back to, or the day cannot change',
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  moveDay: {
    summary: "Move a day of a client's copy to another date",
    description:
      `${WHO} ${EDITABLE} Body \`{ date: "YYYY-MM-DD" }\`. Never into the ` +
      "past (400 `workout.copyDatePast`), inside the plan's start and end " +
      'dates (400 `workout.copyDateOutsidePlan`), and only to a date no ' +
      'other day of the plan holds (409 `workout.copyDateTaken`). Its week ' +
      'and day slot follow the date.',
    auth: true,
    responses: [
      { status: 200, description: 'Day moved', example: daySummaryExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      { status: 409, description: 'Date taken, or the day cannot change' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  done: {
    summary: "Done editing a client's copy: tell the client once",
    description:
      `${WHO} Sends one PLAN_ADJUSTED notification ("{coach} adjusted ` +
      'your plan · Push A, week 3") about the days changed since the last ' +
      'one, after the commit, and remembers that it did. Nothing changed, ' +
      'nothing sent: calling it again is harmless. Returns ' +
      '`{ notified, days }`.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Done',
        example: { notified: true, days: 1 },
      },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
