import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Query DTO for `GET /sessions/instances`.
 *
 * Visibility rule (enforced in the service, not here):
 *   - omitting `instructorId` (or passing the caller's own) → returns
 *     the caller's own instances (instructor view of own calendar).
 *   - passing another instructorId → returns only instances that
 *     caller is a participant of (CONFIRMED / PENDING / WAITLISTED).
 *
 * The date window defaults to "next 7 days" in the service when neither
 * `dateFrom` nor `dateTo` is set. Hard cap of 180 days enforced server-side
 * to prevent calendar scrapers.
 */
export class ListInstancesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'ISO8601 lower bound (inclusive).' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO8601 upper bound (exclusive).' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({
    description:
      'Filter to a specific instructor. Defaults to the caller (own calendar).',
  })
  @IsOptional()
  @IsUUID('4')
  instructorId?: string;

  @ApiPropertyOptional({ description: 'Filter to a specific template.' })
  @IsOptional()
  @IsUUID('4')
  templateId?: string;

  @ApiPropertyOptional({
    description:
      'Filter to instances a given person is booked into. Only meaningful ' +
      'on your own calendar — it narrows what you can already see, so it ' +
      'exposes nothing new. Ignored when viewing another instructor.',
  })
  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @ApiPropertyOptional({
    enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  })
  @IsOptional()
  @IsIn(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    default: 'asc',
    description:
      'By start time. `desc` for a past list, so the first page is the ' +
      'most recent sessions rather than the oldest in the window.',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
