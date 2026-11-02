import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Create one "day" inside a program. (weekIndex, dayIndex) must be
 * unique within the program — the partial index enforces it at DB
 * level (migration 047). The service computes `sequenceNumber`
 * (0-based linear position) from the existing rows.
 */
export class CreateProgramWorkoutDto {
  @ApiProperty({ example: 'Day 1 — Upper', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Focus on the bench press progression.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** 0-based week within the program. */
  @ApiProperty({ example: 0, minimum: 0, maximum: 103 })
  @IsInt()
  @Min(0)
  @Max(103)
  weekIndex: number;

  /** 0-based day within the week (Mon = 0). */
  @ApiProperty({ example: 0, minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex: number;

  @ApiPropertyOptional({
    example: 'accumulation',
    description: 'Free-text periodization label.',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phase?: string;

  @ApiPropertyOptional({ example: 60, minimum: 5, maximum: 480 })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  estimatedDurationMinutes?: number;

  /** The day's rest, between a set's own and the program's default. */
  @ApiPropertyOptional({
    example: 120,
    minimum: 0,
    maximum: 600,
    nullable: true,
    description:
      "Rest between sets for this day, in seconds. A set's own rest wins; " +
      "the program's default applies when this is null.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  defaultRestSeconds?: number | null;
}
