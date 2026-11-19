import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CoachCategory } from './entities/coach-category.entity';
import { UserInterest } from './entities/user-interest.entity';
import { UserOnboardingStep } from './entities/user-onboarding-step.entity';
import { OnboardingStateService } from './onboarding-state.service';

/**
 * The welcome flow state reader on its own, with only the tables it reads.
 * UserModule imports it for `GET /users/me`; OnboardingModule imports
 * UserModule, so the reader cannot live there without a cycle.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      UserOnboardingStep,
      UserInterest,
      CoachCategory,
    ]),
  ],
  providers: [OnboardingStateService],
  exports: [OnboardingStateService],
})
export class OnboardingStateModule {}
