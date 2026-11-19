import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';

import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';
import { ClientRequest } from '../client/entities/client-request.entity';
import { Invitation } from '../invitation/entities/invitation.entity';
import { AuthService } from './auth.service';
import { AppleTokenError } from './apple/apple-identity.service';
import type { AppleIdentity } from './apple/apple-identity.service';
import type { AppleAuthDto } from './dto/apple-auth.dto';

/**
 * POST /auth/apple: the token is checked first, the code traded outside
 * the transaction, and what Apple gave is stored inside it. A failed trade
 * never blocks the sign-in.
 */
describe('AuthService.registerWithApple', () => {
  const tx = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const identity: AppleIdentity = {
    sub: 'apple-sub',
    clientId: 'fit.motionhive.app',
    email: 'x2k9q7f4mz@privaterelay.appleid.com',
    emailVerified: true,
    isPrivateEmail: true,
  };
  const dto: AppleAuthDto = {
    identityToken: 'apple.identity.token',
    rawNonce: 'n'.repeat(64),
    authorizationCode: 'code-1',
    firstName: '  Ana ',
    lastName: 'Popescu',
    language: 'ro',
  };

  let userService: {
    findOrCreateFromOAuth: jest.Mock;
    updateUser: jest.Mock;
  };
  let appleIdentity: {
    isAvailable: boolean;
    verifyIdentityToken: jest.Mock;
    exchangeCode: jest.Mock;
  };
  let appleAccounts: { recordSignIn: jest.Mock };
  let accountDeletion: { assertSignInAllowed: jest.Mock };
  let roleService: {
    assignRoleToUserByName: jest.Mock;
    getUserRoles: jest.Mock;
  };
  let refreshTokenModel: { create: jest.Mock };
  let linkClientRequests: jest.SpyInstance;
  let service: AuthService;

  const newUser = {
    id: 'u-new',
    email: identity.email,
    firstName: 'Ana',
    lastName: 'Popescu',
    isEmailVerified: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    linkClientRequests = jest
      .spyOn(ClientRequest, 'update')
      .mockResolvedValue([0] as never);
    jest.spyOn(Invitation, 'count').mockResolvedValue(0 as never);

    userService = {
      findOrCreateFromOAuth: jest
        .fn()
        .mockResolvedValue({ user: { ...newUser }, isNewUser: true }),
      updateUser: jest.fn(),
    };
    appleIdentity = {
      isAvailable: true,
      verifyIdentityToken: jest.fn().mockResolvedValue(identity),
      exchangeCode: jest
        .fn()
        .mockResolvedValue({ status: 'ok', refreshToken: 'r-token' }),
    };
    appleAccounts = { recordSignIn: jest.fn().mockResolvedValue(undefined) };
    accountDeletion = {
      assertSignInAllowed: jest.fn().mockResolvedValue(undefined),
    };
    roleService = {
      assignRoleToUserByName: jest.fn().mockResolvedValue(undefined),
      getUserRoles: jest.fn().mockResolvedValue([{ name: 'USER' }]),
    };
    refreshTokenModel = { create: jest.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      refreshTokenModel as never,
      userService as never,
      { sign: jest.fn().mockReturnValue('jwt.signed') } as never,
      roleService as never,
      undefined as never,
      { linkGuestToUser: jest.fn().mockResolvedValue(undefined) } as never,
      { get: () => undefined } as never,
      { transaction: jest.fn().mockResolvedValue(tx) } as never,
      undefined as never,
      { hashToken: (t: string) => `hashed:${t}` } as never,
      undefined as never,
      accountDeletion as never,
      appleIdentity as never,
      appleAccounts as never,
      makeSilentLogger(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('makes the account with the name Apple shared and stores the grant in the same transaction', async () => {
    const result = await service.registerWithApple(dto);

    expect(appleIdentity.verifyIdentityToken).toHaveBeenCalledWith(
      'apple.identity.token',
      'n'.repeat(64),
    );
    expect(appleIdentity.exchangeCode).toHaveBeenCalledWith('code-1', identity);
    expect(userService.findOrCreateFromOAuth).toHaveBeenCalledWith(
      'APPLE',
      {
        providerUserId: 'apple-sub',
        email: identity.email,
        emailVerified: true,
        firstName: 'Ana',
        lastName: 'Popescu',
        language: 'ro',
      },
      tx,
    );
    expect(appleAccounts.recordSignIn).toHaveBeenCalledWith(
      identity,
      'r-token',
      tx,
    );
    expect(tx.commit).toHaveBeenCalled();
    expect(result.user).toMatchObject({
      id: 'u-new',
      firstName: 'Ana',
      roles: ['USER'],
    });
    expect(result.accessToken).toBe('jwt.signed');
  });

  it('trades the code before the transaction opens', async () => {
    const transaction = (
      service as unknown as { sequelize: { transaction: jest.Mock } }
    ).sequelize.transaction;

    await service.registerWithApple(dto);

    expect(appleIdentity.exchangeCode.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0],
    );
  });

  it('still signs in when the code could not be traded, storing no token', async () => {
    appleIdentity.exchangeCode.mockResolvedValue({
      status: 'failed',
      reason: 'HTTP 503',
    });

    const result = await service.registerWithApple(dto);

    expect(result.accessToken).toBe('jwt.signed');
    expect(appleAccounts.recordSignIn).toHaveBeenCalledWith(identity, null, tx);
  });

  it('names an account with no shared name like the other providers do', async () => {
    await service.registerWithApple({
      ...dto,
      firstName: undefined,
      lastName: undefined,
    });

    const [, profile] = userService.findOrCreateFromOAuth.mock.calls[0] as [
      string,
      { firstName: string; lastName: string },
    ];
    expect(profile.firstName).toBe('User');
    expect(profile.lastName).toBe('');
  });

  it('strips markup from the name', async () => {
    await service.registerWithApple({ ...dto, firstName: '<b>Ana</b>' });

    const [, profile] = userService.findOrCreateFromOAuth.mock.calls[0] as [
      string,
      { firstName: string },
    ];
    expect(profile.firstName).toBe('Ana');
  });

  it('fills in a name an earlier attempt could not save', async () => {
    userService.findOrCreateFromOAuth.mockResolvedValue({
      user: { ...newUser, id: 'u-1', firstName: 'User', lastName: '' },
      isNewUser: false,
    });
    userService.updateUser.mockResolvedValue({ ...newUser, id: 'u-1' });

    const result = await service.registerWithApple(dto);

    expect(userService.updateUser).toHaveBeenCalledWith(
      'u-1',
      { firstName: 'Ana', lastName: 'Popescu' },
      tx,
    );
    expect(result.user.firstName).toBe('Ana');
  });

  it('never overwrites a name the person set', async () => {
    userService.findOrCreateFromOAuth.mockResolvedValue({
      user: { ...newUser, id: 'u-1', firstName: 'Anca', lastName: 'P.' },
      isNewUser: false,
    });

    await service.registerWithApple(dto);

    expect(userService.updateUser).not.toHaveBeenCalled();
  });

  it('answers a returning account in its deletion cooling-off with the offer to keep it', async () => {
    userService.findOrCreateFromOAuth.mockResolvedValue({
      user: { ...newUser, id: 'u-1' },
      isNewUser: false,
    });
    accountDeletion.assertSignInAllowed.mockRejectedValue(
      new ForbiddenException('scheduled'),
    );

    await expect(service.registerWithApple(dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(refreshTokenModel.create).not.toHaveBeenCalled();
  });

  it('says Apple is unavailable when it is not configured', async () => {
    appleIdentity.isAvailable = false;

    await expect(service.registerWithApple(dto)).rejects.toMatchObject({
      response: {
        messageKey: 'auth.providerUnavailable',
        messageParams: { provider: 'Apple' },
      },
    });
    expect(appleIdentity.verifyIdentityToken).not.toHaveBeenCalled();
  });

  it('refuses a token that fails a check, without saying which', async () => {
    appleIdentity.verifyIdentityToken.mockRejectedValue(
      new AppleTokenError('Nonce mismatch'),
    );

    const attempt = service.registerWithApple(dto);

    await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(attempt).rejects.toMatchObject({
      response: { messageKey: 'auth.providerSignInFailed' },
    });
    expect(appleIdentity.exchangeCode).not.toHaveBeenCalled();
  });

  it('refuses a sign-in that shared no email', async () => {
    appleIdentity.verifyIdentityToken.mockResolvedValue({
      ...identity,
      email: null,
    });

    await expect(service.registerWithApple(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not trade anything when no code came', async () => {
    await service.registerWithApple({ ...dto, authorizationCode: undefined });

    expect(appleIdentity.exchangeCode).not.toHaveBeenCalled();
    expect(appleAccounts.recordSignIn).toHaveBeenCalledWith(identity, null, tx);
  });

  it('links invitations sent to the address before the account existed', async () => {
    await service.registerWithApple(dto);

    expect(linkClientRequests).toHaveBeenCalledWith(
      { toUserId: 'u-new' },
      expect.objectContaining({
        where: expect.objectContaining({ invitedEmail: identity.email }),
      }),
    );
  });
});
