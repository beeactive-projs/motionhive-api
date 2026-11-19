import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ProgramAssignmentStatus } from '../entities/workout.enums';

/**
 * Query for `GET /program-assignments` (instructor surface) and
 * `GET /my/program-assignments` (client surface). The two endpoints
 * scope ownership server-side; this DTO is shared.
 */
export class ListAssignmentsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ProgramAssignmentStatus })
  @IsOptional()
  @IsEnum(ProgramAssignmentStatus)
  status?: ProgramAssignmentStatus;

  @ApiPropertyOptional({
    description: 'Filter by a specific client (instructor surface only).',
  })
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @ApiPropertyOptional({
    description:
      'Only the assignments made from this program (instructor surface ' +
      'only), so a program page lists all of its clients, not those among ' +
      'the newest assignments across every program.',
  })
  @IsOptional()
  @IsUUID('4')
  programId?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive match on the program name as it was assigned. ' +
      'Matches the snapshot rather than the live program, so a renamed ' +
      'program is still found by the name the client was given.',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
