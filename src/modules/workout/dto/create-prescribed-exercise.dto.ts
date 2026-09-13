import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Attach an exercise slot to a program workout. `exerciseId` must
 * reference an exercise the caller can read (SYSTEM, their own, or a
 * PUBLIC custom — the service re-validates against the catalog).
 */
export class CreatePrescribedExerciseDto {
  @ApiProperty({ example: 'aa11cc22-dd33-44ee-bb55-ff66aa77bb88' })
  @IsUUID('4')
  exerciseId: string;

  @ApiPropertyOptional({
    description:
      'Same value across exercises in the same workout = paired superset.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  supersetGroupId?: number;

  @ApiPropertyOptional({
    example: 'fff11111-2222-3333-4444-555566667777',
    description:
      'Optional swap suggestion — the client sees this in the picker.',
  })
  @IsOptional()
  @IsUUID('4')
  alternateExerciseId?: string;

  @ApiPropertyOptional({
    description:
      'Optional block grouping (superset, circuit, etc.). Omit for standalone.',
  })
  @IsOptional()
  @IsUUID('4')
  blockId?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    example: 0,
    description:
      'Order within the workout. Omit and the service appends to the end.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 30,
    description:
      'Create this many empty sets under the exercise, in the same ' +
      'transaction. Omit to add the exercise alone.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  defaultSets?: number;
}
