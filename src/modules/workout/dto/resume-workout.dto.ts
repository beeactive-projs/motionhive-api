import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';

/**
 * `POST /workout-logs/:id/resume`: the clock starts again. Usually now;
 * `at` when the person tapped Continue on the lock screen and the app
 * saves it later.
 */
export class ResumeWorkoutDto {
  @ApiPropertyOptional({
    example: '2026-11-07T17:42:10.000Z',
    description:
      'When the pause ended, if not now. Held between the start of the ' +
      'pause and now.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  at?: string;
}
