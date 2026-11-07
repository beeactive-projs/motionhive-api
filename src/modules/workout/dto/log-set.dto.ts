import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExerciseSetType, RestSource } from '../entities/workout.enums';

/**
 * Patch one logged set — what the client actually did.
 * All actuals optional; `isCompleted = true` with no values is valid
 * (locked decision §11, mark-complete-only).
 */
export class LogSetDto {
  @ApiPropertyOptional({ enum: ExerciseSetType })
  @IsOptional()
  @IsEnum(ExerciseSetType)
  setType?: ExerciseSetType;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  reps?: number;

  @ApiPropertyOptional({ example: 80, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999)
  weightKg?: number;

  @ApiPropertyOptional({ example: 60, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiPropertyOptional({ example: 1000, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  distanceMeters?: number;

  @ApiPropertyOptional({ example: 8, minimum: 1, maximum: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(10)
  rpe?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  rir?: number;

  /** The rest actually taken after this set, in seconds. */
  @ApiPropertyOptional({
    example: 90,
    minimum: 0,
    nullable: true,
    description:
      'The rest actually taken after this set, in seconds. Ignored (stored ' +
      'as null) when `restSource` is BREAK.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  restAfterSeconds?: number | null;

  /** How the rest was measured. BREAK stores no rest. */
  @ApiPropertyOptional({
    enum: RestSource,
    nullable: true,
    description:
      'TAP: the person ended the rest (exact). ESTIMATED: worked out from ' +
      'the next tick. BREAK: they were away; `restAfterSeconds` is stored ' +
      'as null. Null clears it.',
  })
  @IsOptional()
  @IsEnum(RestSource)
  restSource?: RestSource | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
