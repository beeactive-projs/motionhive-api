import {
  IsOptional,
  IsString,
  MaxLength,
  IsEnum,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class DiscoverSessionsDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'yoga',
    description:
      'Search term to filter sessions by title, description, or location',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    example: 'GROUP',
    enum: ['ONE_ON_ONE', 'GROUP', 'ONLINE', 'WORKSHOP'],
    description: 'Filter by session type',
  })
  @IsOptional()
  @IsEnum(['ONE_ON_ONE', 'GROUP', 'ONLINE', 'WORKSHOP'])
  sessionType?: string;

  @ApiPropertyOptional({
    example: '2026-03-01T00:00:00.000Z',
    description: 'Filter sessions starting from this date',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-03-31T23:59:59.000Z',
    description: 'Filter sessions up to this date',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    example: 120,
    description: 'Maximum duration in minutes',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  maxDurationMinutes?: number;

  @ApiPropertyOptional({
    example: 'scheduledAt',
    enum: ['scheduledAt', 'price', 'title'],
    description: 'Sort by field',
  })
  @IsOptional()
  @IsEnum(['scheduledAt', 'price', 'title'])
  sortBy?: string;

  @ApiPropertyOptional({
    example: 'ASC',
    enum: ['ASC', 'DESC'],
    description: 'Sort direction',
  })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortDir?: 'ASC' | 'DESC';
}
