import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ProgramRepeatMode } from '../entities/workout.enums';

/**
 * Body for `POST /my/scheduled-routines`.
 *
 * The light answer to multi-week planning for someone without a coach:
 * pick a routine, pick the weekdays, decide whether it runs 12 weeks or
 * for a fixed block. No periodisation builder — that stays a coach's
 * job, which is most of why you'd hire one.
 */
export class ScheduleRoutineDto {
  @ApiProperty({ format: 'uuid', description: 'Routine to schedule.' })
  @IsUUID('4')
  programId!: string;

  /**
   * ISO 8601 weekdays: 1 = Monday through 7 = Sunday. Matches the
   * sessions recurrence engine — never 0 = Sunday.
   */
  @ApiProperty({ example: [1, 3, 5], description: '1 = Mon … 7 = Sun.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek!: number[];

  @ApiPropertyOptional({
    enum: ProgramRepeatMode,
    default: ProgramRepeatMode.Weekly,
    description:
      'WEEKLY runs 12 weeks; BLOCK runs for repeatWeeks; then it completes.',
  })
  @IsOptional()
  @IsEnum(ProgramRepeatMode)
  repeatMode?: ProgramRepeatMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 104 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(104)
  repeatWeeks?: number;

  @ApiPropertyOptional({
    example: '2026-08-10',
    description: "Defaults to today, in the caller's calendar.",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  startDate?: string;
}
