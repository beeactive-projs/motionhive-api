import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Body for `POST /programs/:id/workouts/copy-week`.
 *
 * Exists so copying a week is one request rather than one per workout, per
 * exercise, per set — a client walking the tree itself made ~36 calls for a
 * modest week and tripped the global throttle on the second copy.
 */
export class CopyProgramWeekDto {
  /** 0-based week to copy from. */
  @ApiProperty({ example: 0, minimum: 0, maximum: 103 })
  @IsInt()
  @Min(0)
  @Max(103)
  fromWeekIndex: number;

  /** 0-based week to copy into. Anything already there is replaced. */
  @ApiProperty({ example: 1, minimum: 0, maximum: 103 })
  @IsInt()
  @Min(0)
  @Max(103)
  toWeekIndex: number;
}
