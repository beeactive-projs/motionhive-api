import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Body for `PATCH /program-assignments/:id/copy/days/:dayId/exercises/:exerciseId`:
 * swap the movement for another, or change the coach's note on it, in the
 * client's copy only. Sets stay as they are on a swap.
 */
export class UpdateCopyExerciseDto {
  @ApiPropertyOptional({
    example: 'b2c3d4e5-1111-2222-3333-4444bcde5555',
    description: 'The exercise to do instead. Its sets stay.',
  })
  @IsOptional()
  @IsUUID()
  exerciseId?: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    nullable: true,
    description: 'The coach note the client reads. Empty or null clears it.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Body for `PATCH /program-assignments/:id/copy/days/:dayId/date`. */
export class MoveCopyDayDto {
  @ApiProperty({
    example: '2026-11-26',
    description:
      'The new date (YYYY-MM-DD): today or later, inside the plan, and free.',
  })
  // A date picker sends it, so no person types it: the generic message is
  // enough for a malformed one.
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}
