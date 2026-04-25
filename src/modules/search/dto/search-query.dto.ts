import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SEARCH_ENTITY_FILTERS = [
  'all',
  'people',
  'instructors',
  'groups',
  'sessions',
  'tags',
] as const;

export type SearchEntityFilter = (typeof SEARCH_ENTITY_FILTERS)[number];

export class SearchQueryDto {
  @ApiProperty({ example: 'yoga', description: 'Search query (min 2 chars).' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({ enum: SEARCH_ENTITY_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(SEARCH_ENTITY_FILTERS as unknown as string[])
  type?: SearchEntityFilter = 'all';

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
