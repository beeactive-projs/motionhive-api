import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { CreatePrescribedSetDto } from './create-prescribed-set.dto';

/**
 * One set of `PUT …/exercises/:exerciseId/sets`: its whole target, as the
 * editor holds it. A field left out (or null) is cleared. Its position in
 * the list is its order, so it carries no `orderIndex`.
 */
export class PrescribedSetItemDto extends OmitType(CreatePrescribedSetDto, [
  'orderIndex',
] as const) {
  @ApiPropertyOptional({
    example: 'd4e5f6a7-3333-4444-5555-6666defa7777',
    description:
      'An existing set of this exercise, updated in place. Omit for a new set.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;
}

/**
 * Body for `PUT /programs/:id/workouts/:workoutId/exercises/:exerciseId/sets`.
 *
 * The editor's "Sets 3 · Reps 8–10 · 60 kg" changes several sets at once,
 * and saving them was one request per set. This sets all of them in one
 * transaction, keeping each set's row (and its id) where it was matched:
 * assigned copies and logged sets point back at these rows by id, so
 * rewriting the list would cut those links.
 */
export class SetPrescribedSetsDto {
  @ApiProperty({ type: [PrescribedSetItemDto], minItems: 1, maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescribedSetItemDto)
  sets: PrescribedSetItemDto[];
}
