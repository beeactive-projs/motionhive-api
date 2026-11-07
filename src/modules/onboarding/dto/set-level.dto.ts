import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ExerciseLevel } from '../../exercise/entities/exercise.enums';
import { MAX_CATEGORIES_PER_PICK } from './set-interests.dto';

/**
 * `PUT /users/me/onboarding/level`: how far along a person is and why they
 * train. `goalIds` replaces their goals; a null level clears it.
 */
export class SetLevelDto {
  @ApiProperty({
    enum: Object.values(ExerciseLevel),
    nullable: true,
    example: 'BEGINNER',
  })
  @IsOptional()
  @IsIn(Object.values(ExerciseLevel))
  fitnessLevel!: ExerciseLevel | null;

  @ApiProperty({
    type: [String],
    maxItems: MAX_CATEGORIES_PER_PICK,
    description: 'Category ids of kind GOAL',
    example: ['1c2d3e4f-5061-4b7c-9d8e-0f1a2b3c4d5e'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PICK)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  goalIds!: string[];
}
