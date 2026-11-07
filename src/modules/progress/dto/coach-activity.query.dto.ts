import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query for `GET /coach/activity`. A handful for Home, never a history:
 * the client page is where a coach reads further back.
 */
export class CoachActivityQueryDto {
  @ApiPropertyOptional({
    description: 'How many workouts, newest first (max 20).',
    default: 5,
    minimum: 1,
    maximum: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
