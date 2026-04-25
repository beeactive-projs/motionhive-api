import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { RoleModule } from '../role/role.module';
import { UserModule } from '../user/user.module';

/**
 * Profile Module
 *
 * Manages the instructor profile. User location (country, city) and
 * identity (name, email) live on `user`. The legacy `user_profile`
 * (fitness/health) table was dropped in migration 027.
 *
 * Depends on RoleModule for assigning INSTRUCTOR role when activating,
 * and UserModule for unified profile updates.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([InstructorProfile]),
    RoleModule,
    UserModule,
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
