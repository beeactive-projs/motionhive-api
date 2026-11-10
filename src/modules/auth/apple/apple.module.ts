import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CryptoService } from '../../../common/services/crypto.service';
import { SocialAccount } from '../../user/entities/social-account.entity';
import { AppleAccountService } from './apple-account.service';
import { AppleIdentityService } from './apple-identity.service';

/**
 * Sign in with Apple: checking Apple's tokens and keeping (then revoking)
 * the grant. Imports nothing of ours, so both AuthModule and
 * AccountDeletionModule can use it without a cycle.
 */
@Module({
  imports: [SequelizeModule.forFeature([SocialAccount])],
  providers: [AppleIdentityService, AppleAccountService, CryptoService],
  exports: [AppleIdentityService, AppleAccountService],
})
export class AppleModule {}
