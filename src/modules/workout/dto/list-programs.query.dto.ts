import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ExerciseLevel } from '../../exercise/entities/exercise.enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ProgramStatus } from '../entities/workout.enums';

/**
 * What to do with ARCHIVED programs. Omitted keeps today's answer (all
 * statuses, unless `status` names one), which is what the web expects.
 */
export enum ProgramArchivedFilter {
  /** Archived ones too (the same as omitting it). */
  Include = 'include',
  /** Leave archived ones out: where a routine is picked to start. */
  Exclude = 'exclude',
  /** Archived ones alone: the "Archived" filter, to restore one. */
  Only = 'only',
}

/** Whose library to read. */
export enum ProgramLibrary {
  /** Only what you authored. */
  Mine = 'mine',
  /** Only MotionHive's starter content. */
  System = 'system',
  /** Both, yours first. */
  All = 'all',
}

/**
 * Query string for `GET /programs`.
 *
 * Scoped to your own library plus MotionHive's starter content. Another
 * user's programs are never reachable here regardless of `library`.
 */
export class ListProgramsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'strength' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ProgramStatus })
  @IsOptional()
  @IsEnum(ProgramStatus)
  status?: ProgramStatus;

  /**
   * `exclude` leaves ARCHIVED out, `only` lists nothing else; omitted
   * (or `include`) keeps every status. `status`, when sent, narrows on top.
   */
  @ApiPropertyOptional({
    enum: ProgramArchivedFilter,
    description:
      'exclude: leave ARCHIVED programs out (the list a routine is ' +
      'started from). only: ARCHIVED alone (to restore one). Omitted or ' +
      'include: every status, as before.',
  })
  @IsOptional()
  @IsEnum(ProgramArchivedFilter)
  archived?: ProgramArchivedFilter;

  /**
   * True lists routines (single-workout programs), false lists
   * multi-week programs. Omit for both.
   */
  @ApiPropertyOptional({
    description:
      'Filter to single-workout programs (routines) or multi-week programs.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isSingleWorkout?: boolean;

  @ApiPropertyOptional({ example: 'Push / Pull / Legs' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  folder?: string;

  /** Editorial difficulty. Only curated content carries one. */
  @ApiPropertyOptional({ enum: ExerciseLevel })
  @IsOptional()
  @IsEnum(ExerciseLevel)
  level?: ExerciseLevel;

  /**
   * Defaults to `all`: a new account owns nothing, and defaulting to
   * `mine` would show them an empty library while starter content sat
   * one filter away, unseen.
   */
  @ApiPropertyOptional({ enum: ProgramLibrary, default: ProgramLibrary.All })
  @IsOptional()
  @IsEnum(ProgramLibrary)
  library?: ProgramLibrary;
}
