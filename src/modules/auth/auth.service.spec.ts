import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';

import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserService } from '../user/user.service';
import { RoleService } from '../role/role.service';
import { ProfileService } from '../profile/profile.service';
import { CustomerService } from '../payment/services/customer.service';
import { EmailService } from '../../common/services/email.service';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailVerifierService } from '../../common/services/email-verifier.service';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';
import { AccountDeletionService } from '../account-deletion/account-deletion.service';
import { AppleIdentityService } from './apple/apple-identity.service';
import { AppleAccountService } from './apple/apple-account.service';
import { FacebookIdentityService } from './facebook/facebook-identity.service';
import { ClientRequest } from '../client/entities/client-request.entity';
import { Invitation } from '../invitation/entities/invitation.entity';

// AuthService smoke tests — not exhaustive. The goal is to catch
// "login is completely broken" regressions, not to re-test bcrypt.
describe('AuthService (smoke)', () => {
  let service: AuthService;
  let userService: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    validatePassword: jest.Mock;
    claimLoginAttempt: jest.Mock;
    resetFailedAttempts: jest.Mock;
    generatePasswordResetToken: jest.Mock;
    generateEmailVerificationToken: jest.Mock;
  };
  let roleService: {
    assignRoleToUserByName: jest.Mock;
    getUserRoles: jest.Mock;
  };
  let profileService: {
    createInstructorProfileInTransaction: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };
  let refreshTokenModel: {
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  let sequelizeMock: { transaction: jest.Mock };
  let cryptoService: { hashToken: jest.Mock; generateToken: jest.Mock };
  let emailService: { sendEmailVerification: jest.Mock };
  let emailVerifier: { assertDeliverable: jest.Mock };
  let accountDeletion: { assertSignInAllowed: jest.Mock; restore: jest.Mock };
  let configService: { get: jest.Mock };

  const tx = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    userService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      validatePassword: jest.fn(),
      claimLoginAttempt: jest
        .fn()
        .mockResolvedValue({ allowed: true, failedAttempts: 1 }),
      resetFailedAttempts: jest.fn().mockResolvedValue(undefined),
      generatePasswordResetToken: jest.fn().mockResolvedValue('plain-token'),
      generateEmailVerificationToken: jest
        .fn()
        .mockResolvedValue('verify-token'),
    };
    roleService = {
      assignRoleToUserByName: jest.fn().mockResolvedValue(undefined),
      getUserRoles: jest.fn().mockResolvedValue([{ name: 'USER' }]),
    };
    profileService = {
      createInstructorProfileInTransaction: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('jwt.signed.token'),
      verify: jest.fn(),
    };
    refreshTokenModel = {
      create: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn().mockResolvedValue(1),
    };
    sequelizeMock = {
      transaction: jest.fn().mockResolvedValue(tx),
    };
    cryptoService = {
      hashToken: jest.fn((t: string) => `hashed:${t}`),
      generateToken: jest.fn().mockReturnValue('rand'),
    };
    emailService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
    };
    accountDeletion = {
      assertSignInAllowed: jest.fn().mockResolvedValue(undefined),
      restore: jest.fn(),
    };
    emailVerifier = {
      assertDeliverable: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
        if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
        if (key === 'JWT_EXPIRES_IN') return '2h';
        return undefined;
      }),
    };

    tx.commit.mockClear();
    tx.rollback.mockClear();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(RefreshToken), useValue: refreshTokenModel },
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: RoleService, useValue: roleService },
        { provide: ProfileService, useValue: profileService },
        {
          provide: CustomerService,
          useValue: {
            // Stubbed: real call lives in payment-module integration; here
            // we only assert AuthService swallows errors via its
            // fire-and-forget wrapper.
            linkGuestToUser: jest.fn().mockResolvedValue(0),
          },
        },
        { provide: ConfigService, useValue: configService },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: EmailService, useValue: emailService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: EmailVerifierService, useValue: emailVerifier },
        { provide: AccountDeletionService, useValue: accountDeletion },
        // Apple's own flow is covered in apple-sign-in.spec.ts.
        { provide: AppleIdentityService, useValue: {} },
        { provide: AppleAccountService, useValue: {} },
        // Facebook's own flow is covered in facebook-sign-in.spec.ts.
        { provide: FacebookIdentityService, useValue: {} },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    customerService = moduleRef.get(CustomerService);
    linkClientRequests = jest
      .spyOn(ClientRequest, 'update')
      .mockResolvedValue([0] as never);
    jest.spyOn(Invitation, 'count').mockResolvedValue(0 as never);
  });

  let customerService: { linkGuestToUser: jest.Mock };
  let linkClientRequests: jest.SpyInstance;

  describe('what was sent to an address joins the account only once it is proven', () => {
    it('links nothing at sign up: the email is only typed, not proven', async () => {
      userService.create.mockResolvedValue({
        id: 'u-1',
        email: 'victim@example.com',
        firstName: 'Not',
        lastName: 'Them',
        isEmailVerified: false,
      });

      await service.register({
        email: 'victim@example.com',
        password: 'StrongPass1!',
        firstName: 'Not',
        lastName: 'Them',
      } as never);

      expect(linkClientRequests).not.toHaveBeenCalled();
      expect(customerService.linkGuestToUser).not.toHaveBeenCalled();
    });

    it('links them when the link in the email is opened', async () => {
      const user = {
        id: 'u-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        language: 'en',
        isEmailVerified: false,
      };
      Object.assign(userService, {
        findByEmailVerificationToken: jest.fn().mockResolvedValue(user),
        markEmailVerified: jest.fn().mockResolvedValue(undefined),
      });
      Object.assign(emailService, {
        sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      });

      await service.verifyEmail({ token: 'verify-token' });

      expect(customerService.linkGuestToUser).toHaveBeenCalledWith(
        'u-1',
        'jane@example.com',
      );
      expect(linkClientRequests).toHaveBeenCalledWith(
        { toUserId: 'u-1' },
        expect.objectContaining({
          where: expect.objectContaining({ invitedEmail: 'jane@example.com' }),
        }),
      );
    });
  });

  it('register creates user, assigns USER role, and returns token pair', async () => {
    userService.create.mockResolvedValue({
      id: 'u-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailVerified: false,
    });

    const result = await service.register({
      email: 'jane@example.com',
      password: 'StrongPass1!',
      firstName: 'Jane',
      lastName: 'Doe',
    } as never);

    expect(userService.create).toHaveBeenCalledTimes(1);
    expect(roleService.assignRoleToUserByName).toHaveBeenCalledWith(
      'u-1',
      'USER',
      undefined,
      undefined,
      tx,
    );
    expect(tx.commit).toHaveBeenCalled();
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user).toMatchObject({
      id: 'u-1',
      email: 'jane@example.com',
      roles: ['USER'],
    });
  });

  it('login with correct password returns tokens and updates lastLoginAt', async () => {
    const userRow = {
      id: 'u-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      update: jest.fn().mockResolvedValue(undefined),
    };
    userService.findByEmail.mockResolvedValue(userRow);
    userService.validatePassword.mockResolvedValue(true);

    const result = await service.login({
      email: 'jane@example.com',
      password: 'StrongPass1!',
    });

    expect(userService.validatePassword).toHaveBeenCalledWith(
      userRow,
      'StrongPass1!',
    );
    expect(userRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ lastLoginAt: expect.any(Date) as unknown }),
    );
    expect(userService.resetFailedAttempts).toHaveBeenCalledWith(userRow);
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });

  it('login with wrong password counts the try and throws Unauthorized', async () => {
    const userRow = {
      id: 'u-1',
      email: 'jane@example.com',
      failedLoginAttempts: 1,
      lockedUntil: null,
    };
    userService.findByEmail.mockResolvedValue(userRow);
    userService.validatePassword.mockResolvedValue(false);

    await expect(
      service.login({ email: 'jane@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userService.claimLoginAttempt).toHaveBeenCalledWith('u-1');
    expect(userService.resetFailedAttempts).not.toHaveBeenCalled();
  });

  // The try is taken before the password is compared: parallel guesses
  // all passed the old read-then-check and wrote the same count.
  it('refuses a locked account without comparing the password', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60_000);
    userService.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'jane@example.com',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    userService.claimLoginAttempt.mockResolvedValueOnce({
      allowed: false,
      lockedUntil,
    });

    const attempt = service.login({
      email: 'jane@example.com',
      password: 'right',
    });

    await expect(attempt).rejects.toMatchObject({
      response: {
        messageKey: 'auth.accountLocked',
        messageParams: { minutes: 10 },
      },
    });
    expect(userService.validatePassword).not.toHaveBeenCalled();
  });

  it('clears the count on the right password, before a pending deletion can refuse', async () => {
    const userRow = {
      id: 'u-1',
      email: 'jane@example.com',
      failedLoginAttempts: 4,
      lockedUntil: null,
    };
    userService.findByEmail.mockResolvedValue(userRow);
    userService.validatePassword.mockResolvedValue(true);
    accountDeletion.assertSignInAllowed.mockRejectedValueOnce(
      new ForbiddenException('scheduled'),
    );

    await expect(
      service.login({ email: 'jane@example.com', password: 'right' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(userService.resetFailedAttempts).toHaveBeenCalledWith(userRow);
  });

  // NODE_ENV defaults to "development": on any server left on the default,
  // the reply carried the reset link, so one request took any account.
  it('never returns the reset link, whatever NODE_ENV says', async () => {
    const sendPasswordResetEmail = jest.fn().mockResolvedValue(undefined);
    Object.assign(emailService, { sendPasswordResetEmail });
    userService.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'jane@example.com',
      language: 'en',
    });

    const result = await service.forgotPassword({ email: 'jane@example.com' });

    expect(configService.get('NODE_ENV')).toBeUndefined();
    expect(result).not.toHaveProperty('resetLink');
    expect(JSON.stringify(result)).not.toContain('plain-token');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'plain-token',
      'en',
    );
  });

  it('asks about a pending deletion only once the password is proven', async () => {
    // Asking before the password check would tell anyone with an email
    // address that the account is being deleted.
    userService.findByEmail.mockResolvedValue({
      id: 'u-1',
      email: 'jane@example.com',
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    userService.validatePassword.mockResolvedValue(false);
    await expect(
      service.login({ email: 'jane@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accountDeletion.assertSignInAllowed).not.toHaveBeenCalled();

    userService.validatePassword.mockResolvedValue(true);
    accountDeletion.assertSignInAllowed.mockRejectedValueOnce(
      new ForbiddenException('scheduled'),
    );
    await expect(
      service.login({ email: 'jane@example.com', password: 'right' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(refreshTokenModel.create).not.toHaveBeenCalled();
  });

  it('refreshAccessToken throws when the refresh token is not in the DB (revoked)', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'u-1',
      email: 'jane@example.com',
      iat: Math.floor(Date.now() / 1000),
    });
    userService.findById.mockResolvedValue({
      id: 'u-1',
      email: 'jane@example.com',
      isActive: true,
      passwordChangedAt: null,
    });
    // Simulate a token that was revoked — findOne returns null.
    refreshTokenModel.findOne.mockResolvedValue(null);

    await expect(
      service.refreshAccessToken('some.jwt.token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('refresh token rotation', () => {
    const now = Date.now();

    function storedToken(fields: Record<string, unknown>) {
      const row: Record<string, unknown> = {
        id: 't-1',
        familyId: 'f-1',
        expiresAt: new Date(now + 86_400_000),
        revokedAt: null,
        replacedById: null,
        ...fields,
      };
      row.reload = jest.fn().mockResolvedValue(row);
      return row;
    }

    beforeEach(() => {
      jwtService.verify.mockReturnValue({
        sub: 'u-1',
        email: 'jane@example.com',
        typ: 'refresh',
        iat: Math.floor(now / 1000),
      });
      userService.findById.mockResolvedValue({
        id: 'u-1',
        email: 'jane@example.com',
        isActive: true,
        passwordChangedAt: null,
      });
      sequelizeMock.transaction.mockImplementation((work: unknown) => {
        if (typeof work === 'function') {
          return (work as (t: unknown) => Promise<unknown>)(tx);
        }
        return Promise.resolve(tx);
      });
    });

    it('claims the old token and names its successor, in one transaction', async () => {
      refreshTokenModel.findOne.mockResolvedValue(storedToken({}));
      refreshTokenModel.update.mockResolvedValue([1]);

      const result = await service.refreshAccessToken('old.refresh.token');

      expect(result).toHaveProperty('refreshToken');
      const [values, options] = refreshTokenModel.update.mock.calls[0] as [
        { revokedAt: Date; replacedById: string },
        { where: Record<string, unknown>; transaction: unknown },
      ];
      expect(options).toEqual({
        where: { id: 't-1', revokedAt: null },
        transaction: tx,
      });
      const [row] = refreshTokenModel.create.mock.calls[0] as [
        { id: string; familyId: string },
      ];
      expect(row.id).toBe(values.replacedById);
      expect(row.familyId).toBe('f-1');
      // Unique per token, and never usable as an access token.
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ typ: 'refresh', jti: row.id }),
        expect.anything(),
      );
    });

    // Two tabs, or a retry after a lost answer: the second refresh a moment
    // later must not sign the person out.
    it('gives a second refresh a moment later its own pair in the same sign in', async () => {
      const row = storedToken({});
      row.reload = jest.fn(() => {
        row.revokedAt = new Date(now - 1_000);
        row.replacedById = 't-2';
        return Promise.resolve(row);
      });
      refreshTokenModel.findOne.mockResolvedValue(row);
      refreshTokenModel.update.mockResolvedValue([0]);

      await expect(
        service.refreshAccessToken('old.refresh.token'),
      ).resolves.toHaveProperty('accessToken');

      expect(refreshTokenModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'f-1' }),
        expect.anything(),
      );
    });

    // A stolen token kept rotating for the thief while the person was
    // simply signed out.
    it('ends the whole sign in when a rotated token comes back later', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({
          revokedAt: new Date(now - 5 * 60_000),
          replacedById: 't-2',
        }),
      );

      await expect(
        service.refreshAccessToken('old.refresh.token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(refreshTokenModel.update).toHaveBeenCalledWith(
        { revokedAt: expect.any(Date) as unknown },
        { where: { familyId: 'f-1', revokedAt: null } },
      );
      expect(refreshTokenModel.create).not.toHaveBeenCalled();
    });

    it('lets no old token undo a sign out made a moment after a rotation', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({ revokedAt: new Date(now - 1_000), replacedById: 't-2' }),
      );
      refreshTokenModel.count.mockResolvedValue(0);

      await expect(
        service.refreshAccessToken('old.refresh.token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokenModel.create).not.toHaveBeenCalled();
    });

    it('refuses a signed out token without touching the rest', async () => {
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({ revokedAt: new Date(now - 5 * 60_000) }),
      );

      await expect(
        service.refreshAccessToken('old.refresh.token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokenModel.update).not.toHaveBeenCalled();
    });

    it('refuses a narrower token signed with the same secret', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'u-1',
        typ: 'account-restore',
        iat: Math.floor(now / 1000),
      });

      await expect(
        service.refreshAccessToken('restore.ticket'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(refreshTokenModel.findOne).not.toHaveBeenCalled();
    });

    it('reads a token from before families as its own family', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'u-1',
        email: 'jane@example.com',
        iat: Math.floor(now / 1000),
      });
      refreshTokenModel.findOne.mockResolvedValue(
        storedToken({ id: 't-old', familyId: null }),
      );
      refreshTokenModel.update.mockResolvedValue([1]);

      await service.refreshAccessToken('old.refresh.token');

      expect(refreshTokenModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 't-old' }),
        expect.anything(),
      );
    });
  });
});
