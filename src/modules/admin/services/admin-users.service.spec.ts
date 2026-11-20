import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';
import { AuthService } from '../../auth/auth.service';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { InstructorClient } from '../../client/entities/instructor-client.entity';
import { Group } from '../../group/entities/group.entity';
import { Message } from '../../messaging/entities/message.entity';
import { StripeAccount } from '../../payment/entities/stripe-account.entity';
import { Post } from '../../post/entities/post.entity';
import { InstructorProfile } from '../../profile/entities/instructor-profile.entity';
import { Role } from '../../role/entities/role.entity';
import { UserRole } from '../../role/entities/user-role.entity';
import { RoleService } from '../../role/role.service';
import { SessionInstance } from '../../session/entities/session-instance.entity';
import { SessionParticipant } from '../../session/entities/session-participant.entity';
import { User } from '../../user/entities/user.entity';
import { ProgramAssignment } from '../../workout/entities/program-assignment.entity';
import { Program } from '../../workout/entities/program.entity';
import { WorkoutLog } from '../../workout/entities/workout-log.entity';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersService } from './admin-users.service';

const OTHER_MODELS = [
  UserRole,
  Role,
  InstructorProfile,
  Group,
  SessionInstance,
  InstructorClient,
  StripeAccount,
  RefreshToken,
  WorkoutLog,
  SessionParticipant,
  Message,
  ProgramAssignment,
  Program,
  Post,
];

describe('AdminUsersService staff protection', () => {
  let service: AdminUsersService;
  const save = jest.fn();
  const userModel = { findByPk: jest.fn() };
  const roleService = { userHasAnyRole: jest.fn() };
  const accountDeletionService = { scheduleOnRequest: jest.fn() };
  const audit = { record: jest.fn() };

  /** Which ids hold which global roles, as RoleService would answer. */
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
      Promise.resolve({ id, isActive: true, save }),
    );
    accountDeletionService.scheduleOnRequest.mockResolvedValue({
      scheduledFor: '2026-12-20',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: getModelToken(User), useValue: userModel },
        ...OTHER_MODELS.map((model) => ({
          provide: getModelToken(model),
          useValue: {},
        })),
        { provide: RoleService, useValue: roleService },
        { provide: AuthService, useValue: {} },
        { provide: AccountDeletionService, useValue: accountDeletionService },
        { provide: AdminAuditService, useValue: audit },
        {
          provide: WINSTON_MODULE_NEST_PROVIDER,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
    // The detail read after a change is not what these tests are about.
    jest
      .spyOn(service, 'getUserDetail')
      .mockResolvedValue(
        {} as Awaited<ReturnType<AdminUsersService['getUserDetail']>>,
      );
  });

  async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const body = (err as ForbiddenException).getResponse() as {
        messageKey: string;
      };
      return body.messageKey;
    }
    throw new Error('expected a refusal');
  }

  it('lets an ADMIN deactivate an ordinary account', async () => {
    roles['admin-1'] = ['ADMIN'];
    await service.updateStatus('admin-1', 'user-1', { isActive: false });
    expect(save).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });

  it('refuses an ADMIN acting on a SUPER_ADMIN or another ADMIN', async () => {
    roles['admin-1'] = ['ADMIN'];
    roles['super-1'] = ['SUPER_ADMIN'];
    roles['admin-2'] = ['ADMIN'];

    await expect(
      refusal(service.updateStatus('admin-1', 'super-1', { isActive: false })),
    ).resolves.toBe('admin.superAdminOnly');
    await expect(
      refusal(
        service.updateStatus('admin-1', 'admin-2', {
          forceEmailVerified: true,
        }),
      ),
    ).resolves.toBe('admin.superAdminOnly');
    await expect(
      refusal(service.scheduleDeletion('admin-1', 'super-1', 'a@b.c')),
    ).resolves.toBe('admin.superAdminOnly');

    expect(save).not.toHaveBeenCalled();
    expect(accountDeletionService.scheduleOnRequest).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets a SUPER_ADMIN act on an admin account', async () => {
    roles['super-1'] = ['SUPER_ADMIN'];
    roles['admin-2'] = ['ADMIN'];
    await service.updateStatus('super-1', 'admin-2', { unlock: true });
    expect(save).toHaveBeenCalled();
    await service.scheduleDeletion('super-1', 'admin-2', 'a@b.c');
    expect(accountDeletionService.scheduleOnRequest).toHaveBeenCalledWith(
      'admin-2',
      'a@b.c',
    );
  });

  it('refuses anyone acting on their own account, a SUPER_ADMIN included', async () => {
    roles['super-1'] = ['SUPER_ADMIN'];
    await expect(
      refusal(service.updateStatus('super-1', 'super-1', { isActive: false })),
    ).resolves.toBe('admin.notOnYourself');
    await expect(
      refusal(service.scheduleDeletion('super-1', 'super-1', 'a@b.c')),
    ).resolves.toBe('admin.notOnYourself');
    expect(save).not.toHaveBeenCalled();
  });
});
