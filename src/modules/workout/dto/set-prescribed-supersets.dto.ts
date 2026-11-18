import { SetLogSupersetsDto } from './set-log-supersets.dto';

/**
 * `PATCH /programs/:id/workouts/:workoutId/supersets`: linking or unlinking
 * exercises of a program day as supersets. The app works out the new
 * groups (`normalizeSupersets` renumbers every group, so one tap can change
 * many rows) and sends every exercise whose group changed; they are saved
 * in one transaction, never as one request per row racing each other. The
 * same shape as the logger's (`SetLogSupersetsDto`).
 */
export class SetPrescribedSupersetsDto extends SetLogSupersetsDto {}
