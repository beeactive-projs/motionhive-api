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
      'Private notes about the client (only visible to the instructor)',
  })
  @IsString()
  @MaxLength(5000)
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
