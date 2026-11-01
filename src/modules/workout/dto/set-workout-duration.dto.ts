import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The longest a workout can last. Measured past this, a duration is a
 * clock left running and is stored as unknown (null); a correction can't
 * go past it either, so the two rules agree.
 */
export const MAX_WORKOUT_SECONDS = 6 * 60 * 60;

/** The shortest correction: a minute, the step the app's wheels move in. */
export const MIN_WORKOUT_SECONDS = 60;

/** Body for `PATCH /workout-logs/:id/duration`. */
export class SetWorkoutDurationDto {
  @ApiProperty({
    example: 4320,
    minimum: MIN_WORKOUT_SECONDS,
    maximum: MAX_WORKOUT_SECONDS,
    description:
      'How long the finished workout really took, in seconds: a minute to six hours.',
  })
  @IsInt()
  @Min(MIN_WORKOUT_SECONDS)
  @Max(MAX_WORKOUT_SECONDS)
  durationSeconds!: number;
}
