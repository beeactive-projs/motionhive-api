import type { ConfigService } from '@nestjs/config';

import { CryptoService } from '../../../common/services/crypto.service';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';
import { AppleAccountService } from './apple-account.service';
import type { AppleIdentity } from './apple-identity.service';

const KEY = Buffer.alloc(32, 3);

/** A social_account row whose set/save behave like a model's. */
function makeLink(fields: Record<string, unknown> = {}) {
  const link: Record<string, unknown> & { set: jest.Mock; save: jest.Mock } = {
    providerEmail: 'old@privaterelay.appleid.com',
    refreshTokenEnc: null,
    tokenClientId: null,
    isPrivateEmail: null,
    ...fields,
    set: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  };
  link.set.mockImplementation((field: string, value: unknown) => {
    link[field] = value;
  });
  return link;
}

describe('AppleAccountService', () => {
  const crypto = new CryptoService();
  const tx = { id: 'tx' };
  let env: Record<string, string | undefined>;
  let socialAccountModel: { findOne: jest.Mock; findAll: jest.Mock };
  let appleIdentity: { canCallApple: boolean; revoke: jest.Mock };
  let service: AppleAccountService;

  const identity: AppleIdentity = {
    sub: 'apple-sub',
    clientId: 'fit.motionhive.app',
    email: 'new@privaterelay.appleid.com',
    emailVerified: true,
    isPrivateEmail: true,
  };

  beforeEach(() => {
    env = { TOKEN_ENCRYPTION_KEY: KEY.toString('base64') };
    socialAccountModel = { findOne: jest.fn(), findAll: jest.fn() };
    appleIdentity = {
      canCallApple: true,
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    service = new AppleAccountService(
      socialAccountModel as never,
      appleIdentity as never,
      crypto,
      { get: (key: string) => env[key] } as unknown as ConfigService,
      makeSilentLogger(),
    );
  });

  describe('recordSignIn', () => {
    it('updates the email and relay flag and stores the token encrypted, with its client', async () => {
      const link = makeLink();
      socialAccountModel.findOne.mockResolvedValue(link);

      await service.recordSignIn(identity, 'r-token', tx as never);

      expect(socialAccountModel.findOne).toHaveBeenCalledWith({
        where: { provider: 'APPLE', providerUserId: 'apple-sub' },
        transaction: tx,
      });
      expect(link.providerEmail).toBe('new@privaterelay.appleid.com');
      expect(link.isPrivateEmail).toBe(true);
      expect(link.tokenClientId).toBe('fit.motionhive.app');
      expect(link.refreshTokenEnc).not.toContain('r-token');
      expect(crypto.decrypt(link.refreshTokenEnc as string, KEY)).toBe(
        'r-token',
      );
      expect(link.save).toHaveBeenCalledWith({ transaction: tx });
    });

    it('keeps the token held when this sign-in brought none', async () => {
      const link = makeLink({
        refreshTokenEnc: 'v1.kept',
        tokenClientId: 'fit.motionhive.web',
      });
      socialAccountModel.findOne.mockResolvedValue(link);

      await service.recordSignIn(identity, null, tx as never);

      expect(link.refreshTokenEnc).toBe('v1.kept');
      expect(link.tokenClientId).toBe('fit.motionhive.web');
    });

    it('stores no token without a usable encryption key', async () => {
      env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(8).toString('base64');
      const link = makeLink();
      socialAccountModel.findOne.mockResolvedValue(link);

      await service.recordSignIn(identity, 'r-token', tx as never);

      expect(link.refreshTokenEnc).toBeNull();
      expect(link.isPrivateEmail).toBe(true);
    });
  });

  describe('revokeForUser', () => {
    it('revokes each stored grant with its own client and forgets the token', async () => {
      const link = makeLink({
        refreshTokenEnc: crypto.encrypt('r-token', KEY),
        tokenClientId: 'fit.motionhive.web',
      });
      socialAccountModel.findAll.mockResolvedValue([link]);

      await service.revokeForUser('user-1');

      expect(appleIdentity.revoke).toHaveBeenCalledWith(
        'r-token',
        'fit.motionhive.web',
      );
      expect(link.refreshTokenEnc).toBeNull();
      expect(link.tokenClientId).toBeNull();
      expect(link.save).toHaveBeenCalled();
    });

    it('keeps the token for a later try when Apple refuses, without throwing', async () => {
      const sealed = crypto.encrypt('r-token', KEY);
      const link = makeLink({
        refreshTokenEnc: sealed,
        tokenClientId: 'fit.motionhive.app',
      });
      socialAccountModel.findAll.mockResolvedValue([link]);
      appleIdentity.revoke.mockRejectedValue(new Error('HTTP 503'));

      await expect(service.revokeForUser('user-1')).resolves.toBeUndefined();

      expect(link.refreshTokenEnc).toBe(sealed);
      expect(link.save).not.toHaveBeenCalled();
    });

    it('asks Apple nothing when the key that signs requests is not set', async () => {
      appleIdentity.canCallApple = false;
      socialAccountModel.findAll.mockResolvedValue([
        makeLink({
          refreshTokenEnc: crypto.encrypt('r-token', KEY),
          tokenClientId: 'x',
        }),
      ]);

      await service.revokeForUser('user-1');

      expect(appleIdentity.revoke).not.toHaveBeenCalled();
    });

    it('does nothing for someone who never signed in with Apple', async () => {
      socialAccountModel.findAll.mockResolvedValue([]);

      await service.revokeForUser('user-1');

      expect(appleIdentity.revoke).not.toHaveBeenCalled();
    });
  });
});
