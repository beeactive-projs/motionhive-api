import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

const muscleExample = {
  id: 'b3e1a9f2-7d4c-4a05-9d61-2c8b5e0f1a3d',
  slug: 'quadriceps',
  commonName: 'Quadriceps',
  latinName: 'Quadriceps femoris',
  bodyRegion: 'lower',
  displayOrder: 12,
};

const equipmentExample = {
  id: '7e5a8b1c-2d9f-4a36-9e0b-1d2c3f4a5b6e',
  slug: 'barbell',
  name: 'Barbell',
  displayOrder: 1,
};

const exerciseExample = {
  id: 'aa11cc22-dd33-44ee-bb55-ff66aa77bb88',
  name: 'Tempo goblet squat',
  slug: 'tempo-goblet-squat',
  description: 'A controlled-tempo squat with a kettlebell held at the chest.',
  instructions:
    'Stand tall, hold the kettlebell at the chest. 3-second descent, 1-second pause at the bottom, 1-second ascent.',
  kind: 'STRENGTH',
  level: 'BEGINNER',
  movementPattern: 'SQUAT',
  mechanic: 'COMPOUND',
  force: 'PUSH',
  metValue: null,
  source: 'INSTRUCTOR',
  ownerId: '5c1a8b9d-2e3f-4a01-9b8c-7d6e5f4a3b2c',
  visibility: 'PRIVATE',
  forkedFromId: null,
  sourceProvider: null,
  sourceExternalId: null,
  mediaKind: 'YOUTUBE',
  thumbnailUrl: null,
  youtubeUrl: 'https://www.youtube.com/watch?v=aclHkVaku9U',
  trackingFields: null,
  isUnilateral: false,
  forkCount: 0,
  fitCategory: null,
  fitSubcategory: null,
  hkActivityType: null,
  createdAt: '2026-06-02T12:00:00.000Z',
  updatedAt: '2026-06-02T12:00:00.000Z',
  deletedAt: null,
  owner: {
    id: '5c1a8b9d-2e3f-4a01-9b8c-7d6e5f4a3b2c',
    firstName: 'Diana',
    lastName: 'Marin',
    avatarUrl: 'https://img.motionhive.fit/motionhive/production/.../diana.jpg',
    handle: 'diana-marin',
  },
  forkedFrom: null,
  media: [],
  muscleRoles: [
    {
      exerciseId: 'aa11cc22-dd33-44ee-bb55-ff66aa77bb88',
      muscleId: 'b3e1a9f2-7d4c-4a05-9d61-2c8b5e0f1a3d',
      role: 'PRIMARY',
      muscle: muscleExample,
    },
  ],
  equipment: [equipmentExample],
};

const listExample = {
  items: [exerciseExample],
  total: 872,
  page: 1,
  pageSize: 20,
  facets: {
    kind: { STRENGTH: 410, CARDIO: 88, BODYWEIGHT: 132, MOBILITY: 96 },
    primaryMuscleId: {
      'b3e1a9f2-7d4c-4a05-9d61-2c8b5e0f1a3d': 71,
    },
    equipmentId: {
      '7e5a8b1c-2d9f-4a36-9e0b-1d2c3f4a5b6e': 180,
    },
    level: { BEGINNER: 220, INTERMEDIATE: 410, ADVANCED: 242 },
  },
};

export const ExerciseDocs = {
  list: {
    summary: 'List exercises (catalog browse)',
    description:
      'Paginated catalog list. Everyone sees SYSTEM + their own + ' +
      'public-from-others by default (filter via `ownership`: `all`, ' +
      '`system`, `mine`, `public-others`). `mine` works for every role: ' +
      'a person who is not a coach owns the exercises they created ' +
      '(source USER, always PRIVATE). Pass `withFacets=true` to receive ' +
      'aggregate counts per (kind, primaryMuscleId, equipmentId, level).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Exercises returned',
        example: listExample,
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  get: {
    summary: 'Get one exercise by id',
    description:
      'Detail view shared by instructor and client. SYSTEM and PUBLIC ' +
      'exercises are visible to everyone; PRIVATE exercises are visible ' +
      'only to their owner (others get 404 — existence is not leaked).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Exercise returned',
        example: exerciseExample,
      },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  create: {
    summary: 'Create a custom exercise',
    description:
      'INSTRUCTOR or USER. A coach authors source=INSTRUCTOR, ' +
      'owner=caller; visibility defaults to PRIVATE, PUBLIC makes it ' +
      'forkable by other instructors, and at least one PRIMARY muscle is ' +
      'required. Anyone else authors source=USER, owner=caller, always ' +
      'PRIVATE (a `visibility` sent is ignored), and `muscles` is ' +
      "optional (the form's muscle chips). PRIMARY rows are capped at 3.",
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Exercise created',
        example: exerciseExample,
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Update a custom exercise',
    description:
      'INSTRUCTOR or USER, owner only. Pass any subset of the create ' +
      'body. A source=USER exercise stays PRIVATE whatever is sent. ' +
      'Flipping visibility from PUBLIC to PRIVATE does NOT break existing ' +
      'program references — soft-unpublish is the locked semantic ' +
      '(decision §16). Hard delete is blocked when references exist; ' +
      'soft-delete (paranoid) always works.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Exercise updated',
        example: exerciseExample,
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  remove: {
    summary: 'Soft-delete a custom exercise',
    description:
      'INSTRUCTOR or USER, owner only. Marks the row deleted; existing ' +
      'program references and logged workouts keep resolving (paranoid ' +
      "mode), so its history stays. If this was a fork, the source row's " +
      '`forkCount` is decremented.',
    auth: true,
    responses: [
      { status: 204, description: 'Exercise deleted' },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  setImage: {
    summary: "Set a custom exercise's picture",
    description:
      'INSTRUCTOR or USER, owner only (not catalog rows). One image under the ' +
      '`file` form field, at most 5 MB, image types only. Stored as a public ' +
      "public image in the owner's folder and returned as `thumbnailUrl` " +
      'on the exercise. A picture it replaces stays stored, since workouts ' +
      'logged with it keep its link.',
    auth: true,
    responses: [
      { status: 200, description: 'The exercise, with its new picture' },
      { status: 400, description: 'No file, wrong type, or too large' },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  removeImage: {
    summary: "Remove a custom exercise's picture",
    description:
      'INSTRUCTOR or USER, owner only. Sets `thumbnailUrl` to null; the apps ' +
      "show the exercise's kind tile instead.",
    auth: true,
    responses: [
      { status: 200, description: 'The exercise, without a picture' },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getNote: {
    summary: 'My private note on an exercise',
    description:
      'The caller\'s own note on this exercise ("seat on 4"), or `note: ' +
      'null`. Private: never shown to a coach. The exercise must be one ' +
      'the caller can see (SYSTEM, PUBLIC, their own, or one that reached ' +
      "them through a coach's plan or a workout they logged); else 404.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'The note, or null',
        example: {
          exerciseId: 'b3e1a9f2-7d4c-4a05-9d61-2c8b5e0f1a3d',
          note: 'Seat on 4, elbows in.',
          updatedAt: '2026-11-02T09:30:00.000Z',
        },
      },
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  putNote: {
    summary: 'Write my private note on an exercise',
    description:
      'Body `{ note }`, trimmed, up to 280 characters ' +
      '(`errors.validation.exerciseNoteTooLong`). Empty, blank or null ' +
      'deletes the note. Answers in the same shape as the GET, with the ' +
      'same visibility rule.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Saved, or deleted (`note: null`)',
        example: {
          exerciseId: 'b3e1a9f2-7d4c-4a05-9d61-2c8b5e0f1a3d',
          note: 'Seat on 4, elbows in.',
          updatedAt: '2026-11-02T09:30:00.000Z',
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  fork: {
    summary: 'Fork a public exercise into my library',
    description:
      'INSTRUCTOR only. Clones a PUBLIC exercise to a new PRIVATE row ' +
      'owned by the caller, deep-copies muscle and equipment rows, and ' +
      "increments the source's `forkCount`. The source author receives " +
      'an EXERCISE_FORKED notification. Cannot fork your own exercises ' +
      '(use Duplicate instead — V2).',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Fork created',
        example: { ...exerciseExample, forkedFromId: exerciseExample.id },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  listMuscles: {
    summary: 'List muscle taxonomy',
    description:
      'Reference data for the catalog filter rail and create-exercise ' +
      'muscle picker. Sorted by `displayOrder`. Open to any authenticated ' +
      'role — labels and slugs only.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Muscle list returned',
        example: [muscleExample],
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  listEquipment: {
    summary: 'List equipment taxonomy',
    description:
      'Reference data for the catalog filter rail and create-exercise ' +
      'equipment picker. Sorted by `displayOrder`.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Equipment list returned',
        example: [equipmentExample],
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
