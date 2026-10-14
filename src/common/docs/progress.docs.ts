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
