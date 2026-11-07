import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** More than the list holds, so the cap only stops a runaway client. */
export const MAX_CATEGORIES_PER_PICK = 30;

/**
 * `PUT /users/me/onboarding/interests`: the activities a person likes,
 * replacing the ones they had. Activities only, and none of the coaches
 * only ones. Empty clears them.
 */
export class SetInterestsDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_CATEGORIES_PER_PICK,
    description: 'Category ids of kind ACTIVITY',
    example: ['0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PICK)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds!: string[];
}
