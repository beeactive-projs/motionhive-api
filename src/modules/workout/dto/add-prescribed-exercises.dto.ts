import { ApiProperty, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';

import { CreatePrescribedExerciseDto } from './create-prescribed-exercise.dto';

/** One movement of `POST …/exercises/bulk`: what it is and its empty sets. */
export class AddPrescribedExerciseItemDto extends PickType(
  CreatePrescribedExerciseDto,
  ['exerciseId', 'defaultSets', 'restAfterSeconds', 'notes'] as const,
) {}

/**
 * Body for `POST /programs/:id/workouts/:workoutId/exercises/bulk`.
 *
 * The picker hands back several movements at once, and adding them was one
 * request each: a loop of writes, slow and not atomic (some added, some not).
 * This saves them all in one transaction, appended in the order sent.
 */
export class AddPrescribedExercisesDto {
  @ApiProperty({ type: [AddPrescribedExerciseItemDto], maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AddPrescribedExerciseItemDto)
  exercises: AddPrescribedExerciseItemDto[];
}
