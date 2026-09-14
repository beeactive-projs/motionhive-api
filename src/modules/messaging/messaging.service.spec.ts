import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { MessagingService } from './messaging.service';
import { MessagingSafetyService } from './messaging-safety.service';
import { MessagingContentService } from './messaging-content.service';
import { MessagingRateLimitService } from './messaging-rate-limit.service';
import { MessagingVelocityService } from './messaging-velocity.service';
import { MessagingEventsService } from './messaging-events.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/notification-types';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { Message, MessageKind } from './entities/message.entity';
import { User } from '../user/entities/user.entity';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

// ---------------------------------------------------------------------------
// Lightweight mocks. We stub only the Sequelize surface MessagingService
// actually touches, plus the static User.findByPk used in sendMessage.
// ---------------------------------------------------------------------------

interface ConvMock {
  create: jest.Mock;
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  update: jest.Mock;
}

interface PartMock {
  create: jest.Mock;
  bulkCreate: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
  update: jest.Mock;
}

interface MsgMock {
  create: jest.Mock;
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  count: jest.Mock;
}

describe('MessagingService — Stage 2 core', () => {
  let service: MessagingService;
  let conv: ConvMock;
  let part: PartMock;
  let msg: MsgMock;
  let safety: { canMessage: jest.Mock; assertParticipant: jest.Mock };
  let content: { detectThreats: jest.Mock };
  let rateLimit: {
    assertSendAllowed: jest.Mock;
    shouldSuppressMessageEmail: jest.Mock;
  };
  let velocity: { recordSendAndMaybeAlarm: jest.Mock };
  let notifications: { notify: jest.Mock };
  let emitter: {
    emitMessageCreated: jest.Mock;
    emitMessageDeleted: jest.Mock;
    emitConversationRead: jest.Mock;
    emitConversationMuted: jest.Mock;
    subscribeForUser: jest.Mock;
  };
  let userFindByPkSpy: jest.SpyInstance;

  // Sequelize.transaction supports two overloads the messaging
  // service relies on:
  //   - `transaction(cb)`                  — open a new tx
  //   - `transaction({ transaction }, cb)` — open a savepoint inside
  //                                           an existing tx
  // Honour both: if argA is a function we treat it as the callback;
  // otherwise the callback is in argB.
  const sequelize = {
    transaction: jest.fn(
      async <T>(
        argA: unknown,
        argB?: (tx: unknown) => Promise<T>,
      ): Promise<T> => {
        const cb =
          typeof argA === 'function'
            ? (argA as (tx: unknown) => Promise<T>)
            : (argB as (tx: unknown) => Promise<T>);
        return cb({});
      },
    ),
  };

  beforeEach(async () => {
    sequelize.transaction.mockClear();

    conv = {
      create: jest.fn(),
      findByPk: jest.fn(),
      findOne: jest.fn(),
      // Default to "no existing conversation" so happy-path tests
      // just need to mock `create` and not also stub findAll.
      findAll: jest.fn().mockResolvedValue([]),
      findAndCountAll: jest.fn(),
      update: jest.fn().mockResolvedValue([1]),
    };
    part = {
      create: jest.fn(),
      bulkCreate: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      // Default `findAll` to an empty list so the SSE emit helper
      // (`otherActiveParticipantIds`) returns [] without blowing up
      // in tests that don't care about it.
      findAll: jest.fn().mockResolvedValue([]),
      findAndCountAll: jest.fn(),
      update: jest.fn().mockResolvedValue([1]),
    };
    msg = {
      create: jest.fn(),
      findByPk: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    safety = {
      // Default: every gate decision is 'allowed' so Stage 2 happy-path
      // tests continue to work unchanged. Stage 3 tests override.
      canMessage: jest.fn().mockResolvedValue({ kind: 'allowed' }),
      assertParticipant: jest.fn().mockResolvedValue(undefined),
    };
    content = {
      detectThreats: jest.fn().mockReturnValue({
        urls: [],
        hasShortenerUrl: false,
        hasOffPlatformContact: false,
        hasPaymentHandle: false,
        anyFlag: false,
      }),
    };
    rateLimit = {
      assertSendAllowed: jest.fn().mockResolvedValue(undefined),
      shouldSuppressMessageEmail: jest.fn().mockReturnValue(false),
    };
    velocity = {
      recordSendAndMaybeAlarm: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue({
        notificationId: 'n-1',
        receiptId: 'r-1',
        deduped: false,
        delivered: {},
      }),
    };
    emitter = {
      emitMessageCreated: jest.fn(),
      emitMessageDeleted: jest.fn(),
      emitConversationRead: jest.fn(),
      emitConversationMuted: jest.fn(),
      subscribeForUser: jest.fn(),
    };

    userFindByPkSpy = jest.spyOn(User, 'findByPk');
    // Wrap every resolved value with `isActive: true` so existing
    // tests don't need to opt into the new BE-H11 inactive-recipient
    // gate. Tests that specifically want to simulate a deactivated
    // user pass `isActive: false` explicitly and that wins.
    const _origResolvedValue =
      userFindByPkSpy.mockResolvedValue.bind(userFindByPkSpy);
    userFindByPkSpy.mockResolvedValue = ((value: unknown) => {
      if (value && typeof value === 'object' && !('isActive' in value)) {
        return _origResolvedValue({ ...value, isActive: true });
      }
      return _origResolvedValue(value);
    }) as typeof userFindByPkSpy.mockResolvedValue;

    const module = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: getModelToken(Conversation), useValue: conv },
        { provide: getModelToken(ConversationParticipant), useValue: part },
        { provide: getModelToken(Message), useValue: msg },
        { provide: 'SEQUELIZE', useValue: sequelize },
        {
          provide: (await import('sequelize-typescript')).Sequelize,
          useValue: sequelize,
        },
        { provide: MessagingSafetyService, useValue: safety },
        { provide: MessagingContentService, useValue: content },
        { provide: MessagingRateLimitService, useValue: rateLimit },
        { provide: MessagingVelocityService, useValue: velocity },
        { provide: NotificationService, useValue: notifications },
        { provide: MessagingEventsService, useValue: emitter },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(MessagingService);
  });

  afterEach(() => {
    userFindByPkSpy.mockRestore();
  });

  // ─────────────────────────── body helpers ───────────────────────────

  describe('body helpers', () => {
    it('round-trips plaintext unchanged (Stage 1 baseline preserved)', () => {
      for (const c of ['', 'hi', '🏋️ ăîș', 'a'.repeat(4000), 'line\nbreak']) {
        expect(service.getMessageBody(service.setMessageBody(c))).toBe(c);
      }
    });
  });

  // ─────────────────────────── sendMessage ───────────────────────────

  describe('sendMessage', () => {
    const sender = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const recipient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    function mockNoExistingConversation() {
      conv.findOne.mockResolvedValue(null);
    }

    function mockCreatedConversation(id: string) {
      conv.create.mockResolvedValue({
        id,
        type: ConversationType.DIRECT,
        createdById: sender,
        lastMessageAt: null,
        lastMessagePreview: null,
      });
    }

    function mockMessageCreate(id: string, conversationId: string) {
      // `create` returns the full row (INSERT … RETURNING); the send
      // path uses it directly instead of re-fetching by id.
      const row = {
        id,
        conversationId,
        senderId: sender,
        kind: MessageKind.TEXT,
        body: 'hello',
        deletedAt: null,
        createdAt: new Date('2026-05-11T10:00:00Z'),
      };
      msg.create.mockResolvedValue(row);
      msg.findByPk.mockResolvedValue(row);
    }

    function mockListItemAfterSend(conversationId: string) {
      // Both participant rows come back from one findAll (user included
      // on the other side) — the send path no longer re-reads the
      // conversation, it patches the row it just wrote.
      part.findAll.mockResolvedValue([
        {
          conversationId: conversationId,
          userId: sender,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
        {
          conversationId: conversationId,
          userId: recipient,
          lastReadAt: null,
          leftAt: null,
          user: {
            id: recipient,
            firstName: 'Bob',
            lastName: 'Builder',
            avatarUrl: null,
          },
        },
      ]);
    }

    it('rejects sending to self', async () => {
      await expect(
        service.sendMessage(sender, sender, 'hi'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('silent-drops (no 404) when recipient does not exist — prevents user-enumeration via send', async () => {
      // Both `findByPk` calls (sender + recipient parallel lookup)
      // return null. The sender lookup is informational only; the
      // recipient missing is what matters.
      userFindByPkSpy.mockResolvedValue(null);

      const result = await service.sendMessage(sender, recipient, 'hi');

      expect(result.delivered).toBe(false);
      // Synthetic UUIDs — never reveal block/missing-user.
      expect(result.message.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      // No DB writes.
      expect(conv.create).not.toHaveBeenCalled();
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('silent-drops when recipient exists but isActive=false (deactivated account)', async () => {
      // Regression for the bug where a deactivated user (account
      // disabled, not deleted) would still receive messages they
      // could never sign in to read — wasted delivery + ambient
      // signal to the sender about the recipient's status.
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'X',
        lastName: 'Y',
        avatarUrl: null,
        isActive: false,
      });

      const result = await service.sendMessage(sender, recipient, 'hi');

      expect(result.delivered).toBe(false);
      expect(conv.create).not.toHaveBeenCalled();
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only body', async () => {
      userFindByPkSpy.mockResolvedValue({ id: recipient });
      await expect(
        service.sendMessage(sender, recipient, '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates conversation + 2 participants + message + updates last_message_at on first send', async () => {
      userFindByPkSpy.mockResolvedValue({ id: recipient });
      mockNoExistingConversation();
      mockCreatedConversation('conv-1');
      mockMessageCreate('msg-1', 'conv-1');
      mockListItemAfterSend('conv-1');

      const result = await service.sendMessage(sender, recipient, 'hello');

      expect(conv.create).toHaveBeenCalledTimes(1);
      expect(part.bulkCreate).toHaveBeenCalledTimes(1);
      const participantPayload = part.bulkCreate.mock.calls[0][0] as Array<{
        userId: string;
      }>;
      expect(participantPayload.map((p) => p.userId).sort()).toEqual(
        [sender, recipient].sort(),
      );
      expect(msg.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          senderId: sender,
          kind: MessageKind.TEXT,
          body: 'hello',
        }),
        expect.anything(),
      );
      expect(conv.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastMessagePreview: 'hello',
        }),
        expect.objectContaining({ where: { id: 'conv-1' } }),
      );
      expect(result.message.body).toBe('hello');
      expect(result.conversation.id).toBe('conv-1');
      expect(result.conversation.unreadCount).toBe(0);
      expect(result.delivered).toBe(true);
    });

    it('concurrent first-send race: UniqueConstraintError → recovers to the winning row', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });

      // First findOne (fast-path lookup by direct_key) → not found.
      // Second findOne (after UniqueConstraintError) → the winner row.
      conv.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'winner-conv' });

      // Simulate Sequelize's UniqueConstraintError from the unique
      // index on direct_key.
      const { UniqueConstraintError } = await import('sequelize');
      conv.create.mockRejectedValueOnce(
        new UniqueConstraintError({ errors: [], fields: { direct_key: 'x' } }),
      );

      mockMessageCreate('msg-r1', 'winner-conv');
      mockListItemAfterSend('winner-conv');

      const result = await service.sendMessage(sender, recipient, 'hi');

      // We end up using the winner's conversation, not ours.
      expect(result.conversation.id).toBe('winner-conv');
      expect(result.delivered).toBe(true);
      // No participants inserted on our (failed) create attempt.
      expect(part.bulkCreate).not.toHaveBeenCalled();
    });

    it('reuses an existing DIRECT conversation between the same two users', async () => {
      userFindByPkSpy.mockResolvedValue({ id: recipient });
      conv.findOne.mockResolvedValue({ id: 'conv-existing' });
      part.findAll.mockResolvedValue([
        { userId: sender },
        { userId: recipient },
      ]);
      mockMessageCreate('msg-2', 'conv-existing');
      mockListItemAfterSend('conv-existing');

      const result = await service.sendMessage(sender, recipient, 'again');

      expect(conv.create).not.toHaveBeenCalled();
      expect(part.bulkCreate).not.toHaveBeenCalled();
      expect(result.conversation.id).toBe('conv-existing');
    });

    it('truncates the lastMessagePreview at 200 chars on the conversation update', async () => {
      userFindByPkSpy.mockResolvedValue({ id: recipient });
      mockNoExistingConversation();
      mockCreatedConversation('conv-1');
      mockMessageCreate('msg-1', 'conv-1');
      mockListItemAfterSend('conv-1');

      const long = 'x'.repeat(500);
      await service.sendMessage(sender, recipient, long);

      const updateArgs = conv.update.mock.calls[0][0] as {
        lastMessagePreview: string;
      };
      expect(updateArgs.lastMessagePreview.length).toBe(200);
    });
  });

  // ─────────────────────────── assertParticipant ───────────────────────────

  describe('assertParticipant (delegates to safety service)', () => {
    it('throws NotFoundException (not Forbidden) when safety says non-participant', async () => {
      safety.assertParticipant.mockRejectedValueOnce(
        new NotFoundException('Conversation not found.'),
      );
      await expect(
        service.assertParticipant('user-x', 'conv-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('passes silently when safety says participant', async () => {
      safety.assertParticipant.mockResolvedValueOnce(undefined);
      await expect(
        service.assertParticipant('user-x', 'conv-1'),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────── markRead ───────────────────────────

  describe('markRead', () => {
    it('rejects an invalid ISO string', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      await expect(
        service.markRead('user-x', 'conv-1', 'not-a-date'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses now() when upToIso is omitted', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const before = Date.now();
      const { lastReadAt } = await service.markRead('user-x', 'conv-1');
      const after = Date.now();
      expect(lastReadAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(lastReadAt.getTime()).toBeLessThanOrEqual(after);
      expect(part.update).toHaveBeenCalledTimes(1);
    });

    it('clamps a future upToIso to now() — clients cannot mark unread-by-default messages as read', async () => {
      // Regression for the bug where a client supplying a far-future
      // ISO would prematurely silence the unread badge for messages
      // not yet received.
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const farFuture = new Date(Date.now() + 24 * 3600_000).toISOString();
      const before = Date.now();
      const { lastReadAt } = await service.markRead(
        'user-x',
        'conv-1',
        farFuture,
      );
      const after = Date.now();
      expect(lastReadAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(lastReadAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  // ─────────────────────────── muteConversation ───────────────────────────

  describe('muteConversation', () => {
    it('null untilIso → mutedUntil:null (unmute)', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const result = await service.muteConversation('u', 'c', null);
      expect(result.mutedUntil).toBeNull();
    });

    it('past timestamp → treated as unmute', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const result = await service.muteConversation(
        'u',
        'c',
        '2000-01-01T00:00:00.000Z',
      );
      expect(result.mutedUntil).toBeNull();
    });

    it('future timestamp → mutedUntil set', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const future = new Date(Date.now() + 3600_000).toISOString();
      const result = await service.muteConversation('u', 'c', future);
      expect(result.mutedUntil).not.toBeNull();
      expect(result.mutedUntil?.toISOString()).toBe(future);
    });

    it('emits a conversation.muted SSE event to the actor so other tabs sync', async () => {
      // Regression for the bug where the BE updated the DB row but
      // never fanned out the change, leaving a multi-tab user with
      // a stale inbox indicator until refresh.
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const future = new Date(Date.now() + 3600_000).toISOString();
      await service.muteConversation('user-1', 'conv-1', future);
      expect(emitter.emitConversationMuted).toHaveBeenCalledTimes(1);
      const [recipients, payload] = emitter.emitConversationMuted.mock.calls[0];
      expect(recipients).toEqual(['user-1']);
      expect(payload).toEqual({
        conversationId: 'conv-1',
        userId: 'user-1',
        mutedUntil: future,
      });
    });

    it('emits with mutedUntil: null on an unmute', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      await service.muteConversation('user-1', 'conv-1', null);
      const payload = emitter.emitConversationMuted.mock.calls[0][1];
      expect(payload.mutedUntil).toBeNull();
    });
  });

  // ─────────────────────────── leave ───────────────────────────

  describe('leave', () => {
    it('rejects leaving a DIRECT conversation with 400', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      conv.findByPk.mockResolvedValue({
        id: 'c-1',
        type: ConversationType.DIRECT,
      });
      await expect(service.leave('u', 'c-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows leaving a GROUP conversation; sets left_at', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      conv.findByPk.mockResolvedValue({
        id: 'c-1',
        type: ConversationType.GROUP,
      });
      await service.leave('u', 'c-1');
      expect(part.update).toHaveBeenCalledWith(
        expect.objectContaining({ leftAt: expect.any(Date) }),
        expect.any(Object),
      );
    });
  });

  // ─────────────────────────── deleteOwnMessage ───────────────────────────

  describe('deleteOwnMessage', () => {
    it('404 when message does not exist', async () => {
      msg.findByPk.mockResolvedValue(null);
      await expect(service.deleteOwnMessage('u', 'm-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('403 when caller is not the sender', async () => {
      msg.findByPk.mockResolvedValue({
        id: 'm-1',
        senderId: 'someone-else',
        deletedAt: null,
        update: jest.fn(),
      });
      await expect(service.deleteOwnMessage('u', 'm-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('sender soft-deletes own → body becomes tombstone, deletedAt set', async () => {
      const update = jest.fn().mockImplementation(function (
        this: { deletedAt: Date | null; body: string; deletedById: string },
        patch: { deletedAt: Date; body: string; deletedById: string },
      ) {
        this.deletedAt = patch.deletedAt;
        this.body = patch.body;
        this.deletedById = patch.deletedById;
        return Promise.resolve(this);
      });
      const row = {
        id: 'm-1',
        senderId: 'u',
        conversationId: 'c-1',
        kind: MessageKind.TEXT,
        body: 'secret',
        deletedAt: null,
        createdAt: new Date(),
        update,
      };
      msg.findByPk.mockResolvedValue(row);

      const view = await service.deleteOwnMessage('u', 'm-1');

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedById: 'u',
          body: '[deleted]',
        }),
      );
      expect(view.body).toBe('[deleted]');
      expect(view.deletedAt).not.toBeNull();
    });

    it('idempotent on already-deleted message (returns view, no update)', async () => {
      const update = jest.fn();
      msg.findByPk.mockResolvedValue({
        id: 'm-1',
        senderId: 'u',
        conversationId: 'c-1',
        kind: MessageKind.TEXT,
        body: '[deleted]',
        deletedAt: new Date('2026-05-10T00:00:00Z'),
        createdAt: new Date(),
        update,
      });

      const view = await service.deleteOwnMessage('u', 'm-1');

      expect(update).not.toHaveBeenCalled();
      expect(view.body).toBe('[deleted]');
    });
  });

  // ─────────────────────────── Stage 3: safety gate in sendMessage ────────

  describe('sendMessage with safety gate', () => {
    const sender = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const recipient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    beforeEach(() => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
    });

    it('suspension → 403, no row written', async () => {
      safety.canMessage.mockResolvedValue({
        kind: 'forbidden',
        reason: 'Your messaging has been restricted. Contact support.',
      });

      await expect(
        service.sendMessage(sender, recipient, 'hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(conv.create).not.toHaveBeenCalled();
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('new-account rule → 403, no row written', async () => {
      safety.canMessage.mockResolvedValue({
        kind: 'forbidden',
        reason:
          'New accounts can only message users they already have an active relationship with.',
      });

      await expect(
        service.sendMessage(sender, recipient, 'hi'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(conv.create).not.toHaveBeenCalled();
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('recipient blocked sender → silent drop: response shaped like success, delivered:false, NO row written', async () => {
      safety.canMessage.mockResolvedValue({
        kind: 'silentDrop',
        reason: 'BLOCKED_BY_RECIPIENT',
      });

      const result = await service.sendMessage(sender, recipient, 'hi');

      expect(result.delivered).toBe(false);
      expect(result.message.body).toBe('hi');
      expect(result.message.senderId).toBe(sender);
      expect(result.conversation.otherUser?.id).toBe(recipient);
      // The synthetic ids MUST look like real UUIDs so a determined
      // sender cannot infer "I was blocked" by inspecting the id shape.
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(result.message.id).toMatch(UUID_RE);
      expect(result.conversation.id).toMatch(UUID_RE);
      // No DB writes.
      expect(conv.create).not.toHaveBeenCalled();
      expect(msg.create).not.toHaveBeenCalled();
      expect(part.bulkCreate).not.toHaveBeenCalled();
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── listMessages cursor ───────────────────────────

  describe('listMessages', () => {
    it('rejects a cursor message that is not in the conversation', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      msg.findOne.mockResolvedValue(null);
      await expect(
        service.listMessages('u', 'c', { before: 'm-x', limit: 50 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns nextBefore when there are more rows than the requested limit', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const rows = Array.from({ length: 51 }, (_, i) => ({
        id: `m-${i}`,
        conversationId: 'c',
        senderId: 'u',
        kind: MessageKind.TEXT,
        body: `b${i}`,
        deletedAt: null,
        createdAt: new Date(Date.now() - i * 1000),
      }));
      msg.findAll.mockResolvedValue(rows);

      const result = await service.listMessages('u', 'c', { limit: 50 });

      expect(result.items).toHaveLength(50);
      expect(result.nextBefore).toBe('m-49');
    });

    it('returns nextBefore:null when fewer than limit rows exist', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      msg.findAll.mockResolvedValue([
        {
          id: 'm-0',
          conversationId: 'c',
          senderId: 'u',
          kind: MessageKind.TEXT,
          body: 'hi',
          deletedAt: null,
          createdAt: new Date(),
        },
      ]);

      const result = await service.listMessages('u', 'c', { limit: 50 });

      expect(result.items).toHaveLength(1);
      expect(result.nextBefore).toBeNull();
    });
  });

  // ─────────────────────────── Stage 5: abuse-defense wiring ───────────

  describe('sendMessage abuse-defense wiring', () => {
    const sender = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const recipient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    function mockNoExistingConversation() {
      conv.findOne.mockResolvedValue(null);
    }
    function mockCreatedConversation(id: string) {
      conv.create.mockResolvedValue({ id });
    }
    function mockMessageCreate(id: string, conversationId: string) {
      // `create` returns the full row (INSERT … RETURNING); the send
      // path uses it directly instead of re-fetching by id.
      const row = {
        id,
        conversationId,
        senderId: sender,
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date(),
      };
      msg.create.mockResolvedValue(row);
      msg.findByPk.mockResolvedValue(row);
    }
    function mockListItemAfterSend(conversationId: string) {
      // Both participant rows come back from one findAll (user included
      // on the other side) — the send path no longer re-reads the
      // conversation, it patches the row it just wrote.
      part.findAll.mockResolvedValue([
        {
          conversationId: conversationId,
          userId: sender,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
        {
          conversationId: conversationId,
          userId: recipient,
          lastReadAt: null,
          leftAt: null,
          user: {
            id: recipient,
            firstName: 'Bob',
            lastName: 'Builder',
            avatarUrl: null,
          },
        },
      ]);
    }

    it('rate-limit check runs BEFORE the User.findByPk recipient lookup', async () => {
      rateLimit.assertSendAllowed.mockRejectedValueOnce(new Error('limit hit'));
      await expect(
        service.sendMessage(sender, recipient, 'hi'),
      ).rejects.toThrow('limit hit');
      // The recipient lookup must NOT have run — that's the contract:
      // cheapest reject first, no DB touch for a flooding user.
      expect(userFindByPkSpy).not.toHaveBeenCalled();
      expect(safety.canMessage).not.toHaveBeenCalled();
    });

    it('threat scan attached to response and persisted on message.metadata', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'B',
        lastName: 'B',
        avatarUrl: null,
      });
      content.detectThreats.mockReturnValue({
        urls: ['https://bit.ly/x'],
        hasShortenerUrl: true,
        hasOffPlatformContact: false,
        hasPaymentHandle: false,
        anyFlag: true,
      });
      mockNoExistingConversation();
      mockCreatedConversation('conv-1');
      mockMessageCreate('msg-1', 'conv-1');
      mockListItemAfterSend('conv-1');

      const result = await service.sendMessage(
        sender,
        recipient,
        'check https://bit.ly/x',
      );

      expect(result.threatFlags.hasShortenerUrl).toBe(true);
      expect(msg.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            threatFlags: expect.objectContaining({ hasShortenerUrl: true }),
          }),
        }),
        expect.anything(),
      );
    });

    it('velocity recorder called AFTER commit, not inside the tx', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'B',
        lastName: 'B',
        avatarUrl: null,
      });
      mockNoExistingConversation();
      mockCreatedConversation('conv-1');
      mockMessageCreate('msg-1', 'conv-1');
      mockListItemAfterSend('conv-1');

      // Track the order in which our tx callback finished vs velocity.
      let txClosedAt = -1;
      let velocityCalledAt = -1;
      let tick = 0;
      const realImpl = sequelize.transaction.getMockImplementation()!;
      sequelize.transaction.mockImplementationOnce(async (cb) => {
        const r = await realImpl(cb);
        txClosedAt = ++tick;
        return r;
      });
      velocity.recordSendAndMaybeAlarm.mockImplementation(() => {
        velocityCalledAt = ++tick;
        return Promise.resolve();
      });

      await service.sendMessage(sender, recipient, 'hi');

      // velocity is fire-and-forget, may resolve before the outer await
      // returns, but it MUST be called AFTER the tx closed.
      expect(txClosedAt).toBeGreaterThan(0);
      expect(velocityCalledAt).toBeGreaterThan(txClosedAt);
    });

    it('silent-drop path: threat flags still computed and returned (FE warns sender either way)', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'B',
        lastName: 'B',
        avatarUrl: null,
      });
      safety.canMessage.mockResolvedValueOnce({
        kind: 'silentDrop',
        reason: 'BLOCKED_BY_RECIPIENT',
      });
      content.detectThreats.mockReturnValue({
        urls: [],
        hasShortenerUrl: false,
        hasOffPlatformContact: true,
        hasPaymentHandle: false,
        anyFlag: true,
      });

      const result = await service.sendMessage(
        sender,
        recipient,
        'add me on telegram',
      );

      expect(result.delivered).toBe(false);
      expect(result.threatFlags.hasOffPlatformContact).toBe(true);
      // No row written, no velocity fired.
      expect(msg.create).not.toHaveBeenCalled();
      expect(velocity.recordSendAndMaybeAlarm).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── Stage 6: notification wiring ───────────

  describe('sendMessage notification wiring', () => {
    const sender = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const recipient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    function setupHappyPath(convId: string) {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
      conv.findOne.mockResolvedValue(null);
      conv.create.mockResolvedValue({ id: convId });
      // `create` returns the full row (INSERT … RETURNING); the send
      // path uses it directly instead of re-fetching by id.
      const row = {
        id: 'm-1',
        conversationId: convId,
        senderId: sender,
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date(),
      };
      msg.create.mockResolvedValue(row);
      msg.findByPk.mockResolvedValue(row);
      // Both participant rows come back from one findAll (user included
      // on the other side) — the send path no longer re-reads the
      // conversation, it patches the row it just wrote.
      part.findAll.mockResolvedValue([
        {
          conversationId: convId,
          userId: sender,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
        {
          conversationId: convId,
          userId: recipient,
          lastReadAt: null,
          leftAt: null,
          user: {
            id: recipient,
            firstName: 'Bob',
            lastName: 'Builder',
            avatarUrl: null,
          },
        },
      ]);
    }

    it('fires notify exactly once on happy path, to the recipient, with MESSAGE_RECEIVED type', async () => {
      setupHappyPath('conv-1');

      // The dispatch is fire-and-forget; await a tick so the floating
      // promise resolves before we assert.
      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      expect(notifications.notify).toHaveBeenCalledTimes(1);
      const params = notifications.notify.mock.calls[0][0] as {
        userId: string;
        type: NotificationType;
        channelOverride?: { email?: boolean };
      };
      expect(params.userId).toBe(recipient);
      expect(params.type).toBe(NotificationType.MESSAGE_RECEIVED);
    });

    it('on first message in conversation: in_app off, email on', async () => {
      // Policy: bell never sees per-message rows (sidebar Messages badge
      // is the persistent in-app signal). Email goes through on the
      // first message of the (recipient, conversation) hour-window.
      setupHappyPath('conv-1');
      rateLimit.shouldSuppressMessageEmail.mockReturnValue(false);

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      const params = notifications.notify.mock.calls[0][0] as {
        channelOverride?: { in_app?: boolean; email?: boolean };
      };
      expect(params.channelOverride).toEqual({ in_app: false, email: true });
    });

    it('when shouldSuppressMessageEmail returns true: both in_app and email suppressed', async () => {
      setupHappyPath('conv-1');
      rateLimit.shouldSuppressMessageEmail.mockReturnValue(true);

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      const params = notifications.notify.mock.calls[0][0] as {
        channelOverride?: { in_app?: boolean; email?: boolean };
      };
      expect(params.channelOverride).toEqual({ in_app: false, email: false });
    });

    it('quiet-period gate is called with the previous-message timestamp from the conversation row', async () => {
      // The new policy passes `conversation.lastMessageAt` (the value
      // BEFORE this send wrote a new one). For a brand-new
      // conversation that field is undefined/null on the fresh row
      // returned from `create`, which the helper treats as "no
      // previous" → allow.
      setupHappyPath('conv-1');
      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      expect(rateLimit.shouldSuppressMessageEmail).toHaveBeenCalledTimes(1);
      const arg = rateLimit.shouldSuppressMessageEmail.mock.calls[0][0];
      // Mock returns an object without `lastMessageAt`, so the
      // gate gets undefined — equivalent to "no previous message".
      expect(arg ?? null).toBeNull();
    });

    it('previous-message timestamp from an existing conversation drives the gate', async () => {
      // Build a scenario with an existing conversation whose
      // lastMessageAt is in the recent past — the gate should be
      // called with that Date instance.
      const prev = new Date(Date.now() - 5 * 60_000); // 5 min ago
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
      conv.findOne.mockResolvedValue({ id: 'conv-x', lastMessageAt: prev });
      const row = {
        id: 'm-2',
        conversationId: 'conv-x',
        senderId: sender,
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date(),
      };
      msg.create.mockResolvedValue(row);
      msg.findByPk.mockResolvedValue(row);
      part.findAll.mockResolvedValue([
        {
          conversationId: 'conv-x',
          userId: sender,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
        {
          conversationId: 'conv-x',
          userId: recipient,
          lastReadAt: null,
          leftAt: null,
          user: {
            id: recipient,
            firstName: 'Bob',
            lastName: 'Builder',
            avatarUrl: null,
          },
        },
      ]);

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      expect(rateLimit.shouldSuppressMessageEmail).toHaveBeenCalledTimes(1);
      const arg = rateLimit.shouldSuppressMessageEmail.mock.calls[0][0];
      expect(arg).toBe(prev);
    });

    it('silent-drop path: NO notification fired (recipient blocked sender)', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'B',
        lastName: 'B',
        avatarUrl: null,
      });
      safety.canMessage.mockResolvedValueOnce({
        kind: 'silentDrop',
        reason: 'BLOCKED_BY_RECIPIENT',
      });

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      expect(notifications.notify).not.toHaveBeenCalled();
      expect(rateLimit.shouldSuppressMessageEmail).not.toHaveBeenCalled();
    });

    it('notify failure must NOT roll back the send (fire-and-forget swallow)', async () => {
      setupHappyPath('conv-1');
      notifications.notify.mockRejectedValue(new Error('downstream blew up'));

      const result = await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      // Message still delivered, returned as success.
      expect(result.delivered).toBe(true);
      expect(result.message.id).toBe('m-1');
    });

    it('notification is dispatched AFTER the surrounding transaction closes', async () => {
      setupHappyPath('conv-1');

      let txClosedAt = -1;
      let notifyCalledAt = -1;
      let tick = 0;
      const realImpl = sequelize.transaction.getMockImplementation()!;
      sequelize.transaction.mockImplementationOnce(async (cb) => {
        const r = await realImpl(cb);
        txClosedAt = ++tick;
        return r;
      });
      notifications.notify.mockImplementation(() => {
        notifyCalledAt = ++tick;
        return Promise.resolve();
      });

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      expect(txClosedAt).toBeGreaterThan(0);
      expect(notifyCalledAt).toBeGreaterThan(txClosedAt);
    });
  });

  // ─────────────────────────── Stage 7: SSE event emit wiring ─────────

  describe('SSE emit wiring', () => {
    const sender = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const recipient = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    function setupHappyPath(convId: string) {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
      conv.findOne.mockResolvedValue(null);
      conv.create.mockResolvedValue({ id: convId });
      // `create` returns the full row (INSERT … RETURNING); the send
      // path uses it directly instead of re-fetching by id.
      const row = {
        id: 'm-1',
        conversationId: convId,
        senderId: sender,
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date('2026-05-12T10:00:00Z'),
      };
      msg.create.mockResolvedValue(row);
      msg.findByPk.mockResolvedValue(row);
      // Both participant rows come back from one findAll (user included
      // on the other side) — the send path no longer re-reads the
      // conversation, it patches the row it just wrote.
      part.findAll.mockResolvedValue([
        {
          conversationId: convId,
          userId: sender,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
        {
          conversationId: convId,
          userId: recipient,
          lastReadAt: null,
          leftAt: null,
          user: {
            id: recipient,
            firstName: 'Bob',
            lastName: 'Builder',
            avatarUrl: null,
          },
        },
      ]);
    }

    it('sendMessage emits message.created ONLY to the recipient (not sender)', async () => {
      setupHappyPath('conv-1');

      await service.sendMessage(sender, recipient, 'hi');

      expect(emitter.emitMessageCreated).toHaveBeenCalledTimes(1);
      const [recipientIds, payload] = emitter.emitMessageCreated.mock.calls[0];
      expect(recipientIds).toEqual([recipient]);
      expect(recipientIds).not.toContain(sender);
      expect(payload.conversationId).toBe('conv-1');
      expect(payload.message.id).toBe('m-1');
    });

    it('silent-drop path: NO emit (recipient blocked sender)', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'B',
        lastName: 'B',
        avatarUrl: null,
      });
      safety.canMessage.mockResolvedValueOnce({
        kind: 'silentDrop',
        reason: 'BLOCKED_BY_RECIPIENT',
      });

      await service.sendMessage(sender, recipient, 'hi');

      expect(emitter.emitMessageCreated).not.toHaveBeenCalled();
    });

    it('markRead emits conversation.read to the *other* participants', async () => {
      part.findAll.mockResolvedValue([{ userId: recipient }]);

      await service.markRead(sender, 'conv-1');

      expect(emitter.emitConversationRead).toHaveBeenCalledTimes(1);
      const [recipientIds, payload] =
        emitter.emitConversationRead.mock.calls[0];
      expect(recipientIds).toEqual([recipient]);
      expect(payload.userId).toBe(sender);
      expect(payload.conversationId).toBe('conv-1');
    });

    // ── Audit-driven regression guards ──────────────────────────

    it('getMessage: 404 when message id is unknown', async () => {
      msg.findByPk.mockResolvedValue(null);
      await expect(
        service.getMessage('user-1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getMessage: 404 when caller is not a participant in the conversation (no existence leak)', async () => {
      msg.findByPk.mockResolvedValue({
        id: 'm-1',
        conversationId: 'someones-other-conv',
        senderId: 'other-user',
        kind: MessageKind.TEXT,
        body: 'secret',
        deletedAt: null,
        createdAt: new Date(),
      });
      safety.assertParticipant.mockRejectedValueOnce(
        new NotFoundException('Conversation not found.'),
      );
      await expect(
        service.getMessage('not-a-participant', 'm-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getMessage: returns the view when caller IS a participant', async () => {
      msg.findByPk.mockResolvedValue({
        id: 'm-1',
        conversationId: 'c-1',
        senderId: 'sender',
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date(),
      });
      safety.assertParticipant.mockResolvedValueOnce(undefined);
      const view = await service.getMessage('participant', 'm-1');
      expect(view.body).toBe('hi');
    });

    it('deleteOwnMessage emits message.deleted to other participants', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      msg.findByPk.mockResolvedValue({
        id: 'm-1',
        senderId: sender,
        conversationId: 'conv-1',
        kind: MessageKind.TEXT,
        body: 'secret',
        deletedAt: null,
        createdAt: new Date(),
        update,
      });
      part.findAll.mockResolvedValue([{ userId: recipient }]);

      await service.deleteOwnMessage(sender, 'm-1');

      expect(emitter.emitMessageDeleted).toHaveBeenCalledTimes(1);
      const [recipientIds, payload] = emitter.emitMessageDeleted.mock.calls[0];
      expect(recipientIds).toEqual([recipient]);
      expect(payload.messageId).toBe('m-1');
    });
  });

  // ───────────────── query shape (round trips per request) ────────────
  //
  // These assert *how many* queries a request costs, not just its
  // result. Every one of them is a network round trip to Postgres, so a
  // handler that quietly grows one per conversation is a latency bug
  // that no correctness test would catch.

  describe('query shape', () => {
    const me = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    function directRow(id: string, lastReadAt: Date | null = null) {
      return {
        conversationId: id,
        userId: me,
        lastReadAt,
        mutedUntil: null,
        leftAt: null,
        conversation: {
          id,
          type: ConversationType.DIRECT,
          name: null,
          avatarUrl: null,
          lastMessageAt: new Date('2026-05-11T10:00:00Z'),
          lastMessagePreview: 'hi',
        },
      };
    }

    it('getUnreadCount totals one grouped query instead of counting per thread', async () => {
      part.findAll.mockResolvedValue([
        { conversationId: 'c1', lastReadAt: null },
        { conversationId: 'c2', lastReadAt: new Date('2026-05-01T00:00:00Z') },
        { conversationId: 'c3', lastReadAt: null },
      ]);
      msg.findAll.mockResolvedValue([
        { conversationId: 'c1', count: '2' },
        { conversationId: 'c3', count: 5 },
      ]);

      const result = await service.getUnreadCount(me);

      expect(result).toEqual({ count: 7 });
      expect(msg.findAll).toHaveBeenCalledTimes(1);
      // The old shape was one count() per conversation, serially.
      expect(msg.count).not.toHaveBeenCalled();
    });

    it('getUnreadCount asks nothing further when the user has no threads', async () => {
      part.findAll.mockResolvedValue([]);

      expect(await service.getUnreadCount(me)).toEqual({ count: 0 });
      expect(msg.findAll).not.toHaveBeenCalled();
    });

    it('listConversations costs the same number of queries for 1 thread as for 20', async () => {
      const countQueriesFor = async (size: number) => {
        jest.clearAllMocks();
        const rows = Array.from({ length: size }, (_, i) => directRow(`c${i}`));
        part.findAndCountAll.mockResolvedValue({ rows, count: size });
        msg.findAll.mockResolvedValue(
          rows.map((r) => ({ conversationId: r.conversationId, count: 1 })),
        );
        part.findAll.mockResolvedValue(
          rows.map((r) => ({
            conversationId: r.conversationId,
            userId: other,
            lastReadAt: null,
            user: {
              id: other,
              firstName: 'Bob',
              lastName: 'Builder',
              avatarUrl: null,
              handle: null,
            },
          })),
        );

        const page = await service.listConversations(me, 1, 50);
        expect(page.items).toHaveLength(size);
        expect(page.items[0].unreadCount).toBe(1);
        expect(page.items[0].otherUser?.id).toBe(other);

        return {
          unreadQueries:
            msg.findAll.mock.calls.length + msg.count.mock.calls.length,
          participantQueries: part.findAll.mock.calls.length,
        };
      };

      expect(await countQueriesFor(1)).toEqual({
        unreadQueries: 1,
        participantQueries: 1,
      });
      expect(await countQueriesFor(20)).toEqual({
        unreadQueries: 1,
        participantQueries: 1,
      });
    });

    it('sendMessage returns the inserted row rather than reading it back', async () => {
      userFindByPkSpy.mockResolvedValue({
        id: other,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
        isActive: true,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      });
      conv.findOne.mockResolvedValue({
        id: 'c1',
        type: ConversationType.DIRECT,
        name: null,
        avatarUrl: null,
        lastMessageAt: null,
        lastMessagePreview: null,
      });
      msg.create.mockResolvedValue({
        id: 'm-1',
        conversationId: 'c1',
        senderId: me,
        kind: MessageKind.TEXT,
        body: 'hello',
        deletedAt: null,
        createdAt: new Date('2026-05-11T10:00:00Z'),
      });
      part.findAll.mockResolvedValue([
        {
          conversationId: 'c1',
          userId: me,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
        {
          conversationId: 'c1',
          userId: other,
          lastReadAt: null,
          leftAt: null,
          user: {
            id: other,
            firstName: 'Bob',
            lastName: 'Builder',
            avatarUrl: null,
            handle: null,
          },
        },
      ]);

      const result = await service.sendMessage(me, other, 'hello');

      expect(result.message.id).toBe('m-1');
      expect(result.message.body).toBe('hello');
      // The INSERT already returned the row.
      expect(msg.findByPk).not.toHaveBeenCalled();
      // And the conversation row we just wrote is not read back either.
      expect(conv.findOne).toHaveBeenCalledTimes(1);
      expect(result.conversation.lastMessagePreview).toBe('hello');
    });

    it('sendMessage hands the sender it already loaded to the safety gate', async () => {
      const createdAt = new Date('2020-01-01T00:00:00Z');
      userFindByPkSpy.mockResolvedValue({
        id: other,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
        isActive: true,
        createdAt,
      });
      conv.findOne.mockResolvedValue({
        id: 'c1',
        type: ConversationType.DIRECT,
      });
      msg.create.mockResolvedValue({
        id: 'm-1',
        conversationId: 'c1',
        senderId: me,
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date(),
      });
      part.findAll.mockResolvedValue([
        {
          conversationId: 'c1',
          userId: me,
          lastReadAt: null,
          mutedUntil: null,
          leftAt: null,
        },
      ]);

      await service.sendMessage(me, other, 'hi');

      expect(safety.canMessage).toHaveBeenCalledWith(
        me,
        other,
        expect.objectContaining({ senderCreatedAt: createdAt }),
      );
    });
  });
});
