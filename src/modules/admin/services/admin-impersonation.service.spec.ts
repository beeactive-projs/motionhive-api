import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { AuthService } from '../../auth/auth.service';
import { RoleService } from '../../role/role.service';
import { User } from '../../user/entities/user.entity';
import { AdminImpersonationLog } from '../entities/admin-impersonation-log.entity';
import { AdminImpersonationService } from './admin-impersonation.service';

describe('AdminImpersonationService', () => {
  let service: AdminImpersonationService;
  const userModel = { findByPk: jest.fn() };
  const logModel = { create: jest.fn() };
  const authService = { mintImpersonationToken: jest.fn() };
  const roleService = { userHasAnyRole: jest.fn() };
  const sequelize = {
    transaction: jest.fn((work: (tx: object) => unknown) => work({})),
  };

  let roles: Record<string, string[]>;

  beforeEach(async () => {
    jest.clearAllMocks();
    roles = {};
    roleService.userHasAnyRole.mockImplementation(
      (userId: string, names: string[]) =>
        Promise.resolve(
          (roles[userId] ?? []).some((name) => names.includes(name)),
        ),
    );
    userModel.findByPk.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        email: `${id}@example.com`,
        firstName: 'A',
        lastName: 'B',
        isActive: true,
      }),
    );
    authService.mintImpersonationToken.mockReturnValue({
      accessToken: 'token',
      expiresIn: '30m',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminImpersonationService,
        { provide: getModelToken(User), useValue: userModel },
        { provide: getModelToken(AdminImpersonationLog), useValue: logModel },
        { provide: Sequelize, useValue: sequelize },
        { provide: AuthService, useValue: authService },
        { provide: RoleService, useValue: roleService },
        {
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(AdminImpersonationService);
  });

  it('mints a token for an ordinary account and audits it', async () => {
    await expect(
      service.impersonate('super-1', 'user-1', 'bug report', null),
    ).resolves.toMatchObject({ accessToken: 'token' });
    expect(logModel.create).toHaveBeenCalled();
  });

  it.each(['SUPER_ADMIN', 'ADMIN', 'SUPPORT'])(
    'never impersonates a %s account',
    async (role) => {
      roles['staff-1'] = [role];
      await expect(
        service.impersonate('super-1', 'staff-1', 'reason', null),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(authService.mintImpersonationToken).not.toHaveBeenCalled();
      expect(logModel.create).not.toHaveBeenCalled();
    },
  );
});
