import { ConflictException } from '@nestjs/common';

import { UserService } from './user.service';
import type { OAuthProfile } from './user.service';

/**
 * Who a social sign-in lands on: the link it already has, an account with
 * the same email (only when the provider vouches for it), or a new account.
 * Email is matched without regard to letter case.
 */
describe('UserService.findOrCreateFromOAuth', () => {
  const tx = { id: 'tx' };

  function setup() {
    const userModel = {
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((fields: Record<string, unknown>) =>
        Promise.resolve({ id: 'new-user', ...fields }),
      ),
    };
    const socialAccountModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    };
    // Enough of Sequelize to see the lookup's shape.
    const sequelize = {
      where: (left: unknown, right: unknown) => ({ left, right }),
      fn: (name: string, arg: unknown) => ({ fn: name, arg }),
      col: (name: string) => ({ col: name }),
    };
    const searchIndexService = { upsertUser: jest.fn() };
    const service = new UserService(
      userModel as never,
      socialAccountModel as never,
      sequelize as never,
      undefined as never,
      undefined as never,
      undefined as never,
      searchIndexService as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    return { service, userModel, socialAccountModel };
  }

  const profile = (fields: Partial<OAuthProfile> = {}): OAuthProfile => ({
    providerUserId: 'apple-sub',
    email: 'Ana@Example.com',
    emailVerified: true,
    firstName: 'Ana',
    lastName: 'Popescu',
    ...fields,
  });

  it('returns the account a link already points at', async () => {
    const { service, socialAccountModel, userModel } = setup();
    const ana = { id: 'u-ana' };
    socialAccountModel.findOne.mockResolvedValue({ user: ana });

    const found = await service.findOrCreateFromOAuth(
      'APPLE',
      profile(),
      tx as never,
    );

    expect(found).toEqual({ user: ana, isNewUser: false });
    expect(userModel.findOne).not.toHaveBeenCalled();
  });

  it('looks the email up in lowercase against lower(email)', async () => {
    const { service, userModel } = setup();

    await service.findByEmail('  Ana@Example.COM ');

    const [options] = userModel.findOne.mock.calls[0] as [{ where: unknown }];
    expect(options.where).toEqual({
      left: { fn: 'lower', arg: { col: 'email' } },
      right: 'ana@example.com',
    });
  });

  it('joins an account with the same email when the provider vouches for it', async () => {
    const { service, userModel, socialAccountModel } = setup();
    userModel.findOne.mockResolvedValue({
      id: 'u-ana',
      passwordHash: 'hash',
      isEmailVerified: true,
    });

    const found = await service.findOrCreateFromOAuth(
      'GOOGLE',
      profile(),
      tx as never,
    );

    expect(found.isNewUser).toBe(false);
    expect(socialAccountModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-ana', provider: 'GOOGLE' }),
      { transaction: tx },
    );
  });

  it('refuses to join an account by an email the provider did not vouch for', async () => {
    const { service, userModel, socialAccountModel } = setup();
    userModel.findOne.mockResolvedValue({
      id: 'u-ana',
      passwordHash: null,
      isEmailVerified: true,
    });

    const attempt = service.findOrCreateFromOAuth(
      'FACEBOOK',
      profile({ emailVerified: false }),
      tx as never,
    );

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({
      response: {
        messageKey: 'user.providerEmailUnverified',
        messageParams: { provider: 'Facebook' },
      },
    });
    expect(socialAccountModel.create).not.toHaveBeenCalled();
  });

  it('still refuses an unverified password account', async () => {
    const { service, userModel } = setup();
    userModel.findOne.mockResolvedValue({
      id: 'u-ana',
      passwordHash: 'hash',
      isEmailVerified: false,
    });

    await expect(
      service.findOrCreateFromOAuth('APPLE', profile(), tx as never),
    ).rejects.toMatchObject({
      response: { messageKey: 'user.verifyBeforeLinking' },
    });
  });

  it('makes a new account with the email in lowercase, verified as far as the provider said', async () => {
    const { service, userModel, socialAccountModel } = setup();

    const found = await service.findOrCreateFromOAuth(
      'APPLE',
      profile({ emailVerified: false }),
      tx as never,
    );

    expect(found.isNewUser).toBe(true);
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@example.com',
        passwordHash: null,
        isEmailVerified: false,
        firstName: 'Ana',
      }),
      { transaction: tx },
    );
    expect(socialAccountModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'new-user',
        provider: 'APPLE',
        providerUserId: 'apple-sub',
      }),
      { transaction: tx },
    );
  });
});
