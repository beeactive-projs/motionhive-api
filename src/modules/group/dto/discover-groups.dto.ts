import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class DiscoverGroupsDto {
  @ApiPropertyOptional({
    example: 'morning yoga',
    description: 'Search by name or description',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    example: ['fitness', 'yoga'],
    description: 'Filter by tags (groups must contain ALL specified tags)',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    example: 'Bucharest',
    description: 'Filter by city',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({
    example: 'RO',
    description: 'Filter by country code',
  })
  @IsString()
  @MaxLength(3)
  @IsOptional()
  country?: string;

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
