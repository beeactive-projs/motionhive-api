import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Which of a client's workouts a coach is looking at: the ones from their
 * own plans, the ones the client did on their own and shared, the plan
 * days the client skipped, or `all` three in one dated list. Omitted, the
 * finished workouts alone, as the list has always been.
 */
export const COACH_LOG_KINDS = ['all', 'plan', 'own', 'skipped'] as const;
export type CoachLogKind = (typeof COACH_LOG_KINDS)[number];

/** Query for `GET /coach/clients/:clientId/workout-logs`. */
export class CoachClientLogsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: COACH_LOG_KINDS,
    description:
      '`plan`: from your plans. `own`: what they shared that is not from ' +
      'your plans. `skipped`: days of your plans they skipped. `all`: the ' +
      'three together. Omitted: finished workouts only (plan and own).',
  })
  @IsOptional()
  @IsIn(COACH_LOG_KINDS)
  kind?: CoachLogKind;

  @ApiPropertyOptional({
    description: 'ISO8601 lower bound on the day (inclusive).',
  })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'ISO8601 upper bound on the day (exclusive).',
  })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
