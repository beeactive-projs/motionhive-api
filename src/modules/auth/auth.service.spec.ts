import { UnauthorizedException } from '@nestjs/common';
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
import { EmailService } from '../../common/services/email.service';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailVerifierService } from '../../common/services/email-verifier.service';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

// AuthService smoke tests — not exhaustive. The goal is to catch
// "login is completely broken" regressions, not to re-test bcrypt.
describe('AuthService (smoke)', () => {
  let service: AuthService;
  let userService: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    validatePassword: jest.Mock;
    isAccountLocked: jest.Mock;
    incrementFailedAttempts: jest.Mock;
    resetFailedAttempts: jest.Mock;
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
  };
  let sequelizeMock: { transaction: jest.Mock };
  let cryptoService: { hashToken: jest.Mock; generateToken: jest.Mock };
  let emailService: { sendEmailVerification: jest.Mock };
  let emailVerifier: { assertDeliverable: jest.Mock };
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
      isAccountLocked: jest.fn().mockReturnValue(false),
      incrementFailedAttempts: jest.fn().mockResolvedValue(undefined),
      resetFailedAttempts: jest.fn().mockResolvedValue(undefined),
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
        { provide: ConfigService, useValue: configService },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: EmailService, useValue: emailService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: EmailVerifierService, useValue: emailVerifier },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
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
    } as never);

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

  it('login with wrong password increments failed attempts and throws Unauthorized', async () => {
    const userRow = {
      id: 'u-1',
      email: 'jane@example.com',
      failedLoginAttempts: 1,
      lockedUntil: null,
    };
    userService.findByEmail.mockResolvedValue(userRow as never);
    userService.validatePassword.mockResolvedValue(false);

    await expect(
      service.login({ email: 'jane@example.com', password: 'wrong' } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userService.incrementFailedAttempts).toHaveBeenCalledWith(userRow);
    expect(userService.resetFailedAttempts).not.toHaveBeenCalled();
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
});
