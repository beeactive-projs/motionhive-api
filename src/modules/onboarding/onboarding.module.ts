import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CategoryModule } from '../category/category.module';
import { ProfileModule } from '../profile/profile.module';
import { RoleModule } from '../role/role.module';
import { User } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { CoachCategory } from './entities/coach-category.entity';
import { UserInterest } from './entities/user-interest.entity';
import { UserOnboardingStep } from './entities/user-onboarding-step.entity';
import { OnboardingStateModule } from './onboarding-state.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding Module
 *
 * The welcome flow a person sees after their first sign in, and the
 * answers it saves. The category list is CategoryModule's; the state read
 * is OnboardingStateModule's, which UserModule shares for `GET /users/me`.
 * The discovery queries (profile, group, session) read the category links
 * in SQL, so they need nothing from here and the module graph stays one
 * way: onboarding depends on profile and user, never the reverse.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      UserInterest,
      CoachCategory,
      UserOnboardingStep,
      User,
    ]),
    CategoryModule,
    OnboardingStateModule,
    RoleModule,
    UserModule,
    ProfileModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
