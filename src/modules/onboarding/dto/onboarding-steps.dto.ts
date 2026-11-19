import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
} from 'class-validator';
import { OnboardingStep } from '../entities/onboarding.enums';

/**
 * `POST /users/me/onboarding/skip` and `/dismiss`: several steps in one
 * call, as closing the flow or a card leaves all of theirs at once.
 */
export class OnboardingStepsDto {
  @ApiProperty({
    enum: Object.values(OnboardingStep),
    isArray: true,
    example: ['INTERESTS', 'LEVEL'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(Object.values(OnboardingStep).length)
  @ArrayUnique()
  @IsIn(Object.values(OnboardingStep), { each: true })
  steps!: OnboardingStep[];
}
