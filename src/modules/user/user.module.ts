import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from './entities/user.entity';
import { SocialAccount } from './entities/social-account.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { CryptoService } from '../../common/services';
import { CloudinaryService } from '../../common/services/cloudinary.service';

/**
 * User Module
 *
 * Modules in NestJS are like containers that group related code together.
 * Think of them as "packages" or "namespaces".
 *
 * This module:
 * - imports: Sequelize models this module needs
 * - controllers: HTTP endpoints (routes)
 * - providers: Services (business logic)
 * - exports: What other modules can use
 */
@Module({
  imports: [SequelizeModule.forFeature([User, SocialAccount])],
  controllers: [UserController],
  providers: [
    UserService,
    CryptoService, // Provide CryptoService for token hashing
    CloudinaryService, // Used by UserService.uploadAvatar
  ],
  exports: [UserService], // Export UserService so AuthModule can use it
})
export class UserModule {}
