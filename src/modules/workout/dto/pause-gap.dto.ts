import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/** The shortest gap worth pausing for: a minute. */
export const MIN_PAUSE_GAP_SECONDS = 60;

/**
 * The longest: a day. An open workout untouched for a day is closed by
 * the nightly sweep, so no running workout can be away longer.
 */
export const MAX_PAUSE_GAP_SECONDS = 24 * 60 * 60;

/**
 * `POST /workout-logs/:id/pause-gap`: "You were away 25 min. Pause the
 * workout for that time?" The time away, added to the paused time after
 * the fact. Never more than the workout has been running (the service
 * checks that against the clock).
 */
export class PauseGapDto {
  @ApiProperty({
    example: 1500,
    minimum: MIN_PAUSE_GAP_SECONDS,
    maximum: MAX_PAUSE_GAP_SECONDS,
    description:
      'Seconds away: at least 60, and at most the active time so far.',
  })
  @IsInt()
  @Min(MIN_PAUSE_GAP_SECONDS)
  @Max(MAX_PAUSE_GAP_SECONDS)
  seconds!: number;
}
