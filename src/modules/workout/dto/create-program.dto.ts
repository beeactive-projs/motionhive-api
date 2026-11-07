import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ExerciseSetType,
  ProgramKind,
  ProgramStatus,
} from '../entities/workout.enums';

/**
 * Create Program DTO — instructor authors a new program shell.
 *
 * V1 only ships `kind = WORKOUT`; the other values exist on the BE
 * for forward-compat (locked decision §3). Workouts/exercises/sets
 * are added via nested endpoints after the program exists.
 */
/**
 * One prescribed set inside a routine. Sending these expresses real
 * programming — a warm-up, a top set, backoffs — instead of N identical
 * sets, which is what `defaultSets` alone can say.
 */
export class CreateProgramSetDto {
  @ApiPropertyOptional({
    enum: ExerciseSetType,
    default: ExerciseSetType.Normal,
  })
  @IsOptional()
  @IsEnum(ExerciseSetType)
  setType?: ExerciseSetType;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  targetRepsMin?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  targetRepsMax?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetWeightKg?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  targetDurationSeconds?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  targetDistanceMeters?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  restAfterSeconds?: number;
}

export class CreateProgramExerciseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  exerciseId!: string;

  /**
   * Explicit per-set rows. Takes precedence over `defaultSets` and the
   * flat targets, which stay for callers that only need "3 × 8".
   */
  @ApiPropertyOptional({ type: [CreateProgramSetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateProgramSetDto)
  sets?: CreateProgramSetDto[];

  @ApiPropertyOptional({ minimum: 1, maximum: 30, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  defaultSets?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  supersetGroupId?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  targetRepsMin?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  targetRepsMax?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetWeightKg?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  restAfterSeconds?: number;
}

export class CreateProgramDto {
  @ApiProperty({ example: 'Strength foundations — 8 weeks', maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example:
      '8-week beginner barbell program. 3 days/week, full-body, linear progression.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    enum: ProgramKind,
    example: ProgramKind.Workout,
    default: ProgramKind.Workout,
  })
  @IsOptional()
  @IsEnum(ProgramKind)
  kind?: ProgramKind;

  @ApiPropertyOptional({
    enum: ProgramStatus,
    example: ProgramStatus.Draft,
    default: ProgramStatus.Draft,
  })
  @IsOptional()
  @IsEnum(ProgramStatus)
  status?: ProgramStatus;

  /**
   * Program length in days. Coaches typically author in weeks (× 7) but
   * day-counted shapes ("21-day starter") are first-class. Null/omit =
   * open-ended. Capped at 104 weeks (728 days) to match the migration.
   */
  @ApiPropertyOptional({ example: 56, minimum: 1, maximum: 728 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(728)
  durationDays?: number;

  @ApiPropertyOptional({
    example: 'linear',
    description:
      'Free-text UX hint (linear / undulating / block / conjugate). Not enum-validated.',
    maxLength: 50,
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  periodizationModel?: string;

  @ApiPropertyOptional({
    example: 'https://img.motionhive.fit/motionhive/production/.../cover.jpg',
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  coverImageUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['hypertrophy', 'fat_loss'],
    description: 'Free tags — UI uses them for browse hints.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  goalTags?: string[];

  /**
   * Routine-shaped: one workout, no week/day axis. What a person
   * training for themselves creates; the simplified editor sets this.
   */
  @ApiPropertyOptional({
    description:
      'Create as a single-workout program (a routine) rather than a multi-week program.',
  })
  @IsOptional()
  @IsBoolean()
  isSingleWorkout?: boolean;

  @ApiPropertyOptional({ example: 'Push / Pull / Legs', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  folder?: string;

  /**
   * A routine's "Rest between sets", or a program's default rest. A set's
   * own rest wins, then the day's. Null clears it.
   */
  @ApiPropertyOptional({
    example: 90,
    minimum: 0,
    maximum: 600,
    nullable: true,
    description:
      "Rest between sets in seconds: a routine's, or a program's default. " +
      "A set's own rest wins, then the day's. Null clears it.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  defaultRestSeconds?: number | null;

  /**
   * Optional nested tree, only valid with `isSingleWorkout: true`. Lets
   * the simple routine editor save a whole workout in one call instead
   * of chaining four requests. Multi-week programs still build up
   * through the nested endpoints, where the week/day axis matters.
   */
  @ApiPropertyOptional({ type: [CreateProgramExerciseDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateProgramExerciseDto)
  exercises?: CreateProgramExerciseDto[];
}
