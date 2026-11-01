import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

/** Workout logs (`/workout-logs/...`), the owner's own routes. */
export const WorkoutLogDocs = {
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
