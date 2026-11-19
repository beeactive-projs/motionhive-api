import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CategoryIdsFilter } from '../../category/dto/category-ids';

export class DiscoverInstructorsDto {
  @ApiPropertyOptional({
    example: 'yoga',
    description: 'Search by name, display name, bio, or specialization',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    example: 'Bucharest',
    description: 'Filter by city',
  })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({
    example: 'RO',
    description: 'Filter by country code',
  })
  @IsString()
  @IsOptional()
  country?: string;

  @CategoryIdsFilter('Coaches who coach any of these categories')
  categoryIds?: string[];

  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    default: 20,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}
