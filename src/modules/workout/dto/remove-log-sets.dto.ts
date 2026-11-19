import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/** Enough for any round of a superset (two or three exercises), with room to spare. */
export const MAX_SETS_PER_REMOVE = 20;

/**
 * `POST /workout-logs/:id/sets/remove`: several sets of a running workout
 * gone in one transaction, such as a whole round of a superset. One call
 * instead of one per set, so a round is never left half deleted.
 */
export class RemoveLogSetsDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: MAX_SETS_PER_REMOVE,
    example: [
      'b2c3d4e5-1111-2222-3333-4444bcde5555',
      'c3d4e5f6-2222-3333-4444-5555cdef6666',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SETS_PER_REMOVE)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  setIds!: string[];
}
