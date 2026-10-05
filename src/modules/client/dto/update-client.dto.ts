import { IsOptional, IsString, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InstructorClientStatus } from '../entities/instructor-client.entity';

/**
 * Update Client DTO
 *
 * Used by instructors to update notes on a client relationship
 * or to archive (end) the relationship.
 */
export class UpdateClientDto {
  @ApiPropertyOptional({
    example: 'Prefers morning sessions. Working on upper body strength.',
    description:
      'Private notes about the client (only visible to the instructor). Max 2000 characters — the same limit the web and mobile note editors show.',
  })
  @IsString()
  // 2000, not 5000: both clients count down from 2000 and show that number to
  // the coach. A server limit above it makes the counter a decoration.
  @MaxLength(2000)
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    example: InstructorClientStatus.ARCHIVED,
    description: 'Update the relationship status (ACTIVE or ARCHIVED)',
    enum: [InstructorClientStatus.ACTIVE, InstructorClientStatus.ARCHIVED],
  })
  @IsEnum([InstructorClientStatus.ACTIVE, InstructorClientStatus.ARCHIVED])
  @IsOptional()
  status?: InstructorClientStatus.ACTIVE | InstructorClientStatus.ARCHIVED;
}
