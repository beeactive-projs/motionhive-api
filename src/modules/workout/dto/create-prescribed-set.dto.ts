import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExerciseSetType } from '../entities/workout.enums';

/**
 * One prescribed set. All target fields are independently optional —
 * the parent exercise's `kind` decides which the FE surfaces.
 * Mutually-exclusive use (target_weight_kg vs target_weight_percent_1rm)
 * is a FE concern; the BE accepts both but the client picks one.
 */
export class CreatePrescribedSetDto {
  @ApiPropertyOptional({
    enum: ExerciseSetType,
    example: ExerciseSetType.Normal,
    default: ExerciseSetType.Normal,
  })
  @IsOptional()
  @IsEnum(ExerciseSetType)
  setType?: ExerciseSetType;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Order within the parent exercise. Service appends if omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  // ── Reps ──────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  targetRepsMin?: number;

  @ApiPropertyOptional({ example: 8, minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  targetRepsMax?: number;

  // ── Weight ────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 80, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999)
  targetWeightKg?: number;

  @ApiPropertyOptional({ example: 75, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  targetWeightPercent1rm?: number;

  // ── Duration / distance ──────────────────────────────────────────

  @ApiPropertyOptional({ example: 60, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  targetDurationSeconds?: number;

  @ApiPropertyOptional({ example: 1000, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  targetDistanceMeters?: number;

  // ── Intensity ────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 8, minimum: 1, maximum: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(1)
  @Max(10)
  targetRpe?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  targetRir?: number;

  // ── Pacing ───────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 90, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  restAfterSeconds?: number;

  @ApiPropertyOptional({
    example: '3-1-1-0',
    description: '4-digit eccentric-pause-concentric-pause tempo.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d-\d-\d-\d$/, {
    message: 'tempo must be the 4-digit "E-P-C-P" form, e.g. "3-1-1-0".',
  })
  tempo?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
