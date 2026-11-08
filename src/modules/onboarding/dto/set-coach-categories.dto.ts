import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_CATEGORIES_PER_PICK } from '../../category/dto/category-ids';

/** Extra words a coach can add in one go, on top of the list. */
export const MAX_OTHER_SPECIALIZATIONS = 10;

/**
 * `PUT /users/me/onboarding/coach-categories`: what a coach coaches,
 * replacing what they had. At least one activity (checked by the service,
 * so the message is in the reader's language). `otherSpecializations`
 * are their own words for anything the list misses; they are added to the
 * profile's specializations, never replacing what is there.
 */
export class SetCoachCategoriesDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_CATEGORIES_PER_PICK,
    description: 'Category ids of kind ACTIVITY (coaches only ones included)',
    example: ['0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PICK)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds!: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_OTHER_SPECIALIZATIONS,
    example: ['Kettlebells'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_OTHER_SPECIALIZATIONS)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  otherSpecializations?: string[];
}
