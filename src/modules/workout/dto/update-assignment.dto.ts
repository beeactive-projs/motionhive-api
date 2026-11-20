import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProgramAssignmentStatus } from '../entities/workout.enums';

/** The longest message a coach may send with a status change. */
export const STATUS_MESSAGE_MAX = 500;

/**
 * INSTRUCTOR-only PATCH on a program assignment. Status transitions
 * are validated server-side (PENDING/ACTIVE/PAUSED ↔, COMPLETED &
 * CANCELLED terminal).
 */
export class UpdateAssignmentDto {
  @ApiPropertyOptional({ enum: ProgramAssignmentStatus })
  @IsOptional()
  @IsEnum(ProgramAssignmentStatus)
  status?: ProgramAssignmentStatus;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Sent to the client with the notice about a status change (pause,
   * resume, finish, cancel), quoted as written. Ignored when the status
   * does not change.
   */
  @ApiPropertyOptional({ maxLength: STATUS_MESSAGE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(STATUS_MESSAGE_MAX, {
    message: 'errors.validation.personalMessageTooLong',
  })
  message?: string;
}
