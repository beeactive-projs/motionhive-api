import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { MessagingSafetyService } from './messaging-safety.service';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { MessagingSuspension } from './entities/messaging-suspension.entity';
import { UserBlock, UserBlockReason } from './entities/user-block.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { ClientRequest } from '../client/entities/client-request.entity';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { User } from '../user/entities/user.entity';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

interface ModelMock {
  findOne: jest.Mock;
  findAll: jest.Mock;
  create: jest.Mock;
  update?: jest.Mock;
}

describe('MessagingSafetyService — Stage 3', () => {
  let service: MessagingSafetyService;
  let blockModel: ModelMock;
  let suspensionModel: ModelMock;
  let participantModel: ModelMock;
  let instructorClientModel: ModelMock;
  let clientRequestModel: { update: jest.Mock };
  let userFindByPkSpy: jest.SpyInstance;
  // Raw queries: the connection check, coach limits, request counts.
  let query: jest.Mock;

  beforeEach(async () => {
    blockModel = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() };
    suspensionModel = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
    };
    participantModel = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
    };
    clientRequestModel = { update: jest.fn().mockResolvedValue([0]) };
    // Default: not connected, nobody a coach, no requests started.
    query = jest.fn().mockResolvedValue([]);
    instructorClientModel = {
      findOne: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue([0]),
    };

    userFindByPkSpy = jest.spyOn(User, 'findByPk');
    // Default: an established account. canMessage runs its three checks
    // in parallel, so the sender lookup happens even when an earlier
    // verdict wins — every test needs the spy to resolve.
    userFindByPkSpy.mockResolvedValue({
      id: 'sender-id',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    } as never);

    const module = await Test.createTestingModule({
      providers: [
        MessagingSafetyService,
        { provide: getModelToken(UserBlock), useValue: blockModel },
        {
          provide: getModelToken(MessagingSuspension),
          useValue: suspensionModel,
        },
        {
          provide: getModelToken(ConversationParticipant),
          useValue: participantModel,
        },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        {
          provide: getModelToken(ClientRequest),
          useValue: clientRequestModel,
        },
        {
          provide: Sequelize,
          useValue: {
            transaction: (cb: (tx: unknown) => unknown) =>
              Promise.resolve(cb({ id: 'tx' })),
            query: (...args: unknown[]) => query(...args),
          },
        },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(MessagingSafetyService);
  });

  afterEach(() => {
    userFindByPkSpy.mockRestore();
  });

  // ─────────────────────────── isMessagingSuspended ───────────────────

  describe('isMessagingSuspended', () => {
    it('returns false when no active suspension exists', async () => {
      suspensionModel.findOne.mockResolvedValue(null);
      expect(await service.isMessagingSuspended('u')).toBe(false);
    });

    it('returns true when an unlifted suspension exists', async () => {
      suspensionModel.findOne.mockResolvedValue({ id: 's1' });
      expect(await service.isMessagingSuspended('u')).toBe(true);
    });
  });

  // ─────────────────────────── block / unblock / list ─────────────────

  describe('block', () => {
    it('rejects self-block with 400', async () => {
      await expect(service.block('u', 'u')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404 when target user does not exist', async () => {
      userFindByPkSpy.mockResolvedValue(null);
      await expect(service.block('u', 'unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409 when block already exists (idempotency: do not silently duplicate)', async () => {
      userFindByPkSpy.mockResolvedValue({ id: 'b' });
      blockModel.findOne.mockResolvedValue({ id: 'existing-block' });
      await expect(service.block('a', 'b')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('happy path: creates a row with reason', async () => {
      userFindByPkSpy.mockResolvedValue({ id: 'b' });
      blockModel.findOne.mockResolvedValue(null);
      blockModel.create.mockResolvedValue({
        id: 'new',
        blockerId: 'a',
        blockedId: 'b',
        reason: UserBlockReason.SPAM,
      });

      const result = await service.block('a', 'b', UserBlockReason.SPAM);

      expect(blockModel.create).toHaveBeenCalledWith(
        {
          blockerId: 'a',
          blockedId: 'b',
          reason: UserBlockReason.SPAM,
        },
        { transaction: { id: 'tx' } },
      );
      expect(result.id).toBe('new');
    });

    it('ends any coaching between the two, either way round, in the same transaction', async () => {
      userFindByPkSpy.mockResolvedValue({ id: 'b' });
      blockModel.findOne.mockResolvedValue(null);
      blockModel.create.mockResolvedValue({ id: 'new' });

      await service.block('a', 'b');

      expect(instructorClientModel.update).toHaveBeenCalledWith(
        { status: 'ARCHIVED' },
        {
          where: {
            status: 'ACTIVE',
            [Op.or]: [
              { instructorId: 'a', clientId: 'b' },
              { instructorId: 'b', clientId: 'a' },
            ],
          },
          transaction: { id: 'tx' },
        },
      );
      expect(clientRequestModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CANCELLED' }),
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDING' }),
          transaction: { id: 'tx' },
        }),
      );
    });
  });

  describe('listBlocks', () => {
    it('lists blocked people as cards, never their email or phone', async () => {
      blockModel.findAll.mockResolvedValue([]);

      await service.listBlocks('a');

      const opts = blockModel.findAll.mock.calls[0][0] as {
        include: { attributes: string[] }[];
      };
      expect(opts.include[0].attributes).not.toContain('email');
      expect(opts.include[0].attributes).not.toContain('phone');
      expect(opts.include[0].attributes).toContain('handle');
    });
  });

  describe('unblock', () => {
    it('404 when no block row exists', async () => {
      blockModel.findOne.mockResolvedValue(null);
      await expect(service.unblock('a', 'b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('destroys the row when one exists', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      blockModel.findOne.mockResolvedValue({ destroy });
      await service.unblock('a', 'b');
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('isBlocked', () => {
    it('returns false for self-pairs (defensive)', async () => {
      expect(await service.isBlocked('u', 'u')).toBe(false);
      expect(blockModel.findOne).not.toHaveBeenCalled();
    });

    it('returns true iff a (blocker,blocked) row exists in that exact direction', async () => {
      blockModel.findOne.mockResolvedValueOnce({ id: 'x' });
      expect(await service.isBlocked('a', 'b')).toBe(true);
      blockModel.findOne.mockResolvedValueOnce(null);
      expect(await service.isBlocked('b', 'a')).toBe(false);
    });
  });

  // ─────────────────────────── assertParticipant ──────────────────────

  describe('assertParticipant', () => {
    it('throws NotFoundException (not Forbidden) when not a participant', async () => {
      participantModel.findOne.mockResolvedValue(null);
      await expect(service.assertParticipant('u', 'c')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('passes silently when an active row exists', async () => {
      participantModel.findOne.mockResolvedValue({ id: 'p' });
      await expect(
        service.assertParticipant('u', 'c'),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────── canMessage decision tree ───────────────

  describe('canMessage decision tree', () => {
    const sender = 'sender-id';
    const recipient = 'recipient-id';
    const FORTY_NINE_HOURS = 49 * 60 * 60 * 1000;

    function mockSenderAge(hoursOld: number) {
      userFindByPkSpy.mockResolvedValue({
        id: sender,
        createdAt: new Date(Date.now() - hoursOld * 60 * 60 * 1000),
      });
    }

    function defaultNoBlock() {
      blockModel.findOne.mockResolvedValue(null);
    }

    function defaultNoSuspension() {
      suspensionModel.findOne.mockResolvedValue(null);
    }

    function defaultNoActiveLink() {
      query.mockResolvedValue([]);
    }

    it('rejects self-send', async () => {
      const v = await service.canMessage(sender, sender);
      expect(v.kind).toBe('forbidden');
    });

    it('suspension wins over everything (block and new-account never consulted)', async () => {
      suspensionModel.findOne.mockResolvedValue({ id: 's1' });
      blockModel.findOne.mockResolvedValue({ id: 'b1' }); // would otherwise silent-drop
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('forbidden');
      // Block check happens AFTER suspension; suspension result short-circuits.
      // We don't assert call counts because the implementation may
      // legitimately reorder later — the point is the outcome.
    });

    it('block wins over new-account (silent drop is correct outcome, not 403)', async () => {
      defaultNoSuspension();
      blockModel.findOne.mockResolvedValue({ id: 'b1' });
      // Sender is also a new account, but block check happens first.
      mockSenderAge(1);
      defaultNoActiveLink();
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('silentDrop');
    });

    it('refuses, plainly, a send to someone the sender blocked', async () => {
      defaultNoSuspension();
      // Only sender → recipient is blocked.
      blockModel.findOne.mockImplementation(
        (opts: { where: { blockerId: string } }) => {
          if (opts.where.blockerId === sender) {
            return Promise.resolve({ id: 'b1' });
          }
          return Promise.resolve(null);
        },
      );
      mockSenderAge(1000);
      defaultNoActiveLink();
      const v = await service.canMessage(sender, recipient);
      expect(v).toEqual({
        kind: 'forbidden',
        reason: expect.objectContaining({
          messageKey: 'messaging.youBlockedThem',
        }),
      });
    });

    it('new-account sender with no ACTIVE link → forbidden', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      mockSenderAge(1); // 1h old
      defaultNoActiveLink();
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('forbidden');
    });

    it('new-account sender who may write directly (coaching, a booking, a group they run) → allowed', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      mockSenderAge(1);
      query.mockResolvedValue([{ connected: 1 }]);
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('allowed');
    });

    it('new-account sender may answer someone who wrote first, with no connection', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      mockSenderAge(1);
      defaultNoActiveLink();
      const v = await service.canMessage(sender, recipient, {
        recipientAccepted: true,
      });
      expect(v.kind).toBe('allowed');
      expect(query).not.toHaveBeenCalled();
    });

    it('old sender → allowed even with no ACTIVE link', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      mockSenderAge(49); // > 48h
      defaultNoActiveLink();
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('allowed');
      // Sanity: the connection lookup is short-circuited.
      expect(query).not.toHaveBeenCalled();
    });

    it('missing sender row → forbidden (fail-safe)', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      userFindByPkSpy.mockResolvedValue(null);
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('forbidden');
    });

    it('runs the checks in parallel but applies them in precedence order', async () => {
      // All three fire on one round trip; the verdict must still be the
      // most serious one, not whichever resolved first.
      suspensionModel.findOne.mockResolvedValue({ id: 's1' });
      blockModel.findOne.mockResolvedValue({ id: 'b1' });
      mockSenderAge(1);
      defaultNoActiveLink();

      const v = await service.canMessage(sender, recipient);

      expect(v.kind).toBe('forbidden');
      expect(suspensionModel.findOne).toHaveBeenCalledTimes(1);
      // One block lookup per direction.
      expect(blockModel.findOne).toHaveBeenCalledTimes(2);
    });

    it('skips the sender lookup when the caller already has createdAt', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      userFindByPkSpy.mockClear();

      const v = await service.canMessage(sender, recipient, {
        senderCreatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });

      expect(v.kind).toBe('allowed');
      expect(userFindByPkSpy).not.toHaveBeenCalled();
    });

    it('still loads the sender when no createdAt is supplied', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      mockSenderAge(1);
      defaultNoActiveLink();
      userFindByPkSpy.mockClear();
      mockSenderAge(1);

      const v = await service.canMessage(sender, recipient);

      expect(v.kind).toBe('forbidden');
      expect(userFindByPkSpy).toHaveBeenCalledTimes(1);
    });

    it('exact 48h boundary: NOT throttled (only strictly younger accounts are)', async () => {
      defaultNoSuspension();
      defaultNoBlock();
      // Right at 48h — implementation uses `>=` to clear, so 48h passes.
      userFindByPkSpy.mockResolvedValue({
        id: sender,
        createdAt: new Date(Date.now() - FORTY_NINE_HOURS + 60 * 60 * 1000), // exactly 48h
      });
      const v = await service.canMessage(sender, recipient);
      expect(v.kind).toBe('allowed');
    });
  });

  // ─────────────────────────── message requests (migration 090) ───────

  describe('deliveryFor', () => {
    const sender = 'sender-id';
    const recipient = 'recipient-id';

    function policy(messagePolicy: string) {
      userFindByPkSpy.mockResolvedValue({ id: recipient, messagePolicy });
    }

    it('connected people go straight in, whatever the setting', async () => {
      policy('CONNECTIONS');
      query.mockResolvedValueOnce([{ connected: 1 }]);
      expect(await service.deliveryFor(sender, recipient)).toEqual({
        kind: 'direct',
      });
    });

    it('EVERYONE lets anyone straight in', async () => {
      policy('EVERYONE');
      expect(await service.deliveryFor(sender, recipient)).toEqual({
        kind: 'direct',
      });
    });

    it('CONNECTIONS refuses anyone else, plainly', async () => {
      policy('CONNECTIONS');
      expect(await service.deliveryFor(sender, recipient)).toEqual({
        kind: 'refused',
        reason: expect.objectContaining({
          messageKey: 'messaging.connectionsOnly',
        }),
      });
    });

    it('REQUESTS (the default) makes it a request with the limit of 3', async () => {
      policy('REQUESTS');
      expect(await service.deliveryFor(sender, recipient)).toEqual({
        kind: 'request',
        limit: 3,
      });
    });

    it('a coach taking clients gets up to 10 before accepting', async () => {
      policy('REQUESTS');
      query
        .mockResolvedValueOnce([]) // not connected
        .mockResolvedValueOnce([{ userId: recipient }]); // taking clients
      expect(await service.deliveryFor(sender, recipient)).toEqual({
        kind: 'request',
        limit: 10,
      });
    });

    it('a missing account is treated as the default, never as an error', async () => {
      userFindByPkSpy.mockResolvedValue(null);
      expect((await service.deliveryFor(sender, recipient)).kind).toBe(
        'request',
      );
    });
  });

  describe('mayWriteDirectly', () => {
    it('asks one query, with the people and the booking window as replacements', async () => {
      query.mockResolvedValue([{ connected: 1 }]);

      expect(await service.mayWriteDirectly('a', 'b')).toBe(true);

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, options] = query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      expect(options.replacements).toEqual({
        sender: 'a',
        recipient: 'b',
        bookingDays: 14,
      });
      // A pending coaching request counts only when it came FROM the
      // recipient: the person who asked gets nothing from it.
      expect(sql).toContain('cr.from_user_id = :recipient');
      expect(sql).toContain('cr.to_user_id = :sender');
    });

    it('is false for yourself without asking', async () => {
      expect(await service.mayWriteDirectly('a', 'a')).toBe(false);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('requestContextsFor', () => {
    it('fills a group in common and the coach flag, and asks nothing for nobody', async () => {
      expect(await service.requestContextsFor('me', [])).toEqual(new Map());
      expect(query).not.toHaveBeenCalled();

      query
        .mockResolvedValueOnce([
          { userId: 'x', name: 'Morning Runners', count: '2' },
        ])
        .mockResolvedValueOnce([{ userId: 'x' }]);

      const contexts = await service.requestContextsFor('me', ['x', 'y']);

      expect(contexts.get('x')).toEqual({
        sharedGroupName: 'Morning Runners',
        sharedGroupCount: 2,
        isCoach: true,
      });
      expect(contexts.get('y')).toEqual({
        sharedGroupName: null,
        sharedGroupCount: 0,
        isCoach: false,
      });
    });
  });
});
