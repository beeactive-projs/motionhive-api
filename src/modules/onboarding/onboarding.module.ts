import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { ProfileModule } from '../profile/profile.module';
import { RoleModule } from '../role/role.module';
import { User } from '../user/entities/user.entity';
import { UserModule } from '../user/user.module';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { CoachCategory } from './entities/coach-category.entity';
import { GroupCategory } from './entities/group-category.entity';
import { UserInterest } from './entities/user-interest.entity';
import { UserOnboardingStep } from './entities/user-onboarding-step.entity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding Module
 *
 * The category list (migration 081) and the welcome flow a person sees
 * after their first sign in. The discovery queries (profile, group,
 * session) read the category links in SQL, so they need nothing from here
 * and the module graph stays one way: onboarding depends on profile, never
 * the reverse.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Category,
      UserInterest,
      CoachCategory,
      GroupCategory,
      UserOnboardingStep,
      User,
    ]),
    RoleModule,
    UserModule,
    ProfileModule,
  ],
  controllers: [CategoryController, OnboardingController],
  providers: [CategoryService, OnboardingService],
  exports: [CategoryService],
})
export class OnboardingModule {}
