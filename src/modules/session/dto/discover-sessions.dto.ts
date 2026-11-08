import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CategoryIdsFilter } from '../../category/dto/category-ids';

/**
 * Query DTO for the public discover endpoint.
 *
 * The endpoint is `@Public()` — unauthenticated callers see OPEN+FREE
 * sessions only. Authenticated callers see those PLUS CLIENTS_ONLY
 * sessions of instructors they have an active client relationship with,
 * AND GROUP_ONLY sessions of groups they're a current member of.
 *
 * Hard window cap of 90 days is enforced server-side regardless of
 * client input — keeps the index scan cheap and discourages scrapers.
 */
export class DiscoverSessionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Free-text search over title + description (max 200 chars).',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: ['GROUP', 'PRIVATE', 'OPEN'] })
  @IsOptional()
  @IsIn(['GROUP', 'PRIVATE', 'OPEN'])
  type?: 'GROUP' | 'PRIVATE' | 'OPEN';

  @ApiPropertyOptional({ enum: ['IN_PERSON', 'ONLINE'] })
  @IsOptional()
  @IsIn(['IN_PERSON', 'ONLINE'])
  locationKind?: 'IN_PERSON' | 'ONLINE';

  @ApiPropertyOptional({ description: 'Filter to a single instructor.' })
  @IsOptional()
  @IsUUID('4')
  instructorId?: string;

  @ApiPropertyOptional({ description: 'Filter to a single group.' })
  @IsOptional()
  @IsUUID('4')
  groupId?: string;

  @CategoryIdsFilter(
    "Sessions that train any of these categories: the session's group's " +
      "categories when the group has some, else its coach's, as each row's " +
      '`template.categoryIds` shows',
  )
  categoryIds?: string[];

  @ApiPropertyOptional({ description: 'ISO8601 lower bound (inclusive).' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'ISO8601 upper bound (exclusive).' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
