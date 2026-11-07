import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { toQueryList } from '../../../common/utils/query.utils';
import {
  ExerciseForce,
  ExerciseKind,
  ExerciseLevel,
  ExerciseMechanic,
  MovementPattern,
} from '../entities/exercise.enums';

/**
 * Ownership tab on the catalog (design S1 / S6).
 *
 * - `all`           — system + my private + my public + other instructors' public
 * - `system`        — only SYSTEM exercises
 * - `mine`          — owned by the authenticated instructor (private + public)
 * - `public-others` — PUBLIC exercises owned by someone else (not me)
 *
 * Default `all`. Clients with the browse-gate enabled see the same
 * facet set (system + public-others); they do not get the `mine` /
 * private slice — service enforces.
 */
export const ExerciseOwnershipFilter = {
  All: 'all',
  System: 'system',
  Mine: 'mine',
  PublicOthers: 'public-others',
} as const;
export type ExerciseOwnershipFilter =
  (typeof ExerciseOwnershipFilter)[keyof typeof ExerciseOwnershipFilter];

/**
 * - `relevance`   — the best match for what was typed, then what the person
 *                   and everyone use most. With no search: what the person
 *                   and everyone use most, then A to Z. Default.
 * - `name`        — A to Z. While searching, still the best match first
 *                   (older apps send `name` and expect that).
 * - `newest`, `most-forked` — as named, also while searching.
 */
export const ExerciseSortKey = {
  Relevance: 'relevance',
  Name: 'name',
  Newest: 'newest',
  MostForked: 'most-forked',
} as const;
export type ExerciseSortKey =
  (typeof ExerciseSortKey)[keyof typeof ExerciseSortKey];

export class ListExercisesQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'squat',
    description:
      'Words to look for, in any order and any of our languages. Each word ' +
      'matches the start of a word of the name (plurals and stems too), ' +
      'shorthand and synonyms ("db", "rdl", "pec deck"), a muscle or ' +
      'muscle group the exercise works ("chest", "legs", "spate"), ' +
      'equipment it uses ("gantere"), or a close spelling of the name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({
    enum: ExerciseKind,
    isArray: true,
    example: [ExerciseKind.Strength, ExerciseKind.Bodyweight],
    description: 'Comma-separated list of kinds, e.g. ?kind=STRENGTH,CARDIO',
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsEnum(ExerciseKind, { each: true })
  kind?: ExerciseKind[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by primary muscle UUIDs (comma-separated).',
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsUUID('4', { each: true })
  primaryMuscleId?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by equipment UUIDs (comma-separated).',
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsUUID('4', { each: true })
  equipmentId?: string[];

  @ApiPropertyOptional({
    enum: ExerciseLevel,
    isArray: true,
    example: [ExerciseLevel.Beginner, ExerciseLevel.Intermediate],
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsEnum(ExerciseLevel, { each: true })
  level?: ExerciseLevel[];

  @ApiPropertyOptional({
    enum: MovementPattern,
    isArray: true,
    example: [MovementPattern.Squat],
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsEnum(MovementPattern, { each: true })
  movementPattern?: MovementPattern[];

  @ApiPropertyOptional({
    enum: ExerciseMechanic,
    isArray: true,
    example: [ExerciseMechanic.Compound],
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsEnum(ExerciseMechanic, { each: true })
  mechanic?: ExerciseMechanic[];

  @ApiPropertyOptional({
    enum: ExerciseForce,
    isArray: true,
    example: [ExerciseForce.Push],
  })
  @IsOptional()
  @Transform(({ value }) => toQueryList(value))
  @IsArray()
  @IsEnum(ExerciseForce, { each: true })
  force?: ExerciseForce[];

  @ApiPropertyOptional({
    enum: ExerciseOwnershipFilter,
    example: ExerciseOwnershipFilter.All,
    default: ExerciseOwnershipFilter.All,
  })
  @IsOptional()
  @IsEnum(ExerciseOwnershipFilter)
  ownership?: ExerciseOwnershipFilter;

  @ApiPropertyOptional({
    enum: ExerciseSortKey,
    example: ExerciseSortKey.Relevance,
    default: ExerciseSortKey.Relevance,
  })
  @IsOptional()
  @IsEnum(ExerciseSortKey)
  sort?: ExerciseSortKey;

  @ApiPropertyOptional({
    type: Boolean,
    example: true,
    description:
      'When true, the response includes `facets` aggregates per ' +
      '(kind, primaryMuscleId, equipmentId, level). Extra query work; ' +
      'omit for picker / autocomplete contexts.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === '1' ? true : false,
  )
  withFacets?: boolean;
}
