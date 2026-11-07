import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toQueryList } from '../../../common/utils/query.utils';
import { CoachDirectorySort } from '../entities/coach-directory.enums';

/**
 * Query params for GET /profile/instructors/directory.
 *
 * Every filter narrows the same paged list, so they combine with AND.
 * `accepting`, `online` and `requested` accept the string forms `'true'` / `'false'`,
 * since a query string is always a string.
 */
export class CoachDirectoryDto {
  @ApiPropertyOptional({
    example: 'yoga',
    description:
      'Search by name, display name, bio, city or specialization, blind to accents and case',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    example: 'Cluj',
    description: 'Coaches whose city contains this, blind to accents and case',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({
    example: 'RO',
    description: 'Coaches in this country (ISO 3166-1 alpha-2)',
  })
  @IsString()
  @MaxLength(3)
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ description: 'Only coaches taking new clients' })
  @Transform(queryFlag)
  @IsBoolean()
  @IsOptional()
  accepting?: boolean;

  @ApiPropertyOptional({
    description: 'Only coaches with an active online venue (a meeting link)',
  })
  @Transform(queryFlag)
  @IsBoolean()
  @IsOptional()
  online?: boolean;

  @ApiPropertyOptional({
    description:
      'Only coaches the caller asked and is still waiting on (each row says `requestSent`). ' +
      'Matches nobody for a guest.',
  })
  @Transform(queryFlag)
  @IsBoolean()
  @IsOptional()
  requested?: boolean;

  @ApiPropertyOptional({
    example: ['Yoga', 'Pilates'],
    isArray: true,
    description:
      'Coaches who list any of these, matched whole and blind to accents and case. ' +
      'Repeat the param (`specializations=Yoga&specializations=Pilates`); a ' +
      'specialization is free text, so a comma is part of the value.',
  })
  @Transform(({ value }) => toStringList(value))
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @IsOptional()
  specializations?: string[];

  @ApiPropertyOptional({
    example: ['0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'],
    isArray: true,
    description:
      'Coaches who coach any of these categories (ids from `GET /categories`). ' +
      'Repeat the param or separate the ids with commas.',
  })
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  @IsOptional()
  categoryIds?: string[];

  @ApiPropertyOptional({
    example: 5,
    description: 'Coaches with at least this many years of experience',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  @IsOptional()
  minYears?: number;

  @ApiPropertyOptional({
    enum: CoachDirectorySort,
    default: CoachDirectorySort.RECOMMENDED,
  })
  @IsEnum(CoachDirectorySort)
  @IsOptional()
  sort?: CoachDirectorySort = CoachDirectorySort.RECOMMENDED;

  @ApiPropertyOptional({ example: 1, description: 'Page number', default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page (max 50)',
    default: 20,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  @IsOptional()
  limit?: number = 20;
}

/**
 * A `true` / `false` query flag, read off the raw query rather than `value`:
 * the global pipe's implicit conversion has already run `Boolean('false')`
 * by then, which is `true`, so `?online=false` would filter to online.
 */
function queryFlag({ obj, key }: TransformFnParams): boolean {
  const raw: unknown = (obj as Record<string, unknown>)[key];
  return raw === 'true' || raw === true;
}

/**
 * Express hands back a string for `?x=A` and an array for `?x=A&x=B`; both
 * become one trimmed list. Empty input stays undefined so `@IsOptional`
 * skips it, and non-strings pass through for `@IsString` to reject.
 */
function toStringList(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const list = raw
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
  return list.length > 0 ? list : undefined;
}
