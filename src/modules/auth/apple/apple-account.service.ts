import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

import { CryptoService } from '../../../common/services/crypto.service';
import { SocialAccount } from '../../user/entities/social-account.entity';
import { AppleIdentityService } from './apple-identity.service';
import type { AppleIdentity } from './apple-identity.service';

/**
 * What MotionHive keeps on a person's Apple link (`social_account`, provider
 * APPLE): the address Apple shared, whether it is a relay, and the newest
 * refresh token, encrypted. The token's only use is revoking the grant when
 * the account is deleted, which Apple asks of every app with Sign in with
 * Apple.
 *
 * Kept apart from AuthService so the account deletion module can revoke
 * without importing AuthModule (which imports it).
 */
@Injectable()
export class AppleAccountService {
  constructor(
    @InjectModel(SocialAccount)
    private readonly socialAccountModel: typeof SocialAccount,
    private readonly appleIdentity: AppleIdentityService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * After an Apple sign-in, inside its transaction: bring the link's email
   * and relay flag up to date (an Apple email can change; the `sub` never
   * does) and, when the code exchange gave one, store the new refresh token.
   */
  async recordSignIn(
    identity: AppleIdentity,
    refreshToken: string | null,
    transaction: Transaction,
  ): Promise<void> {
    const link = await this.socialAccountModel.findOne({
      where: { provider: 'APPLE', providerUserId: identity.sub },
      transaction,
    });
    if (!link) {
      return;
    }

    if (identity.email) {
      link.set('providerEmail', identity.email);
    }
    link.set('isPrivateEmail', identity.isPrivateEmail);

    if (refreshToken) {
      const key = this.encryptionKey();
      if (key) {
        link.set(
          'refreshTokenEnc',
          this.cryptoService.encrypt(refreshToken, key),
        );
        link.set('tokenClientId', identity.clientId);
      } else {
        this.logger.warn(
          'TOKEN_ENCRYPTION_KEY is missing or not 32 bytes; the Apple refresh token was not stored',
          'AppleAccountService',
        );
      }
    }

    await link.save({ transaction });
  }

  /**
   * Revoke every stored Apple grant of this person and forget the tokens.
   * Never throws: deleting an account must not wait on Apple. A token that
   * could not be revoked stays, so a later call (the erasure) tries again.
   */
  async revokeForUser(userId: string): Promise<void> {
    let links: SocialAccount[];
    try {
      links = await this.socialAccountModel.findAll({
        where: {
          userId,
          provider: 'APPLE',
          refreshTokenEnc: { [Op.ne]: null },
        },
      });
    } catch (err) {
      this.logFailure(userId, err);
      return;
    }
    if (links.length === 0) {
      return;
    }

    const key = this.encryptionKey();
    if (!key || !this.appleIdentity.canCallApple) {
      this.logger.warn(
        `Apple is not fully configured; ${links.length} Apple grant(s) of ${userId} not revoked`,
        'AppleAccountService',
      );
      return;
    }

    for (const link of links) {
      try {
        const refreshToken = this.cryptoService.decrypt(
          link.refreshTokenEnc as string,
          key,
        );
        await this.appleIdentity.revoke(
          refreshToken,
          link.tokenClientId as string,
        );
        link.set('refreshTokenEnc', null);
        link.set('tokenClientId', null);
        await link.save();
      } catch (err) {
        this.logFailure(userId, err);
      }
    }
  }

  private encryptionKey(): Buffer | null {
    return this.cryptoService.parseKey(
      this.configService.get<string>('TOKEN_ENCRYPTION_KEY'),
    );
  }

  private logFailure(userId: string, err: unknown): void {
    let message = 'unknown';
    if (err instanceof Error) {
      message = err.message;
    }
    this.logger.warn(
      `Could not revoke Apple sign-in for ${userId}: ${message}`,
      'AppleAccountService',
    );
  }
}
