import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** What a history filter keeps: workouts with a photo, or with a record. */
export type WorkoutLogFilter = 'photo' | 'record';

const WORKOUT_LOG_FILTERS: WorkoutLogFilter[] = ['photo', 'record'];

/**
 * Query for `GET /workout-logs`.
 *
 * The date bounds are what let a single day be asked for. The Today
 * view needs "everything that happened on this date", and an assigned
 * workout's status only covers prescribed work — a freestyle session
 * has no assignment to carry a status, so without this it was invisible
 * on the day it was actually done.
 */
export class ListWorkoutLogsQueryDto extends PaginationDto {
  /** Inclusive lower bound on `startedAt`. */
  @ApiPropertyOptional({ example: '2026-08-10T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /** Exclusive upper bound on `startedAt`. */
  @ApiPropertyOptional({ example: '2026-08-11T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  /**
   * Case-insensitive match on the session name. Server-side because the
   * list is paged: filtering in the browser would only ever search the
   * page already loaded, and quietly miss the rest.
   */
  @ApiPropertyOptional({ example: 'push', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /**
   * Only workouts with a photo, or with a record (beating a previous best;
   * a first time on an exercise is none). Server-side for the same reason
   * as `search`.
   */
  @ApiPropertyOptional({ enum: WORKOUT_LOG_FILTERS, example: 'photo' })
  @IsOptional()
  @IsIn(WORKOUT_LOG_FILTERS)
  has?: WorkoutLogFilter;

  /**
   * `all`: with the skipped days of your plans, which leave no log, as rows
   * of status SKIPPED in date order. Ignored beside `has` or `search`.
   */
  @ApiPropertyOptional({ enum: ['all'] })
  @IsOptional()
  @IsIn(['all'])
  kind?: 'all';
}
