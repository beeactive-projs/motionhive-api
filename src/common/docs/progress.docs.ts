/**
 * Swagger doc objects for the progress controllers (trainee, roster and
 * a coach's view of one client). Same shape as the
 * rest of `common/docs/*.docs.ts`: each entry is an
 * `ApiEndpointOptions` passed to `@ApiEndpoint(docs.x)` on the route.
 */
export const ProgressDocs = {
  overview: {
    summary: 'My training progress',
    description:
      'Derived summary for the signed-in user: workouts, volume, streak, ' +
      'weekly trend, daily activity and personal records. Volume counts ' +
      'only completed sets carrying a load, so bodyweight and cardio do ' +
      'not inflate it. Streaks and records ignore the range window.',
    auth: true,
    responses: [{ status: 200, description: 'Progress overview' }],
  },

  roster: {
    summary: "My clients' adherence",
    description:
      'Roster-level view for a coach: who is on track and who is ' +
      'slipping, without opening each client. A read-model over assigned ' +
      'workout statuses and logs — nothing is captured specially for it. ' +
      'Scoped to ACTIVE coaching relationships only. Clients needing ' +
      'attention sort first, each with a single reason.',
    auth: true,
    responses: [{ status: 200, description: 'Roster adherence summary' }],
  },

  activity: {
    summary: "My clients' latest workouts",
    description:
      "The coach Home's activity feed: finished workouts across every " +
      'ACTIVE client from the last two weeks, newest first, each with the ' +
      'records it set. Only workouts the coach may read: from their own ' +
      'plans, or shared with coaches by the client.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Recent client workouts',
        example: [
          {
            workoutLogId: '5b0c2a9e-1f3d-4c8e-9a71-2d6f0e4b8c13',
            clientId: '329c9c83-9d0d-4ee5-8192-e6d46c803f69',
            name: 'Anna Popescu',
            avatarUrl: null,
            handle: 'anna',
            workoutName: 'Push day',
            completedAt: '2026-10-30T18:42:00.000Z',
            durationSeconds: 3120,
            recordCount: 1,
          },
        ],
      },
    ],
  },

  trainedExercises: {
    summary: 'Every exercise I have trained',
    description:
      'One row per exercise with at least one completed set, most ' +
      "recently trained first: its name in the reader's language, kind, " +
      'how many sessions, and the top set of its latest 6 sessions ' +
      '(newest first) for a trend. Capped at 200 exercises.',
    auth: true,
    responses: [{ status: 200, description: 'Trained exercises' }],
  },

  clientTrainedExercises: {
    summary: 'Every exercise a client has trained',
    description:
      "Same shape as GET /progress/exercises, read by the client's " +
      'coach and scoped like the coach overview: only workouts the coach ' +
      'may see.',
    auth: true,
    responses: [
      { status: 200, description: 'Trained exercises' },
      { status: 404, description: 'Not an active client of the caller' },
    ],
  },

  exerciseHistory: {
    summary: 'My history for one exercise',
    description:
      'Estimated 1RM series (oldest first) plus every completed session ' +
      'of this exercise with its top set, newest first. Capped at 100 ' +
      'sessions.',
    auth: true,
    responses: [
      { status: 200, description: 'Per-exercise history' },
      { status: 404, description: 'Exercise not found' },
    ],
  },

  clientOverview: {
    summary: "A client's training progress",
    description:
      "The client's Progress overview, read by their coach. Same shape as " +
      "GET /progress/overview. 404 unless the caller is the client's " +
      'ACTIVE coach. Unless the client shares off-plan training with ' +
      'this coach, every figure covers only workouts logged against this ' +
      "coach's own plans: freestyle sessions and other coaches' plans " +
      'are left out, and records are rebuilt from those workouts instead ' +
      'of the stored 1RM history (manual entries stay private).',
    auth: true,
    responses: [
      { status: 200, description: 'Progress overview' },
      { status: 404, description: 'Not an active client of the caller' },
    ],
  },

  clientExerciseHistory: {
    summary: "A client's history for one exercise",
    description:
      'Same shape as GET /progress/exercises/:exerciseId, read by the ' +
      "client's coach and scoped like the coach overview: sessions and " +
      'the 1RM series come only from workouts the coach may see, unless ' +
      'the client shares off-plan training.',
    auth: true,
    responses: [
      { status: 200, description: 'Per-exercise history' },
      {
        status: 404,
        description:
          'Not an active client of the caller, or exercise not found',
      },
    ],
  },
};
