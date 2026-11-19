/* eslint-disable @typescript-eslint/unbound-method -- jest assertion idiom expects on the mock spy reference; safe in tests. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { InvitationService } from './invitation.service';
import { Invitation } from './entities/invitation.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { GroupService } from '../group/group.service';
import { RoleService } from '../role/role.service';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailService } from '../../common/services/email.service';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import {
  makeModelMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../test/helpers/sequelize-mocks';
import { notificationText } from '../../../test/helpers/notification-text';

/**
 * Smoke coverage for the group-invitation flow. Owner sends, invitee
 * accepts/declines. Token validation + email-binding are the
 * load-bearing security checks; we cover those plus the lifecycle
 * guards (expired, already responded).
 */
describe('InvitationService', () => {
  let service: InvitationService;
  let invitationModel: ModelMock;
  let memberModel: ModelMock;
  let groupService: {
    assertOwnerAndGet: jest.Mock;
    addMember: jest.Mock;
  };
  let roleService: { findByName: jest.Mock; assignRoleToUser: jest.Mock };
  let cryptoService: { generateToken: jest.Mock; hashToken: jest.Mock };
  let emailService: {
    sendInvitationEmail: jest.Mock;
    sendInvitationAcceptedEmail: jest.Mock;
  };
  let notificationService: { notify: jest.Mock; notifyMany: jest.Mock };
  let instructorClientModel: ModelMock;
  let configService: { get: jest.Mock };

  const tx = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const sequelize = { transaction: jest.fn().mockResolvedValue(tx) };

  beforeEach(async () => {
    tx.commit.mockClear();
    tx.rollback.mockClear();
    sequelize.transaction.mockClear();
    sequelize.transaction.mockResolvedValue(tx);

    invitationModel = makeModelMock();
    memberModel = makeModelMock();
    groupService = {
      assertOwnerAndGet: jest
        .fn()
        .mockResolvedValue({ id: 'g-1', name: 'Yoga Wednesdays' }),
      addMember: jest.fn().mockResolvedValue(undefined),
    };
    roleService = {
      findByName: jest.fn().mockResolvedValue({ id: 'role-user' }),
      assignRoleToUser: jest.fn().mockResolvedValue(undefined),
    };
    cryptoService = {
      generateToken: jest.fn().mockReturnValue('plain-token'),
      hashToken: jest.fn().mockReturnValue('hashed-token'),
    };
    emailService = {
      sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
      sendInvitationAcceptedEmail: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = {
      notify: jest.fn().mockResolvedValue(undefined),
      notifyMany: jest.fn().mockResolvedValue(undefined),
    };
    instructorClientModel = makeModelMock();
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'FRONTEND_URL') return 'https://app.test';
        if (key === 'NODE_ENV') return 'test';
        return null;
      }),
    };

    // Default stubs for the static User helpers used by the service.
    jest
      .spyOn(User, 'findByPk')
      .mockResolvedValue({ firstName: 'Iris', lastName: 'Inst' } as User);
    jest.spyOn(User, 'findOne').mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationService,
        { provide: getModelToken(Invitation), useValue: invitationModel },
        { provide: getModelToken(GroupMember), useValue: memberModel },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        { provide: Sequelize, useValue: sequelize },
        { provide: GroupService, useValue: groupService },
        { provide: RoleService, useValue: roleService },
        { provide: CryptoService, useValue: cryptoService },
        { provide: EmailService, useValue: emailService },
        { provide: NotificationService, useValue: notificationService },
        { provide: ConfigService, useValue: configService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(InvitationService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =====================================================================
  // create
  // =====================================================================
  describe('create', () => {
    it('rejects when caller is not the group owner (delegates to GroupService)', async () => {
      groupService.assertOwnerAndGet.mockRejectedValue(
        new ForbiddenException('Only the group owner can do this'),
      );

      await expect(
        service.create('not-owner', {
          groupId: 'g-1',
          email: 'invitee@x.com',
          roleName: 'USER',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects when invitee is already a member', async () => {
      memberModel.findOne.mockResolvedValue({ id: 'm-existing' });

      await expect(
        service.create('owner-1', {
          groupId: 'g-1',
          email: 'invitee@x.com',
          roleName: 'USER',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when an active invitation already exists', async () => {
      memberModel.findOne.mockResolvedValue(null);
      invitationModel.findOne.mockResolvedValue({
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(
        service.create('owner-1', {
          groupId: 'g-1',
          email: 'invitee@x.com',
          roleName: 'USER',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('gives the USER role and no other, whatever the body asks for', async () => {
      memberModel.findOne.mockResolvedValue(null);
      invitationModel.findOne.mockResolvedValue(null);
      invitationModel.create.mockResolvedValue({ id: 'inv-2' });

      await service.create('owner-1', {
        groupId: 'g-1',
        email: 'invitee@x.com',
        // What the DTO now refuses; the service ignores it either way.
        roleName: 'SUPER_ADMIN',
      });

      expect(roleService.findByName).toHaveBeenCalledWith('USER');
      expect(roleService.findByName).not.toHaveBeenCalledWith('SUPER_ADMIN');
      expect(invitationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: 'role-user' }),
      );
    });

    it('creates an invitation, emails the invitee, and returns the link', async () => {
      memberModel.findOne.mockResolvedValue(null);
      invitationModel.findOne.mockResolvedValue(null);
      const created = { id: 'inv-1', email: 'invitee@x.com' };
      invitationModel.create.mockResolvedValue(created);

      const result = await service.create('owner-1', {
        groupId: 'g-1',
        email: 'invitee@x.com',
        roleName: 'USER',
      });

      expect(result.invitation).toBe(created);
      expect(emailService.sendInvitationEmail).toHaveBeenCalledWith(
        'invitee@x.com',
        'plain-token',
        expect.any(String),
        'Yoga Wednesdays',
        undefined,
        'en',
      );
      // Hashed token stored, plain token never persisted.
      expect(invitationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'hashed-token' }),
      );
    });

    it("writes to someone without an account in the inviter's language", async () => {
      memberModel.findOne.mockResolvedValue(null);
      invitationModel.findOne.mockResolvedValue(null);
      invitationModel.create.mockResolvedValue({ id: 'inv-1' });
      jest.spyOn(User, 'findByPk').mockResolvedValue({
        firstName: 'Iris',
        lastName: 'Inst',
        language: 'ro',
      } as User);
      // No account for the invited address.
      jest.spyOn(User, 'findOne').mockResolvedValue(null);

      await service.create('owner-1', {
        groupId: 'g-1',
        email: 'invitee@x.com',
        roleName: 'USER',
      });

      expect(emailService.sendInvitationEmail).toHaveBeenCalledWith(
        'invitee@x.com',
        'plain-token',
        'Iris Inst',
        'Yoga Wednesdays',
        undefined,
        'ro',
      );
    });

    it('also fires a bell notification when the invitee already has an account', async () => {
      memberModel.findOne.mockResolvedValue(null);
      invitationModel.findOne.mockResolvedValue(null);
      invitationModel.create.mockResolvedValue({ id: 'inv-1' });
      jest
        .spyOn(User, 'findOne')
        .mockResolvedValue({ id: 'invitee-1' } as User);

      await service.create('owner-1', {
        groupId: 'g-1',
        email: 'invitee@x.com',
        roleName: 'USER',
      });

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'invitee-1' }),
      );
    });
  });

  // =====================================================================
  // accept
  // =====================================================================
  describe('accept', () => {
    function pendingInvite(overrides: Partial<Invitation> = {}) {
      return {
        id: 'inv-1',
        inviterId: 'owner-1',
        email: 'invitee@x.com',
        groupId: 'g-1',
        roleId: 'role-user',
        token: 'hashed-token',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
        declinedAt: null,
        group: { id: 'g-1', name: 'Yoga' },
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as Invitation;
    }

    it('returns 404 for an unknown token', async () => {
      invitationModel.findOne.mockResolvedValue(null);

      await expect(
        service.accept('plain-token', 'user-1', 'invitee@x.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an expired invitation with 400', async () => {
      invitationModel.findOne.mockResolvedValue(
        pendingInvite({ expiresAt: new Date(Date.now() - 86_400_000) }),
      );

      await expect(
        service.accept('plain-token', 'user-1', 'invitee@x.com'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when accepting user email mismatches the invitation', async () => {
      invitationModel.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.accept('plain-token', 'user-1', 'someone-else@x.com'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('adds member, assigns role, marks accepted, and notifies inviter', async () => {
      const invitation = pendingInvite();
      invitationModel.findOne.mockResolvedValue(invitation);

      const result = await service.accept(
        'plain-token',
        'user-1',
        'invitee@x.com',
      );

      expect(result).toEqual({
        message: expect.stringContaining('accepted'),
        groupId: 'g-1',
      });
      expect(groupService.addMember).toHaveBeenCalledWith('g-1', 'user-1', tx);
      expect(roleService.assignRoleToUser).toHaveBeenCalled();
      expect(invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedAt: expect.any(Date) }),
        expect.objectContaining({ transaction: tx }),
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1' }),
      );
    });

    it('rolls back the tx if addMember fails', async () => {
      invitationModel.findOne.mockResolvedValue(pendingInvite());
      groupService.addMember.mockRejectedValueOnce(new Error('db boom'));

      await expect(
        service.accept('plain-token', 'user-1', 'invitee@x.com'),
      ).rejects.toThrow('db boom');
      expect(tx.rollback).toHaveBeenCalled();
      expect(tx.commit).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // decline
  // =====================================================================
  describe('decline', () => {
    function pendingInvite(overrides: Partial<Invitation> = {}) {
      return {
        id: 'inv-1',
        inviterId: 'owner-1',
        email: 'invitee@x.com',
        groupId: 'g-1',
        token: 'hashed-token',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
        declinedAt: null,
        group: { id: 'g-1', name: 'Yoga' },
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as Invitation;
    }

    it('returns 404 for an unknown token', async () => {
      invitationModel.findOne.mockResolvedValue(null);

      await expect(
        service.decline('plain-token', 'invitee@x.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an already-responded invitation with 400', async () => {
      invitationModel.findOne.mockResolvedValue(
        pendingInvite({ acceptedAt: new Date() }),
      );

      await expect(
        service.decline('plain-token', 'invitee@x.com'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when email mismatches the invitation', async () => {
      invitationModel.findOne.mockResolvedValue(pendingInvite());

      await expect(
        service.decline('plain-token', 'someone-else@x.com'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('marks declined and notifies inviter without leaking invitee email', async () => {
      const invitation = pendingInvite();
      invitationModel.findOne.mockResolvedValue(invitation);
      // No User row exists for the email — body should fall back to a
      // generic "A user" via the builder; importantly, the email must
      // NOT be the body content.
      jest.spyOn(User, 'findOne').mockResolvedValue(null);

      await service.decline('plain-token', 'invitee@x.com');

      expect(invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ declinedAt: expect.any(Date) }),
      );
      const text = notificationText(
        notificationService.notify.mock.calls[0][0],
      );
      expect(text.body).not.toContain('invitee@x.com');
    });
  });
  // =====================================================================
  // inviteMembers (a coach inviting their clients, answered in the app)
  // =====================================================================
  describe('inviteMembers', () => {
    const dto = { groupId: 'g-1', userIds: ['c-1', 'c-2', 'c-3'] };

    beforeEach(() => {
      sequelize.transaction.mockImplementation(
        (work?: (t: typeof tx) => Promise<unknown>) => {
          if (work) {
            return work(tx);
          }
          return Promise.resolve(tx);
        },
      );
      instructorClientModel.findAll.mockResolvedValue([
        { clientId: 'c-1' },
        { clientId: 'c-2' },
        { clientId: 'c-3' },
      ]);
      jest.spyOn(User, 'findAll').mockResolvedValue([
        { id: 'c-1', email: 'Ana@X.com' },
        { id: 'c-2', email: 'bo@x.com' },
        { id: 'c-3', email: 'cy@x.com' },
      ] as User[]);
      memberModel.findAll.mockResolvedValue([{ userId: 'c-2' }]);
      invitationModel.findAll.mockResolvedValue([{ email: 'cy@x.com' }]);
      (invitationModel as ModelMock & { bulkCreate?: jest.Mock }).bulkCreate =
        jest.fn().mockResolvedValue([]);
    });

    it('refuses anyone who is not one of my active clients', async () => {
      instructorClientModel.findAll.mockResolvedValue([{ clientId: 'c-1' }]);

      await expect(service.inviteMembers('owner-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(notificationService.notifyMany).not.toHaveBeenCalled();
    });

    it('refuses inviting myself', async () => {
      await expect(
        service.inviteMembers('owner-1', {
          groupId: 'g-1',
          userIds: ['owner-1'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips members and open invitations, then notifies the rest once', async () => {
      const result = await service.inviteMembers('owner-1', dto);

      expect(result).toEqual({ invited: 1, skipped: 2 });
      const bulkCreate = (
        invitationModel as ModelMock & { bulkCreate: jest.Mock }
      ).bulkCreate;
      const [rows, options] = bulkCreate.mock.calls[0] as [
        Array<{ email: string; groupId: string }>,
        { transaction: unknown },
      ];
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('ana@x.com');
      expect(options.transaction).toBe(tx);
      expect(notificationService.notifyMany).toHaveBeenCalledWith(
        ['c-1'],
        expect.objectContaining({ data: { screen: 'groups' } }),
      );
      expect(emailService.sendInvitationEmail).not.toHaveBeenCalled();
    });

    it('writes nothing when everyone is already in or invited', async () => {
      memberModel.findAll.mockResolvedValue([
        { userId: 'c-1' },
        { userId: 'c-2' },
      ]);

      const result = await service.inviteMembers('owner-1', dto);

      expect(result).toEqual({ invited: 0, skipped: 3 });
      expect(notificationService.notifyMany).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // acceptMine / declineMine (the invite card, by id)
  // =====================================================================
  describe('answering in the app', () => {
    function myInvite(overrides: Partial<Invitation> = {}) {
      return {
        id: 'inv-1',
        inviterId: 'owner-1',
        email: 'invitee@x.com',
        groupId: 'g-1',
        roleId: 'role-user',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: null,
        declinedAt: null,
        group: { id: 'g-1', name: 'Yoga' },
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as Invitation;
    }

    it('accepts my invitation whatever the case of my email', async () => {
      invitationModel.findByPk.mockResolvedValue(myInvite());

      const result = await service.acceptMine(
        'inv-1',
        'user-1',
        'Invitee@X.com',
      );

      expect(result.groupId).toBe('g-1');
      expect(groupService.addMember).toHaveBeenCalledWith('g-1', 'user-1', tx);
    });

    it("answers 404 for someone else's invitation, never 403", async () => {
      invitationModel.findByPk.mockResolvedValue(myInvite());

      await expect(
        service.acceptMine('inv-1', 'user-2', 'other@x.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.declineMine('inv-1', 'other@x.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(groupService.addMember).not.toHaveBeenCalled();
    });

    it('declines my invitation', async () => {
      const invite = myInvite();
      invitationModel.findByPk.mockResolvedValue(invite);
      jest.spyOn(User, 'findByPk').mockResolvedValue(null);

      await service.declineMine('inv-1', 'invitee@x.com');

      expect(invite.update).toHaveBeenCalledWith(
        expect.objectContaining({ declinedAt: expect.any(Date) as Date }),
      );
    });
  });
});
