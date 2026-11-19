import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { OnboardingRole } from '../entities/onboarding.enums';

/**
 * `PUT /users/me/onboarding/role`: "How will you use MotionHive?". COACH
 * makes the person a coach: a coach profile and the INSTRUCTOR role, as
 * "Become a coach" does.
 */
export class AnswerRoleDto {
  @ApiProperty({ enum: Object.values(OnboardingRole), example: 'TRAIN' })
  @IsIn(Object.values(OnboardingRole))
  role!: OnboardingRole;
}
