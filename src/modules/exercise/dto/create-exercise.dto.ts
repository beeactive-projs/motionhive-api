import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ExerciseForce,
  ExerciseKind,
  ExerciseLevel,
  ExerciseMechanic,
  ExerciseVisibility,
  MovementPattern,
} from '../entities/exercise.enums';
import { MuscleRoleInputDto } from './muscle-role-input.dto';

/**
 * Create Exercise DTO
 *
 * Used by instructors to author a custom (INSTRUCTOR-source) exercise,
 * and by anyone else for their own (USER-source, always PRIVATE) one.
 * SYSTEM exercises are seeded via `scripts/seed-exercises.ts` and never
 * created through this endpoint.
 *
 * Cross-field rules enforced in `ExerciseService.create`:
 *   - a coach's: at least one muscle with role=PRIMARY (max 3)
 *   - someone's own: muscles optional, `visibility` ignored (PRIVATE)
 *   - if PUBLIC visibility, owner_id must be set (auto from JWT)
 *
 * DTO-level validation only checks per-field shape and bounds —
 * anything that depends on multiple fields belongs in the service
 * (same convention as venue / session DTOs).
 */
export class CreateExerciseDto {
  @ApiProperty({ example: 'Tempo goblet squat', maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: 'A controlled-tempo squat with a kettlebell held at the chest.',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    example:
      'Stand tall, hold the kettlebell at the chest. 3-second descent, ' +
      '1-second pause at the bottom, 1-second ascent.',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  instructions?: string;

  @ApiProperty({ enum: ExerciseKind, example: ExerciseKind.Strength })
  @IsEnum(ExerciseKind)
  kind: ExerciseKind;

  @ApiPropertyOptional({
    enum: ExerciseLevel,
    example: ExerciseLevel.Beginner,
    default: ExerciseLevel.Beginner,
  })
  @IsOptional()
  @IsEnum(ExerciseLevel)
  level?: ExerciseLevel;

  @ApiPropertyOptional({
    enum: MovementPattern,
    example: MovementPattern.Squat,
  })
  @IsOptional()
  @IsEnum(MovementPattern)
  movementPattern?: MovementPattern;

  @ApiPropertyOptional({
    enum: ExerciseMechanic,
    example: ExerciseMechanic.Compound,
  })
  @IsOptional()
  @IsEnum(ExerciseMechanic)
  mechanic?: ExerciseMechanic;

  @ApiPropertyOptional({ enum: ExerciseForce, example: ExerciseForce.Push })
  @IsOptional()
  @IsEnum(ExerciseForce)
  force?: ExerciseForce;

  @ApiPropertyOptional({
    example: 7.0,
    description:
      'MET intensity for cardio exercises. Used for downstream calorie ' +
      'estimation; not shown in the UI.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  @Max(30)
  metValue?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'Split squats / single-arm rows / single-leg work. Drives ' +
      'L vs R tracking in the logging UX.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isUnilateral?: boolean;

  @ApiPropertyOptional({
    example: 'https://www.youtube.com/watch?v=aclHkVaku9U',
    description:
      'YouTube demo URL. Native upload is V2. Validated against ' +
      'youtube.com / youtu.be hosts; thumbnail is auto-fetched ' +
      'server-side via oEmbed.',
    maxLength: 500,
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  @Matches(/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//, {
    message: 'youtubeUrl must point to youtube.com or youtu.be',
  })
  youtubeUrl?: string;

  @ApiPropertyOptional({
    enum: ExerciseVisibility,
    example: ExerciseVisibility.Private,
    default: ExerciseVisibility.Private,
    description:
      'PUBLIC = visible to all instructors and forkable; PRIVATE = ' +
      'only the owner. Soft-flipping from PUBLIC to PRIVATE later does ' +
      'not break existing program references.',
  })
  @IsOptional()
  @IsEnum(ExerciseVisibility)
  visibility?: ExerciseVisibility;

  @ApiPropertyOptional({
    type: [MuscleRoleInputDto],
    description:
      'Muscles worked by this exercise, with their role. For a coach at ' +
      'least one PRIMARY is required; for anyone else (an own USER ' +
      'exercise) it is optional. PRIMARY capped at 3. Service-layer ' +
      'validation.',
    example: [
      { muscleId: '8a4b0fda-2c5e-4e60-94d6-3d2a8b5e0c5f', role: 'PRIMARY' },
      { muscleId: '5b1c9aef-3d6f-4a71-a5e8-2c1b9d3a0e7b', role: 'SECONDARY' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MuscleRoleInputDto)
  muscles?: MuscleRoleInputDto[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Equipment UUIDs. Empty / omitted = bodyweight (the service ' +
      'auto-attaches the Bodyweight row).',
    example: [
      'c6e2b1da-7a85-4d3a-9f10-0b8e5c4a2f30',
      '9b7f3e10-2c8a-4f6e-90a3-3d1b8e4c5a6f',
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  @ArrayUnique()
  equipmentIds?: string[];
}
