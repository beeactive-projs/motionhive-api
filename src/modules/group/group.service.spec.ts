import { Op } from 'sequelize';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { GroupService } from './group.service';
import { Group, JoinPolicy } from './entities/group.entity';
import { GroupMember, GroupMemberRole } from './entities/group-member.entity';
import {
  GroupJoinRequest,
  GroupJoinRequestStatus,
} from './entities/group-join-request.entity';
import { JoinRequestDecision } from './dto/decide-join-request.dto';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { User } from '../user/entities/user.entity';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailService } from '../../common/services/email.service';
import { SearchIndexService } from '../search/search-index.service';
import { NotificationService } from '../notification/notification.service';
import {
  makeModelMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke coverage for the most ownership/RBAC-sensitive flows in
 * GroupService. These tests exercise the membership state machine
 * (self-join, removal, ownership transfer, join-request decisions)
 * because that's where a regression could silently let the wrong
 * user into a group or strand the owner role.
 *
 * The full surface area (CRUD, discovery, member-listing, join-link
 * crypto, etc.) is left for incremental coverage as those code
 * paths are touched.
 */
describe('GroupService', () => {
  let service: GroupService;
  let groupModel: ModelMock & { sequelize: { transaction: jest.Mock } };
  let memberModel: ModelMock;
  let joinRequestModel: ModelMock & { sequelize: { transaction: jest.Mock } };
  let instructorClientModel: ModelMock;
  let userModel: ModelMock;
  let notificationService: { notify: jest.Mock; notifyMany: jest.Mock };

  // Fake transaction object that the service hands through.
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

    groupModel = { ...makeModelMock(), sequelize };
    memberModel = makeModelMock();
    joinRequestModel = { ...makeModelMock(), sequelize };
    instructorClientModel = makeModelMock();
    userModel = makeModelMock();
    userModel.findByPk.mockResolvedValue({
      id: 'requester-1',
      firstName: 'Casey',
      lastName: 'Client',
    });

    notificationService = {
      notify: jest.fn().mockResolvedValue(undefined),
      notifyMany: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GroupService,
        { provide: getModelToken(Group), useValue: groupModel },
        { provide: getModelToken(GroupMember), useValue: memberModel },
        {
          provide: getModelToken(GroupJoinRequest),
          useValue: joinRequestModel,
        },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        { provide: getModelToken(User), useValue: userModel },
        { provide: EmailService, useValue: {} },
        { provide: CryptoService, useValue: {} },
        {
          provide: SearchIndexService,
          useValue: { upsertGroup: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: NotificationService, useValue: notificationService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(GroupService);
  });

  // =====================================================================
  // selfJoinGroup
  // =====================================================================
  describe('selfJoinGroup', () => {
    function publicGroup(overrides: Partial<Group> = {}): Group {
      return {
        id: 'g-1',
        name: 'Yoga Wednesdays',
        instructorId: 'owner-1',
        isActive: true,
        isPublic: true,
        joinPolicy: JoinPolicy.OPEN,
        ...overrides,
      } as unknown as Group;
    }

    it('creates an active membership for an OPEN-policy group', async () => {
      groupModel.findByPk.mockResolvedValue(publicGroup());
      memberModel.findOne.mockResolvedValue(null);
      const created = { id: 'm-1', userId: 'u-1', groupId: 'g-1' };
      memberModel.create.mockResolvedValue(created);

      const result = await service.selfJoinGroup('g-1', 'u-1');

      expect(result.status).toBe('JOINED');
      expect(memberModel.create).toHaveBeenCalledWith({
        groupId: 'g-1',
        userId: 'u-1',
        role: GroupMemberRole.MEMBER,
      });
    });

    it('revives a previously-left membership instead of inserting (UNIQUE-index regression)', async () => {
      // The (group_id, user_id) UNIQUE index covers ALL rows including
      // soft-left ones. If the lookup ignored leftAt and tried INSERT,
      // the DB would 500. Verified that the service updates instead.
      groupModel.findByPk.mockResolvedValue(publicGroup());
      const update = jest.fn().mockResolvedValue(undefined);
      memberModel.findOne.mockResolvedValue({
        id: 'm-old',
        groupId: 'g-1',
        userId: 'u-1',
        leftAt: new Date('2026-01-01'),
        update,
      });

      const result = await service.selfJoinGroup('g-1', 'u-1');

      expect(result.status).toBe('JOINED');
      expect(memberModel.create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith({
        leftAt: null,
        role: GroupMemberRole.MEMBER,
      });
    });

    it('rejects an already-active member with 400', async () => {
      groupModel.findByPk.mockResolvedValue(publicGroup());
      memberModel.findOne.mockResolvedValue({
        id: 'm-1',
        leftAt: null,
      });

      await expect(service.selfJoinGroup('g-1', 'u-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(memberModel.create).not.toHaveBeenCalled();
    });

    it('returns PENDING + creates a join-request for APPROVAL-policy', async () => {
      groupModel.findByPk.mockResolvedValue(
        publicGroup({ joinPolicy: JoinPolicy.APPROVAL }),
      );
      memberModel.findOne.mockResolvedValue(null);
      joinRequestModel.findOne.mockResolvedValue(null);
      const request = { id: 'r-1', userId: 'u-1', groupId: 'g-1' };
      joinRequestModel.create.mockResolvedValue(request);

      const result = await service.selfJoinGroup('g-1', 'u-1');

      expect(result.status).toBe('PENDING');
      expect(joinRequestModel.create).toHaveBeenCalledWith({
        groupId: 'g-1',
        userId: 'u-1',
        status: GroupJoinRequestStatus.PENDING,
      });
    });

    it('reuses an existing PENDING request idempotently', async () => {
      groupModel.findByPk.mockResolvedValue(
        publicGroup({ joinPolicy: JoinPolicy.APPROVAL }),
      );
      memberModel.findOne.mockResolvedValue(null);
      const existing = { id: 'r-existing', userId: 'u-1' };
      joinRequestModel.findOne.mockResolvedValue(existing);

      const result = await service.selfJoinGroup('g-1', 'u-1');

      expect(result.status).toBe('PENDING');
      expect(joinRequestModel.create).not.toHaveBeenCalled();
      expect(result.request).toBe(existing);
    });

    it('rejects INVITE_ONLY groups with 403', async () => {
      groupModel.findByPk.mockResolvedValue(
        publicGroup({ joinPolicy: JoinPolicy.INVITE_ONLY }),
      );

      await expect(service.selfJoinGroup('g-1', 'u-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects non-public groups with 403', async () => {
      groupModel.findByPk.mockResolvedValue(publicGroup({ isPublic: false }));

      await expect(service.selfJoinGroup('g-1', 'u-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects unknown / inactive groups with 404', async () => {
      groupModel.findByPk.mockResolvedValue(null);

      await expect(service.selfJoinGroup('g-x', 'u-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // =====================================================================
  // removeMember
  // =====================================================================
  describe('getById', () => {
    // The role rides along on the group because the membership row is
    // already loaded to authorise the read. Without it the client has to
    // derive the role from the paginated member list, where a moderator
    // past the first page reads as a non-member and loses their controls.
    it("returns the caller's role alongside the group", async () => {
      groupModel.findByPk.mockResolvedValue({
        toJSON: () => ({ id: 'g-1', name: 'Morning Crew' }),
      });
      memberModel.findOne.mockResolvedValue({
        groupId: 'g-1',
        userId: 'mod-1',
        leftAt: null,
        role: GroupMemberRole.MODERATOR,
      });

      const result = await service.getById('g-1', 'mod-1');

      expect(result.myRole).toBe(GroupMemberRole.MODERATOR);
      expect(result.name).toBe('Morning Crew');
    });

    it('rejects a non-member rather than reporting a null role', async () => {
      groupModel.findByPk.mockResolvedValue({
        toJSON: () => ({ id: 'g-1' }),
      });
      memberModel.findOne.mockResolvedValue(null);

      await expect(service.getById('g-1', 'stranger')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('asks the database for the member count', async () => {
      // Every list endpoint attaches this count; the single-group read did
      // not, so the detail screen showed "0 members" for a group the list it
      // was opened from had just counted correctly.
      groupModel.findByPk.mockResolvedValue({
        toJSON: () => ({ id: 'g-1', memberCount: 4 }),
      });
      memberModel.findOne.mockResolvedValue({
        groupId: 'g-1',
        userId: 'u-1',
        leftAt: null,
        role: GroupMemberRole.MEMBER,
      });

      const result = await service.getById('g-1', 'u-1');

      expect(result.memberCount).toBe(4);
      const [, options] = groupModel.findByPk.mock.calls[0];
      expect(JSON.stringify(options)).toContain('group_member');
    });

    it('404s on a group that does not exist', async () => {
      groupModel.findByPk.mockResolvedValue(null);

      await expect(service.getById('nope', 'u-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeMember', () => {
    function activeOwner() {
      return {
        groupId: 'g-1',
        userId: 'owner-1',
        leftAt: null,
        isOwner: true,
        role: GroupMemberRole.OWNER,
      };
    }
    function activeMember() {
      const update = jest.fn().mockResolvedValue(undefined);
      return {
        groupId: 'g-1',
        userId: 'm-1',
        leftAt: null,
        isOwner: false,
        role: GroupMemberRole.MEMBER,
        update,
      };
    }

    it('lets the owner remove an active member (sets leftAt) and notifies', async () => {
      // assertOwnerAndGet → groupModel.findByPk + assertOwner (memberModel.findOne for owner row).
      groupModel.findByPk.mockResolvedValue({
        id: 'g-1',
        name: 'Yoga',
      });
      const member = activeMember();
      memberModel.findOne
        .mockResolvedValueOnce(activeOwner()) // assertMember inside assertOwner
        .mockResolvedValueOnce(member);

      await service.removeMember('g-1', 'm-1', 'owner-1');

      expect(member.update).toHaveBeenCalledWith(
        expect.objectContaining({ leftAt: expect.any(Date) }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'm-1' }),
      );
    });

    it('rejects non-owner caller with 403', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne.mockResolvedValueOnce({
        ...activeOwner(),
        userId: 'not-owner',
        isOwner: false,
        role: GroupMemberRole.MEMBER,
      });

      await expect(
        service.removeMember('g-1', 'm-1', 'not-owner'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('refuses to remove the group owner', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne
        .mockResolvedValueOnce(activeOwner())
        .mockResolvedValueOnce(activeOwner()); // attempting to remove the owner

      await expect(
        service.removeMember('g-1', 'owner-1', 'owner-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 when target is not a member', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne
        .mockResolvedValueOnce(activeOwner())
        .mockResolvedValueOnce(null);

      await expect(
        service.removeMember('g-1', 'ghost', 'owner-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // =====================================================================
  // transferOwnership
  // =====================================================================
  describe('transferOwnership', () => {
    function ownerRow() {
      return {
        groupId: 'g-1',
        userId: 'owner-1',
        leftAt: null,
        isOwner: true,
        role: GroupMemberRole.OWNER,
      };
    }
    function memberRow(userId = 'm-1') {
      return {
        groupId: 'g-1',
        userId,
        leftAt: null,
        isOwner: false,
        role: GroupMemberRole.MEMBER,
      };
    }

    it('flips owner role + group.instructorId in a single tx', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne
        .mockResolvedValueOnce(ownerRow()) // assertOwner
        .mockResolvedValueOnce(memberRow('new-owner')); // newOwner lookup
      memberModel.update.mockResolvedValue([1]);
      groupModel.update.mockResolvedValue([1]);

      const result = await service.transferOwnership(
        'g-1',
        'owner-1',
        'new-owner',
      );

      expect(result.message).toMatch(/transferred/i);
      // Demote old owner.
      expect(memberModel.update).toHaveBeenCalledWith(
        { role: GroupMemberRole.MEMBER },
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'owner-1' }),
        }),
      );
      // Promote new owner.
      expect(memberModel.update).toHaveBeenCalledWith(
        { role: GroupMemberRole.OWNER },
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'new-owner' }),
        }),
      );
      expect(groupModel.update).toHaveBeenCalledWith(
        { instructorId: 'new-owner' },
        expect.objectContaining({ where: { id: 'g-1' } }),
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it('rejects transfer to self with 400', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne.mockResolvedValueOnce(ownerRow());

      await expect(
        service.transferOwnership('g-1', 'owner-1', 'owner-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects transfer to a non-member with 400', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne
        .mockResolvedValueOnce(ownerRow()) // assertOwner
        .mockResolvedValueOnce(null); // newOwner lookup

      await expect(
        service.transferOwnership('g-1', 'owner-1', 'stranger'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // =====================================================================
  // decideJoinRequest
  // =====================================================================
  describe('decideJoinRequest', () => {
    const ownerMembership = {
      groupId: 'g-1',
      userId: 'owner-1',
      leftAt: null,
      isOwner: true,
      role: GroupMemberRole.OWNER,
    };
    function pendingRequest() {
      return {
        id: 'r-1',
        groupId: 'g-1',
        userId: 'u-1',
        status: GroupJoinRequestStatus.PENDING,
        update: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('APPROVE creates membership + flips request to APPROVED + notifies', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne
        .mockResolvedValueOnce(ownerMembership) // assertOwner
        .mockResolvedValueOnce(null); // existing membership lookup inside tx
      const request = pendingRequest();
      joinRequestModel.findOne.mockResolvedValue(request);

      await service.decideJoinRequest('g-1', 'r-1', 'owner-1', {
        action: JoinRequestDecision.APPROVE,
      });

      expect(memberModel.create).toHaveBeenCalledWith(
        { groupId: 'g-1', userId: 'u-1', role: GroupMemberRole.MEMBER },
        expect.objectContaining({ transaction: tx }),
      );
      expect(request.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: GroupJoinRequestStatus.APPROVED }),
        expect.objectContaining({ transaction: tx }),
      );
      expect(tx.commit).toHaveBeenCalled();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1' }),
      );
    });

    it('APPROVE revives a previously-left member instead of inserting', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      const update = jest.fn().mockResolvedValue(undefined);
      memberModel.findOne
        .mockResolvedValueOnce(ownerMembership) // assertOwner
        .mockResolvedValueOnce({ leftAt: new Date('2026-01-01'), update });
      joinRequestModel.findOne.mockResolvedValue(pendingRequest());

      await service.decideJoinRequest('g-1', 'r-1', 'owner-1', {
        action: JoinRequestDecision.APPROVE,
      });

      expect(memberModel.create).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        { leftAt: null },
        expect.objectContaining({ transaction: tx }),
      );
    });

    it('REJECT marks the request without creating a membership', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne.mockResolvedValueOnce(ownerMembership); // assertOwner only
      const request = pendingRequest();
      joinRequestModel.findOne.mockResolvedValue(request);

      await service.decideJoinRequest('g-1', 'r-1', 'owner-1', {
        action: JoinRequestDecision.REJECT,
      });

      expect(memberModel.create).not.toHaveBeenCalled();
      expect(request.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: GroupJoinRequestStatus.REJECTED }),
        expect.objectContaining({ transaction: tx }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1' }),
      );
    });

    it('rejects deciding an already-decided request with 400', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne.mockResolvedValueOnce(ownerMembership);
      joinRequestModel.findOne.mockResolvedValue({
        ...pendingRequest(),
        status: GroupJoinRequestStatus.APPROVED,
      });

      await expect(
        service.decideJoinRequest('g-1', 'r-1', 'owner-1', {
          action: JoinRequestDecision.APPROVE,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns 404 for an unknown request id', async () => {
      groupModel.findByPk.mockResolvedValue({ id: 'g-1', name: 'Yoga' });
      memberModel.findOne.mockResolvedValueOnce(ownerMembership);
      joinRequestModel.findOne.mockResolvedValue(null);

      await expect(
        service.decideJoinRequest('g-1', 'unknown', 'owner-1', {
          action: JoinRequestDecision.APPROVE,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sharedGroups', () => {
    it('returns only groups both people are active members of', async () => {
      memberModel.findAll
        .mockResolvedValueOnce([{ groupId: 'g-1' }, { groupId: 'g-2' }])
        .mockResolvedValueOnce([{ groupId: 'g-2' }]);
      groupModel.findAll.mockResolvedValueOnce([
        { id: 'g-2', name: 'Morning Crew', logoUrl: null },
      ]);

      const out = await service.sharedGroups('viewer-1', 'other-1');

      expect(memberModel.findAll).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { userId: 'viewer-1', leftAt: null },
        }),
      );
      expect(memberModel.findAll).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'other-1', leftAt: null }),
        }),
      );
      expect(out).toEqual([{ id: 'g-2', name: 'Morning Crew', logoUrl: null }]);
    });

    it('stops early when the viewer is in no groups', async () => {
      memberModel.findAll.mockResolvedValueOnce([]);
      groupModel.findAll.mockClear();

      expect(await service.sharedGroups('viewer-1', 'other-1')).toEqual([]);
      expect(groupModel.findAll).not.toHaveBeenCalled();
    });
  });

  describe('discoverGroups search', () => {
    it('matches without accents or case, as exercise search does', async () => {
      // "forta" must find "Forță": most phones type without diacritics.
      const escape = jest.fn((v: string) => `'${v}'`);
      (groupModel.sequelize as unknown as { escape: typeof escape }).escape =
        escape;

      await service.discoverGroups({ search: 'forta' }, null);

      const { where } = groupModel.findAndCountAll.mock.calls[0][0] as {
        where: Record<symbol, unknown>;
      };
      const clauses = JSON.stringify(where[Op.or]);
      expect(clauses).toContain('fold_for_search(\\"Group\\".\\"name\\")');
      expect(clauses).toContain(
        'fold_for_search(COALESCE(\\"Group\\".\\"description\\"',
      );
      // The term goes through escape, never straight into the SQL.
      expect(escape).toHaveBeenCalledWith('%forta%');
    });
  });
});
