import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

const programExample = {
  id: 'a1b2c3d4-0000-1111-2222-3333abcd4444',
  ownerId: '5c1a8b9d-2e3f-4a01-9b8c-7d6e5f4a3b2c',
  name: 'Strength foundations — 8 weeks',
  description: 'Beginner barbell program, 3 days/week, full-body, linear.',
  kind: 'WORKOUT',
  status: 'DRAFT',
  durationDays: 56,
  periodizationModel: 'linear',
  coverImageUrl: null,
  goalTags: ['strength', 'beginner'],
  createdAt: '2026-06-02T12:00:00.000Z',
  updatedAt: '2026-06-02T12:00:00.000Z',
  deletedAt: null,
};

const workoutExample = {
  id: 'b2c3d4e5-1111-2222-3333-4444bcde5555',
  programId: programExample.id,
  name: 'Day 1 — Upper',
  notes: null,
  weekIndex: 0,
  dayIndex: 0,
  sequenceNumber: 0,
  phase: 'accumulation',
  estimatedDurationMinutes: 60,
};

const setExample = {
  id: 'd4e5f6a7-3333-4444-5555-6666defa7777',
  prescribedExerciseId: 'c3d4e5f6-2222-3333-4444-5555cdef6666',
  orderIndex: 0,
  setType: 'NORMAL',
  targetRepsMin: 5,
  targetRepsMax: 5,
  targetWeightKg: 80,
  targetWeightPercent1rm: null,
  targetRpe: 8,
  restAfterSeconds: 120,
  tempo: '3-1-1-0',
  notes: null,
};

export const ProgramDocs = {
  duplicate: {
    summary: 'Copy a routine into my library',
    description:
      "Deep-copies a program and its whole tree into the caller's library, " +
      'stamped `source: USER` and `status: DRAFT`. This is how a MotionHive ' +
      'starter routine gets customised: starters are owned by nobody, so ' +
      'they cannot be edited in place without changing them for everyone. ' +
      'Readable sources are your own programs and system starters; anything ' +
      'else 404s.',
    auth: true,
    responses: [
      { status: 201, description: 'Copy created' },
      { status: 404, description: 'Not yours and not a starter' },
    ],
  } as ApiEndpointOptions,

  list: {
    summary: 'List the instructor’s programs',
    description:
      'Owner-scoped. Returns the authenticated instructor’s programs ' +
      '(paginated). Filters: `search` (name iLIKE), `status`. Ordered by ' +
      '`updatedAt DESC` so recently-edited programs surface first.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Programs returned',
        example: {
          items: [programExample],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  get: {
    summary: 'Get one program (full tree)',
    description:
      'Returns the program with all nested workouts, exercises, and sets. ' +
      '404 on cross-instructor access — hides existence.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Program returned',
        example: { ...programExample, workouts: [workoutExample] },
      },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  create: {
    summary: 'Create a new program',
    description:
      'INSTRUCTOR only. Authors a new program shell. Status defaults to ' +
      'DRAFT; flip to PUBLISHED before assigning to clients.',
    auth: true,
    responses: [
      { status: 201, description: 'Program created', example: programExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Update a program',
    description:
      'INSTRUCTOR only, owner only. PATCH semantics — any subset of fields. ' +
      'Does NOT propagate to existing assignments (copy-on-assign tree is ' +
      'independent per locked decision §10).',
    auth: true,
    responses: [
      { status: 200, description: 'Program updated', example: programExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  remove: {
    summary: 'Soft-delete a program',
    description:
      'INSTRUCTOR only, owner only. Marks the program deleted (paranoid). ' +
      'Existing assignments are independent copies and remain unaffected.',
    auth: true,
    responses: [
      { status: 204, description: 'Program deleted' },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  addWorkout: {
    summary: 'Add a workout (day) to a program',
    description:
      'INSTRUCTOR only. (weekIndex, dayIndex) must be unique within the ' +
      'program (409 otherwise). `sequenceNumber` is computed by the service ' +
      '(append-to-end).',
    auth: true,
    responses: [
      { status: 201, description: 'Workout added', example: workoutExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  reorderExercises: {
    summary: 'Reorder the exercises of a workout (atomic)',
    description:
      'INSTRUCTOR only. Applies every new `orderIndex` in ONE transaction. ' +
      'Rows omitted from `items` keep their index; the combined layout must ' +
      'not place two rows at the same index (409 otherwise).',
    auth: true,
    roles: ['INSTRUCTOR'],
  },
  reorderSets: {
    summary: 'Reorder the sets of a prescribed exercise (atomic)',
    description:
      'INSTRUCTOR only. Same contract as reorderExercises, for the sets ' +
      'under one exercise.',
    auth: true,
    roles: ['INSTRUCTOR'],
  },
  copyWeek: {
    summary: 'Copy one week of a program onto another (atomic)',
    description:
      'INSTRUCTOR only. Copies every workout in `fromWeekIndex` — with its ' +
      'exercises and prescribed sets — into `toWeekIndex` in ONE ' +
      'transaction. Anything already in the target week is removed first, ' +
      'so repeating a copy replaces rather than duplicates. Exists so a ' +
      'client never has to walk the tree with one request per row, which ' +
      'was both slow and not atomic.',
  },
  reorderWorkouts: {
    summary: 'Reposition workouts on the program calendar (atomic)',
    description:
      'INSTRUCTOR only. Applies every (weekIndex, dayIndex) move in ONE ' +
      'transaction — unlike sequential PATCHes, intermediate collisions with ' +
      'the unique position index cannot strand the program half-moved. ' +
      'Workouts omitted from `items` keep their current slot. The combined ' +
      'target layout must be collision-free (409 otherwise). ' +
      '`sequenceNumber` is recomputed to calendar order (week, then day) ' +
      'across the whole program. Returns all workouts in the new order.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Workouts repositioned',
        example: [workoutExample],
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateWorkout: {
    summary: 'Update a workout',
    description:
      'INSTRUCTOR only. Moving a workout to a (week, day) already occupied ' +
      'by another workout returns 409.',
    auth: true,
    responses: [
      { status: 200, description: 'Workout updated', example: workoutExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  removeWorkout: {
    summary: 'Remove a workout',
    description:
      'INSTRUCTOR only. Cascades to nested exercises + sets. Does NOT ' +
      'affect already-assigned copies (copy-on-assign).',
    auth: true,
    responses: [
      { status: 204, description: 'Workout removed' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  addExercise: {
    summary: 'Add an exercise slot to a workout',
    description:
      'INSTRUCTOR only. `exerciseId` must reference an exercise the ' +
      'caller can read (SYSTEM, their own, or PUBLIC by another). ' +
      'Hides existence (404) for PRIVATE-by-another rows. Pass ' +
      '`defaultSets` to create that many empty sets with it atomically.',
    auth: true,
    responses: [
      { status: 201, description: 'Exercise slot added' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateExercise: {
    summary: 'Update an exercise slot',
    auth: true,
    responses: [
      { status: 200, description: 'Updated' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  removeExercise: {
    summary: 'Remove an exercise slot',
    auth: true,
    responses: [
      { status: 204, description: 'Removed' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  addSet: {
    summary: 'Add a set to an exercise slot',
    description:
      'INSTRUCTOR only. Pick EITHER `targetWeightKg` OR ' +
      '`targetWeightPercent1rm` (400 if both). `targetRepsMin` must not ' +
      'exceed `targetRepsMax`. The service auto-appends `orderIndex` if ' +
      'omitted.',
    auth: true,
    responses: [
      { status: 201, description: 'Set added', example: setExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateSet: {
    summary: 'Update a set',
    auth: true,
    responses: [
      { status: 200, description: 'Set updated', example: setExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  removeSet: {
    summary: 'Remove a set',
    auth: true,
    responses: [
      { status: 204, description: 'Set removed' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
