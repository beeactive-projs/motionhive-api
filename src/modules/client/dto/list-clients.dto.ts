import { IsOptional, IsEnum, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { InstructorClientStatus } from '../entities/instructor-client.entity';

/**
 * Which way a pending row points.
 *
 * A PENDING row is a `client_request`, and the two directions ask opposite
 * things of a coach: an INCOMING request needs a decision, an OUTGOING
 * invitation needs patience. `?status=PENDING` returns both and could not
 * tell them apart, so a caller wanting one had to fetch both and re-derive
 * the split from `requestType`.
 */
export enum ClientDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

/**
 * List Clients DTO
 *
 * Extends the standard pagination DTO with an optional status filter,
 * a direction filter for pending rows, and a search term.
 */
export class ListClientsDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'ACTIVE',
    description: 'Filter clients by relationship status',
    enum: InstructorClientStatus,
  })
  @IsEnum(InstructorClientStatus)
  @IsOptional()
  status?: InstructorClientStatus;

  @ApiPropertyOptional({
    example: 'incoming',
    description:
      'Narrow to pending rows pointing one way: `incoming` = requests from ' +
      'people who want this coach, `outgoing` = invitations this coach sent. ' +
      'Only pending rows can have a direction, so setting this excludes ' +
      'settled (ACTIVE / ARCHIVED) relationships.',
    enum: ClientDirection,
  })
  @IsEnum(ClientDirection)
  @IsOptional()
  direction?: ClientDirection;

  @ApiPropertyOptional({
    example: 'anna popescu',
    description:
      "Search term — matches the client's first name, last name, email, " +
      'or the address an email-only invitation was sent to ' +
      '(case-insensitive). Whitespace splits the term into tokens and every ' +
      'token must match somewhere, so "anna popescu" matches a first/last ' +
      'name pair. Terms shorter than 2 characters are ignored.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
