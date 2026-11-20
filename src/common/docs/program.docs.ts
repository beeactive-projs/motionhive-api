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

/** The counts `GET /programs` rows and `GET /programs/:id` carry. */
const programCountsExample = {
  exerciseCount: 12,
  daysPerWeek: 3,
  clientCount: 2,
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
      '(paginated). Filters: `search` (name iLIKE), `status`, and ' +
      '`archived`: `exclude` leaves ARCHIVED out (the list a routine is ' +
      'started from), `only` lists ARCHIVED alone (to restore one, with ' +
      'PATCH `status: DRAFT`); omitted keeps every status. Ordered by ' +
      '`updatedAt DESC` so recently-edited programs surface first. Each ' +
      'row carries `defaultRestSeconds` (rest between sets, or null) and ' +
      'three counts instead of the tree: `exerciseCount` (prescribed ' +
      'exercises across its days), `daysPerWeek` (distinct weekdays its ' +
      'days sit on, the number the assign sheet asks for) and ' +
      '`clientCount` (distinct clients of the caller with a PENDING, ' +
      'ACTIVE or PAUSED assignment of it; own schedules never count).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Programs returned',
        example: {
          items: [{ ...programExample, ...programCountsExample }],
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
      'Returns the program with all nested workouts, exercises, and sets, ' +
      'plus the counts a list row carries (`exerciseCount`, `daysPerWeek`, ' +
      '`clientCount`), so the builder can say how many clients already ' +
      'follow it. 404 on cross-instructor access — hides existence.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Program returned',
        example: {
          ...programExample,
          ...programCountsExample,
          workouts: [workoutExample],
        },
      },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  create: {
    summary: 'Create a new program',
    description:
      'INSTRUCTOR only. Authors a new program shell. Status defaults to ' +
      'DRAFT; flip to PUBLISHED before assigning to clients. Created as ' +
      'PUBLISHED only with a name that is not the untitled default and, ' +
      'for a routine, at least one exercise (a multi-week program has no ' +
      'days yet): 400 `workout.cannotPublishWithoutName` / ' +
      '`workout.cannotPublishWithoutExercises` otherwise.',
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
      'Owner only. PATCH semantics: any subset of fields, including ' +
      '`defaultRestSeconds` (0 to 600, null clears it) and `status` ' +
      '(ARCHIVED archives a routine or program, DRAFT restores it). Does ' +
      'NOT propagate to existing assignments (copy-on-assign tree is ' +
      'independent per locked decision §10). A routine `exercises` tree ' +
      'with a superset group of one exercise is saved unlinked. Moving to ' +
      '`status: PUBLISHED` needs a name that is not the untitled default ' +
      '("Untitled program" / "Program fără titlu") and at least one day ' +
      'with an exercise, judged on the program as the request leaves it: ' +
      '400 `workout.cannotPublishWithoutName` / ' +
      '`workout.cannotPublishWithoutExercises` otherwise, with nothing ' +
      'else in the request saved. A program already published is not ' +
      're-checked. A shorter `durationDays` removes the days past the new ' +
      'end, also while clients follow the program: they keep their copy.',
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
    summary: 'Copy one week of a program onto other weeks (atomic)',
    description:
      'Owner only. Copies every workout in `fromWeekIndex` — with its ' +
      'exercises and prescribed sets — into every week of `toWeekIndexes` ' +
      '(or the single `toWeekIndex` older apps send; one of the two is ' +
      'required, the list wins) in ONE transaction. Anything already in a ' +
      'target week is removed first, so repeating a copy replaces rather ' +
      'than duplicates. A week listed twice is copied once and the source ' +
      'week is left out: 400 `workout.copyWeekSameWeek` when no other week ' +
      'is left, 400 `workout.weekEmpty` when the source week has no days. ' +
      'Exists so a client never walks the tree, or the target weeks, with ' +
      'one request each, which was both slow and not atomic. Clients ' +
      'following the program keep their own copy.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Week copied; the new workouts, target by target',
        example: [workoutExample],
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
  copyDay: {
    summary:
      "Copy one day's training into the same day of other weeks (atomic)",
    description:
      'INSTRUCTOR only. Copies the workout at `fromWeekIndex`/`dayIndex` — ' +
      'with its exercises and prescribed sets — into that same day slot in ' +
      'every week listed in `toWeekIndexes`, in ONE transaction. Whatever ' +
      'occupies a target slot is removed first, matching `copy-week`, so a ' +
      'repeated copy replaces rather than duplicates. The day slot never ' +
      'moves: copying Monday onto a Thursday reorders the week and is a ' +
      'different operation.',
  },
  repeatWeeks: {
    summary: 'Repeat the built weeks into the empty weeks after them (atomic)',
    description:
      'INSTRUCTOR only. Takes every week up to the last one holding work as ' +
      'a block and cycles it through the remaining weeks of the declared ' +
      'length, in ONE transaction. Only weeks past the block are written, so ' +
      'nothing is replaced and a repeat call is a no-op. Returns the program ' +
      'with its full tree. 400 when the program has no length or no work.',
  },
  deleteWeek: {
    summary: 'Delete one week and move the later weeks up (atomic)',
    description:
      'Owner only. Removes every workout in `weekIndex` (0-based), shifts ' +
      'each later week up by one, and shortens a declared length by one ' +
      'week, in ONE transaction. Returns the program with its full tree ' +
      'and counts (as `GET /programs/:id`). Allowed while clients follow ' +
      'the program: each keeps their own assigned copy unchanged. 400 ' +
      '`workout.programNeedsOneWeek` for the only remaining week, 400 ' +
      '`workout.routineNoWeeksToDelete` on a routine, 404 ' +
      '`workout.weekNotFound` past the last week. A MotionHive starter is ' +
      "nobody's to change: 404 `workout.programNotFound`.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Week deleted; the program as it is now',
        example: {
          ...programExample,
          ...programCountsExample,
          workouts: [workoutExample],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  insertWeekAfter: {
    summary: 'Add an empty week after one week (atomic)',
    description:
      'Owner only. Moves every week after `weekIndex` (0-based) down by ' +
      'one, leaving an empty week right after it, and grows the program by ' +
      'one week (`durationDays` becomes its whole weeks plus one, times 7), ' +
      'in ONE transaction. No body. Returns ' +
      'the program with its full tree and counts. Clients following it ' +
      'keep their own copy. 400 `workout.programTooLong` past 104 weeks, ' +
      '400 `workout.routineNoWeeksToAdd` on a routine, 404 ' +
      '`workout.weekNotFound` past the last week, 404 ' +
      '`workout.programNotFound` for a starter or a program not yours.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Week added; the program as it is now',
        example: {
          ...programExample,
          ...programCountsExample,
          durationDays: 63,
          workouts: [workoutExample],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  clearWeek: {
    summary: 'Clear one week, so it becomes rest (atomic)',
    description:
      'Owner only. Removes every workout of `weekIndex` (0-based) with its ' +
      'exercises and sets, in ONE transaction, so the week is all rest ' +
      'days. The weeks keep their places and the program its length. No ' +
      'body. Returns the program with its full tree and counts; an empty ' +
      'week changes nothing. Clients following it keep their own copy. ' +
      '400 `workout.routineNoWeeksToClear` on a routine, 404 ' +
      '`workout.weekNotFound` past the last week, 404 ' +
      '`workout.programNotFound` for a starter or a program not yours.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Week cleared; the program as it is now',
        example: {
          ...programExample,
          ...programCountsExample,
          workouts: [],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
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
      'Owner only. Moving a workout to a (week, day) already occupied ' +
      'by another workout returns 409. `defaultRestSeconds` (0 to 600, ' +
      "null clears it) is the day's rest, between a set's own and the " +
      "program's default; assigning the program writes it into the " +
      'assigned sets that have no rest.',
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
      '`defaultSets` to create that many empty sets with it atomically, ' +
      'and `restAfterSeconds` to give them that rest.',
    auth: true,
    responses: [
      { status: 201, description: 'Exercise slot added' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  addExercises: {
    summary: 'Add several exercises to a workout at once (atomic)',
    description:
      'Owner only. Body `{ exercises: [{ exerciseId, defaultSets?, ' +
      'restAfterSeconds?, notes? }] }`, 1 to 30 items. Appends them after ' +
      'the exercises the day already holds, in the order sent, each with ' +
      '`defaultSets` empty sets resting `restAfterSeconds`, in ONE ' +
      'transaction. Every `exerciseId` must be readable by the caller ' +
      '(SYSTEM, their own, or PUBLIC by another): one that is not answers ' +
      '404 `exercise.notFound` and nothing is added. Returns the new ' +
      'exercise rows in order. Exists so the picker never adds its ' +
      'choices with one request each.',
    auth: true,
    responses: [
      { status: 201, description: 'Exercises added' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setSets: {
    summary: 'Set every set of one exercise, in place (atomic)',
    description:
      'Owner only. Body `{ sets: [{ id?, setType?, targetRepsMin?, ' +
      'targetRepsMax?, targetWeightKg?, targetWeightPercent1rm?, ' +
      'targetDurationSeconds?, targetDistanceMeters?, targetRpe?, ' +
      'targetRir?, restAfterSeconds?, tempo?, notes? }] }`, 1 to 30 sets, ' +
      'each its whole target (a field left out or null is cleared) and its ' +
      'place in the list its order. A set sent with its `id` is updated in ' +
      'place, one without is added, and a set of the exercise left out is ' +
      'removed, all in ONE transaction. Rows are kept rather than ' +
      'rewritten because assigned copies and logged sets link back to them ' +
      'by id. Returns the sets in order. 400 `workout.setListDuplicate` ' +
      'for an id sent twice, `workout.repRangeInvalid` / ' +
      '`workout.weightModeConflict` for an incoherent set; 404 ' +
      '`workout.setNotFound` for an id that is not a set of this exercise ' +
      '(nothing changes).',
    auth: true,
    responses: [
      { status: 200, description: 'Sets saved', example: [setExample] },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  setSupersets: {
    summary: 'Link or unlink exercises of a program day as supersets',
    description:
      'Owner only. Send every exercise of the day whose `supersetGroupId` ' +
      'changed: neighbours sharing a value are one superset, null takes an ' +
      'exercise out of any. Saved in one transaction, all or nothing: if ' +
      'any id is not an exercise of this day, nothing changes and the ' +
      'answer is 404. A superset left with one exercise is undone in the ' +
      'same transaction. At most 100 exercises, no repeats.',
    auth: true,
    responses: [
      { status: 204, description: 'Saved' },
      { status: 400, description: 'Invalid body' },
      {
        status: 404,
        description:
          'No such program or day, or not yours (`workout.programNotFound`, `workout.workoutNotFound`), or an exercise not in it (`exercise.notFound`)',
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateExercise: {
    summary: 'Update an exercise slot',
    description:
      'Owner only. `restAfterSeconds` (0 to 600, or null) is written to ' +
      'every set of the exercise in one transaction: exercise-level rest ' +
      'has no column of its own. `supersetGroupId` links it into a ' +
      'superset (the same number on two or three exercises of the day); ' +
      'null unlinks it, and a superset left with one exercise is ' +
      'dissolved in the same transaction.',
    auth: true,
    responses: [
      { status: 200, description: 'Updated' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  removeExercise: {
    summary: 'Remove an exercise slot',
    description:
      'Owner only. Removing one exercise of a pair unlinks the other, in ' +
      'the same transaction.',
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
