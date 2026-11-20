import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';

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
import { MessageAttachment } from './entities/message-attachment.entity';
import { ShareService } from '../share/share.service';
import { User } from '../user/entities/user.entity';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';
import { apiError } from '../../common/i18n';

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
  let safety: {
    canMessage: jest.Mock;
    assertParticipant: jest.Mock;
    deliveryFor: jest.Mock;
    requestsStartedSince: jest.Mock;
    requestLimitsFor: jest.Mock;
    requestContextsFor: jest.Mock;
    messagePolicyOf: jest.Mock;
  };
  let content: { detectThreats: jest.Mock };
  let rateLimit: {
    assertSendAllowed: jest.Mock;
    assertConversationSendAllowed: jest.Mock;
    shouldSuppressMessageEmail: jest.Mock;
  };
  let velocity: { recordSendAndMaybeAlarm: jest.Mock };
  let attachments: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    destroy: jest.Mock;
  };
  let share: { cardsFor: jest.Mock; shareableCard: jest.Mock };
  let notifications: { notify: jest.Mock };
  let emitter: {
    emitMessageCreated: jest.Mock;
    emitMessageDeleted: jest.Mock;
    emitConversationRead: jest.Mock;
    emitConversationMuted: jest.Mock;
    emitConversationUnread: jest.Mock;
    emitConversationCleared: jest.Mock;
    emitConversationAccepted: jest.Mock;
    emitConversationDeclined: jest.Mock;
    emitConversationArchived: jest.Mock;
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
    escape: (value: string) => `'${value.replace(/'/g, "''")}'`,
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
      // Default: connected, so a first message lands straight in the chat
      // as it did before message requests. Request tests override.
      deliveryFor: jest.fn().mockResolvedValue({ kind: 'direct' }),
      requestsStartedSince: jest.fn().mockResolvedValue(0),
      requestLimitsFor: jest.fn().mockResolvedValue(new Map()),
      requestContextsFor: jest.fn().mockResolvedValue(new Map()),
      messagePolicyOf: jest.fn().mockResolvedValue('REQUESTS'),
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
      assertConversationSendAllowed: jest.fn().mockResolvedValue(undefined),
      shouldSuppressMessageEmail: jest.fn().mockReturnValue(false),
    };
    velocity = {
      recordSendAndMaybeAlarm: jest.fn().mockResolvedValue(undefined),
    };
    attachments = {
      create: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      destroy: jest.fn().mockResolvedValue(0),
    };
    share = {
      cardsFor: jest.fn().mockResolvedValue(new Map()),
      shareableCard: jest.fn().mockResolvedValue(null),
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
      emitConversationUnread: jest.fn(),
      emitConversationCleared: jest.fn(),
      emitConversationAccepted: jest.fn(),
      emitConversationDeclined: jest.fn(),
      emitConversationArchived: jest.fn(),
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
        { provide: getModelToken(MessageAttachment), useValue: attachments },
        { provide: ShareService, useValue: share },
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
      // One write for the read position, one to clear a "mark as unread".
      expect(part.update).toHaveBeenCalledTimes(2);
      expect(part.update.mock.calls[0][0]).toEqual({ lastReadAt });
    });

    it('clears a "mark as unread" and tells the reader\'s other sessions', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      part.update
        .mockResolvedValueOnce([1]) // lastReadAt
        .mockResolvedValueOnce([1]); // markedUnread: the row carried the flag

      await service.markRead('user-1', 'conv-1');

      const [values, options] = part.update.mock.calls[1];
      expect(values).toEqual({ markedUnread: false });
      expect(options.where).toEqual({
        conversationId: 'conv-1',
        userId: 'user-1',
        leftAt: null,
        markedUnread: true,
      });
      expect(emitter.emitConversationUnread).toHaveBeenCalledWith(['user-1'], {
        conversationId: 'conv-1',
        userId: 'user-1',
        markedUnread: false,
      });
    });

    it('stays quiet towards the reader when nothing was marked unread', async () => {
      // markRead also fires on every burst of live messages; an event
      // per read would be noise on every one of the reader's devices.
      part.findOne.mockResolvedValue({ id: 'p-1' });
      part.update.mockResolvedValueOnce([1]).mockResolvedValueOnce([0]);

      await service.markRead('user-1', 'conv-1');

      expect(emitter.emitConversationUnread).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── markUnread ───────────────────────────

  describe('markUnread', () => {
    it('sets the flag without moving the read position', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });

      const result = await service.markUnread('user-1', 'conv-1');

      expect(result).toEqual({ markedUnread: true });
      expect(part.update).toHaveBeenCalledTimes(1);
      const [values, options] = part.update.mock.calls[0];
      expect(values).toEqual({ markedUnread: true });
      expect(options.where).toEqual({
        conversationId: 'conv-1',
        userId: 'user-1',
        leftAt: null,
      });
      // The other participant's read receipt depends on lastReadAt.
      expect(emitter.emitConversationRead).not.toHaveBeenCalled();
    });

    it('emits a conversation.unread SSE event to the actor only', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });

      await service.markUnread('user-1', 'conv-1');

      expect(emitter.emitConversationUnread).toHaveBeenCalledWith(['user-1'], {
        conversationId: 'conv-1',
        userId: 'user-1',
        markedUnread: true,
      });
    });

    it('404s for a non-participant', async () => {
      safety.assertParticipant.mockRejectedValueOnce(
        new NotFoundException('Conversation not found.'),
      );
      await expect(
        service.markUnread('user-x', 'conv-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(part.update).not.toHaveBeenCalled();
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

  // ─────────────────────────── clearConversation ───────────────────────────

  describe('clearConversation', () => {
    it("moves the caller's floor and drops a pending mark, deleting nothing", async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });
      const before = Date.now();

      const { clearedAt } = await service.clearConversation('user-1', 'conv-1');

      expect(clearedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(part.update).toHaveBeenCalledTimes(1);
      const [values, options] = part.update.mock.calls[0];
      expect(values).toEqual({ clearedAt, markedUnread: false });
      expect(options.where).toEqual({
        conversationId: 'conv-1',
        userId: 'user-1',
        leftAt: null,
      });
      // The other side and moderation keep every message.
      expect(msg.create).not.toHaveBeenCalled();
      expect(conv.update).not.toHaveBeenCalled();
    });

    it('emits a conversation.cleared SSE event to the actor only', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1' });

      const { clearedAt } = await service.clearConversation('user-1', 'conv-1');

      expect(emitter.emitConversationCleared).toHaveBeenCalledWith(['user-1'], {
        conversationId: 'conv-1',
        userId: 'user-1',
        clearedAt: clearedAt.toISOString(),
      });
    });

    it('404s for a non-participant', async () => {
      safety.assertParticipant.mockRejectedValueOnce(
        new NotFoundException('Conversation not found.'),
      );
      await expect(
        service.clearConversation('user-x', 'conv-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(part.update).not.toHaveBeenCalled();
      expect(emitter.emitConversationCleared).not.toHaveBeenCalled();
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

    it('rebuilds the inbox preview, so the deleted words stop showing there', async () => {
      msg.findByPk.mockResolvedValue({
        id: 'm-2',
        senderId: 'u',
        conversationId: 'c-1',
        kind: MessageKind.TEXT,
        body: 'secret',
        deletedAt: null,
        createdAt: new Date(),
        update: jest.fn().mockResolvedValue(undefined),
      });
      // The message before it is now the latest one left.
      msg.findOne.mockResolvedValue({ body: 'see you Monday' });

      await service.deleteOwnMessage('u', 'm-2');

      expect(conv.update).toHaveBeenCalledWith(
        {
          lastMessagePreview: 'see you Monday',
          lastMessageAttachmentType: null,
        },
        expect.objectContaining({ where: { id: 'c-1' } }),
      );
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
        reason: apiError('messaging.suspended'),
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
        reason: apiError('messaging.newAccountLimited'),
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

    it('leaves out what came before the reader deleted the chat', async () => {
      const clearedAt = new Date('2026-10-01T00:00:00Z');
      part.findOne.mockResolvedValue({ id: 'p-1', clearedAt });
      msg.findAll.mockResolvedValue([]);

      await service.listMessages('u', 'c', { limit: 50 });

      expect(msg.findAll.mock.calls[0][0].where.createdAt).toEqual({
        [Op.gt]: clearedAt,
      });
    });

    it('keeps the delete floor under an older-page cursor', async () => {
      const clearedAt = new Date('2026-10-01T00:00:00Z');
      const cursorAt = new Date('2026-10-05T00:00:00Z');
      part.findOne.mockResolvedValue({ id: 'p-1', clearedAt });
      msg.findOne.mockResolvedValue({ id: 'm-x', createdAt: cursorAt });
      msg.findAll.mockResolvedValue([]);

      await service.listMessages('u', 'c', { before: 'm-x', limit: 50 });

      expect(msg.findAll.mock.calls[0][0].where.createdAt).toEqual({
        [Op.gt]: clearedAt,
        [Op.lt]: cursorAt,
      });
    });
  });

  describe('getMessage after "Delete chat"', () => {
    const clearedAt = new Date('2026-10-01T00:00:00Z');
    const row = (createdAt: Date) => ({
      id: 'm-1',
      conversationId: 'c',
      senderId: 'other',
      kind: MessageKind.TEXT,
      body: 'hi',
      deletedAt: null,
      createdAt,
    });

    it('404s for a message the reader deleted with the chat', async () => {
      msg.findByPk.mockResolvedValue(row(new Date('2026-09-30T00:00:00Z')));
      part.findOne.mockResolvedValue({ id: 'p-1', clearedAt });

      await expect(service.getMessage('u', 'm-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns a message sent after the delete', async () => {
      msg.findByPk.mockResolvedValue(row(new Date('2026-10-02T00:00:00Z')));
      part.findOne.mockResolvedValue({ id: 'p-1', clearedAt });

      expect((await service.getMessage('u', 'm-1')).id).toBe('m-1');
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

    function setupHappyPath(
      convId: string,
      recipientMutedUntil: Date | null = null,
    ) {
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
          mutedUntil: recipientMutedUntil,
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

    it('on first message in conversation: in_app off, email left to the preference', async () => {
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
      // No email key: the person's own email preference decides.
      expect(params.channelOverride).toEqual({ in_app: false });
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

    it('keeps the phone quiet when the recipient muted the conversation', async () => {
      setupHappyPath('conv-1', new Date(Date.now() + 60 * 60 * 1000));
      rateLimit.shouldSuppressMessageEmail.mockReturnValue(false);

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      const params = notifications.notify.mock.calls[0][0] as {
        channelOverride?: { push?: boolean };
      };
      expect(params.channelOverride?.push).toBe(false);
    });

    it('pushes again once a mute has run out', async () => {
      setupHappyPath('conv-1', new Date(Date.now() - 60 * 1000));

      await service.sendMessage(sender, recipient, 'hi');
      await new Promise((r) => setImmediate(r));

      const params = notifications.notify.mock.calls[0][0] as {
        channelOverride?: { push?: boolean };
      };
      expect(params.channelOverride).not.toHaveProperty('push');
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

    it("the sender's own previous message drives the gate, not the other side's", async () => {
      // The recipient wrote 2 minutes ago (the conversation's last message),
      // but the sender's own previous message is 3 hours old: the gate reads
      // the sender's, so the recipient, who may have left, gets the email.
      const prev = new Date(Date.now() - 3 * 60 * 60_000);
      const recipientsLast = new Date(Date.now() - 2 * 60_000);
      userFindByPkSpy.mockResolvedValue({
        id: recipient,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
      conv.findOne.mockResolvedValue({
        id: 'conv-x',
        lastMessageAt: recipientsLast,
      });
      msg.findOne.mockResolvedValueOnce({ createdAt: prev });
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
      expect(msg.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'conv-x', senderId: sender },
        }),
      );
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
      part.findOne.mockResolvedValue({ id: 'p-1', acceptedAt: new Date() });
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
      const acceptedAt = new Date('2026-04-01T00:00:00Z');
      part.findAll.mockResolvedValue([
        { conversationId: 'c1', lastReadAt: null, acceptedAt },
        {
          conversationId: 'c2',
          lastReadAt: new Date('2026-05-01T00:00:00Z'),
          acceptedAt,
        },
        { conversationId: 'c3', lastReadAt: null, acceptedAt },
      ]);
      msg.findAll.mockResolvedValue([
        { conversationId: 'c1', count: '2' },
        { conversationId: 'c3', count: 5 },
      ]);

      const result = await service.getUnreadCount(me);

      expect(result).toEqual({ count: 7, inbox: 7, requests: 0 });
      expect(msg.findAll).toHaveBeenCalledTimes(1);
      // The old shape was one count() per conversation, serially.
      expect(msg.count).not.toHaveBeenCalled();
    });

    it('getUnreadCount counts a thread marked unread as one when nothing in it is unread', async () => {
      const acceptedAt = new Date('2026-04-01T00:00:00Z');
      part.findAll.mockResolvedValue([
        {
          conversationId: 'c1',
          lastReadAt: null,
          markedUnread: true,
          acceptedAt,
        },
        {
          conversationId: 'c2',
          lastReadAt: null,
          markedUnread: true,
          acceptedAt,
        },
        {
          conversationId: 'c3',
          lastReadAt: null,
          markedUnread: false,
          acceptedAt,
        },
      ]);
      // c1 has real unread messages, so its mark adds nothing on top.
      msg.findAll.mockResolvedValue([{ conversationId: 'c1', count: 3 }]);

      expect(await service.getUnreadCount(me)).toEqual({
        count: 4,
        inbox: 4,
        requests: 0,
      });
    });

    it('getUnreadCount counts from a "Delete chat" when it is later than the last read', async () => {
      const lastReadAt = new Date('2026-09-01T00:00:00Z');
      const clearedAt = new Date('2026-10-01T00:00:00Z');
      part.findAll.mockResolvedValue([
        { conversationId: 'c1', lastReadAt, clearedAt },
        { conversationId: 'c2', lastReadAt: clearedAt, clearedAt: lastReadAt },
        { conversationId: 'c3', lastReadAt: null, clearedAt },
      ]);
      msg.findAll.mockResolvedValue([]);

      await service.getUnreadCount(me);

      const floors = msg.findAll.mock.calls[0][0].where[Op.or].map(
        (w: { createdAt: Record<symbol, Date> }) => w.createdAt[Op.gt],
      );
      expect(floors).toEqual([clearedAt, clearedAt, clearedAt]);
    });

    it('listConversations hides deleted chats with nothing newer, and quotes nothing pre-delete', async () => {
      const row = directRow('c1');
      const clearedAt = new Date('2026-05-12T00:00:00Z'); // after lastMessageAt
      part.findAndCountAll.mockResolvedValue({
        rows: [{ ...row, clearedAt }],
        count: 1,
      });
      msg.findAll.mockResolvedValue([]);

      const page = await service.listConversations(me, 1, 50);

      const where = part.findAndCountAll.mock.calls[0][0].where;
      expect(where[Op.or][0]).toEqual({ clearedAt: null });
      // And a chat with someone this user blocked stays out.
      const blockFilter = JSON.stringify(where[Op.and]);
      expect(blockFilter).toContain('user_block');
      expect(blockFilter).toContain(`b.blocker_id = '${me}'`);
      expect(page.items[0].lastMessagePreview).toBeNull();
      expect(page.items[0].lastMessageAt).toBeNull();
    });

    it('getUnreadCount asks nothing further when the user has no threads', async () => {
      part.findAll.mockResolvedValue([]);

      expect(await service.getUnreadCount(me)).toEqual({
        count: 0,
        inbox: 0,
        requests: 0,
      });
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
  // ─────────────────────────── message requests (migration 090) ───────

  describe('message requests', () => {
    const me = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const requestAt = new Date('2026-11-20T08:00:00Z');
    const accepted = new Date('2026-11-01T08:00:00Z');

    const conversation = {
      id: 'conv-r',
      type: ConversationType.DIRECT,
      name: null,
      avatarUrl: null,
      lastMessageAt: new Date('2026-11-20T08:00:00Z'),
      lastMessagePreview: 'hi',
    };

    interface RowState {
      acceptedAt?: Date | null;
      requestAt?: Date | null;
      declinedAt?: Date | null;
      archivedAt?: Date | null;
      mutedUntil?: Date | null;
    }

    function row(userId: string, state: RowState) {
      return {
        id: `p-${userId.slice(0, 1)}`,
        conversationId: conversation.id,
        userId,
        lastReadAt: null,
        mutedUntil: null,
        leftAt: null,
        clearedAt: null,
        acceptedAt: null,
        requestAt: null,
        declinedAt: null,
        archivedAt: null,
        markedUnread: false,
        conversation,
        user: {
          id: userId,
          firstName: 'Bob',
          lastName: 'Builder',
          avatarUrl: null,
        },
        ...state,
      };
    }

    /** The chat already exists: the lookup and the re-read after the send. */
    function existingChat(self: RowState, theirs: RowState) {
      const rows = [row(me, self), row(other, theirs)];
      part.findAll.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    }

    function sendable() {
      userFindByPkSpy.mockResolvedValue({
        id: other,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
      msg.findOne.mockResolvedValue(null);
      msg.create.mockResolvedValue({
        id: 'msg-r',
        conversationId: conversation.id,
        senderId: me,
        kind: MessageKind.TEXT,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date('2026-11-20T09:00:00Z'),
      });
    }

    function notifiedTypes(): string[] {
      return notifications.notify.mock.calls.map(
        (c: [{ type: string }]) => c[0].type,
      );
    }

    async function flush() {
      await new Promise((resolve) => setImmediate(resolve));
    }

    it('a first message to someone not connected starts a request: no email, one notice, waiting', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });
      part.findAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          row(me, { acceptedAt: accepted }),
          row(other, { requestAt }),
        ]);
      conv.findOne.mockResolvedValue(null);
      conv.create.mockResolvedValue({ ...conversation });

      const result = await service.sendMessage(me, other, 'hi');
      await flush();

      const created = part.bulkCreate.mock.calls[0][0] as Array<{
        userId: string;
        acceptedAt: Date | null;
        requestAt: Date | null;
      }>;
      const recipientRow = created.find((r) => r.userId === other);
      const senderRow = created.find((r) => r.userId === me);
      expect(recipientRow?.acceptedAt).toBeNull();
      expect(recipientRow?.requestAt).toBeInstanceOf(Date);
      expect(senderRow?.acceptedAt).toBeInstanceOf(Date);
      expect(result.conversation.waiting).toEqual({ remaining: 2 });
      expect(notifiedTypes()).toEqual([
        NotificationType.MESSAGE_REQUEST_RECEIVED,
      ]);
      expect(notifications.notify.mock.calls[0][0].channelOverride).toEqual({
        email: false,
      });
      expect(emitter.emitMessageCreated).toHaveBeenCalledWith(
        [other],
        expect.objectContaining({ isRequest: true }),
      );
    });

    it('a second message while waiting announces nothing and counts down', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });
      existingChat({ acceptedAt: accepted }, { requestAt });
      msg.count.mockResolvedValueOnce(1);

      const result = await service.sendMessage(me, other, 'hi');
      await flush();

      expect(result.conversation.waiting).toEqual({ remaining: 1 });
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(safety.requestsStartedSince).not.toHaveBeenCalled();
      expect(emitter.emitMessageCreated).toHaveBeenCalledTimes(1);
    });

    it('refuses past the limit while the request waits, and writes nothing', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });
      existingChat({ acceptedAt: accepted }, { requestAt });
      msg.count.mockResolvedValueOnce(3);

      await expect(service.sendMessage(me, other, 'hi')).rejects.toEqual(
        new ForbiddenException(
          apiError('messaging.requestWaiting', { name: 'Bob' }),
        ),
      );
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('a coach taking clients gets the higher limit from the safety service', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 10 });
      existingChat({ acceptedAt: accepted }, { requestAt });
      msg.count.mockResolvedValueOnce(3);

      const result = await service.sendMessage(me, other, 'hi');

      expect(result.conversation.waiting).toEqual({ remaining: 6 });
    });

    it('caps new requests a day with a 429', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });
      safety.requestsStartedSince.mockResolvedValue(20);
      part.findAll.mockResolvedValueOnce([]);

      const error = await service
        .sendMessage(me, other, 'hi')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect(conv.create).not.toHaveBeenCalled();
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('refuses plainly when the recipient takes messages from connections only', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({
        kind: 'refused',
        reason: apiError('messaging.connectionsOnly'),
      });
      part.findAll.mockResolvedValueOnce([]);

      await expect(service.sendMessage(me, other, 'hi')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('a declined request keeps the message but tells the recipient nothing', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });
      existingChat(
        { acceptedAt: accepted },
        { requestAt, declinedAt: new Date('2026-11-20T08:30:00Z') },
      );
      msg.count.mockResolvedValueOnce(1);

      const result = await service.sendMessage(me, other, 'hi');
      await flush();

      expect(result.delivered).toBe(true);
      expect(result.conversation.waiting).toEqual({ remaining: 1 });
      expect(msg.create).toHaveBeenCalledTimes(1);
      expect(emitter.emitMessageCreated).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('replying to a request accepts it, without asking the request rules', async () => {
      sendable();
      existingChat({ requestAt }, { acceptedAt: accepted });

      await service.sendMessage(me, other, 'hi');
      await flush();

      expect(safety.deliveryFor).not.toHaveBeenCalled();
      expect(part.update).toHaveBeenCalledWith(
        expect.objectContaining({ acceptedAt: expect.any(Date) }),
        expect.objectContaining({ where: { id: `p-${me.slice(0, 1)}` } }),
      );
      expect(emitter.emitConversationAccepted).toHaveBeenCalledWith(
        [me, other],
        expect.objectContaining({ userId: me }),
      );
      expect(notifiedTypes()).toEqual([NotificationType.MESSAGE_RECEIVED]);
    });

    it('once connected, a waiting request becomes a chat for the recipient', async () => {
      sendable();
      safety.deliveryFor.mockResolvedValue({ kind: 'direct' });
      existingChat({ acceptedAt: accepted }, { requestAt });

      const result = await service.sendMessage(me, other, 'hi');
      await flush();

      expect(part.update).toHaveBeenCalledWith(
        { acceptedAt: expect.any(Date), declinedAt: null },
        expect.objectContaining({ where: { id: `p-${other.slice(0, 1)}` } }),
      );
      expect(result.conversation.waiting).toBeNull();
      expect(notifiedTypes()).toEqual([NotificationType.MESSAGE_RECEIVED]);
    });

    it('an archived chat stays quiet: no push, no email', async () => {
      sendable();
      existingChat(
        { acceptedAt: accepted },
        { acceptedAt: accepted, archivedAt: new Date('2026-11-10T00:00:00Z') },
      );

      await service.sendMessage(me, other, 'hi');
      await flush();

      const override = notifications.notify.mock.calls[0][0].channelOverride;
      expect(override).toEqual({ in_app: false, email: false, push: false });
    });

    it('writing in a chat you archived brings it back', async () => {
      sendable();
      existingChat(
        { acceptedAt: accepted, archivedAt: new Date('2026-11-10T00:00:00Z') },
        { acceptedAt: accepted },
      );

      await service.sendMessage(me, other, 'hi');

      expect(part.update).toHaveBeenCalledWith(
        { acceptedAt: accepted, declinedAt: null, archivedAt: null },
        expect.objectContaining({ where: { id: `p-${me.slice(0, 1)}` } }),
      );
    });

    it('a blocked sender sees the same chat and the same waiting state, and nothing is written', async () => {
      sendable();
      safety.canMessage.mockResolvedValue({
        kind: 'silentDrop',
        reason: 'BLOCKED_BY_RECIPIENT',
      });
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });
      existingChat({ acceptedAt: accepted }, { requestAt });
      msg.count.mockResolvedValueOnce(1);

      const result = await service.sendMessage(me, other, 'hi');

      expect(result.delivered).toBe(false);
      expect(result.conversation.id).toBe(conversation.id);
      expect(result.conversation.waiting).toEqual({ remaining: 1 });
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('lists by folder', async () => {
      part.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.listConversations(me, 1, 20, 'requests');
      await service.listConversations(me, 1, 20, 'inbox');
      await service.listConversations(me, 1, 20, 'archived');
      await service.listConversations(me, 1, 20);

      const wheres = part.findAndCountAll.mock.calls.map(
        (c: [{ where: Record<string, unknown> }]) => c[0].where,
      );
      expect(wheres[0]).toMatchObject({ acceptedAt: null, declinedAt: null });
      expect(wheres[1]).toMatchObject({
        acceptedAt: { [Op.ne]: null },
        archivedAt: null,
      });
      expect(wheres[2]).toMatchObject({
        acceptedAt: { [Op.ne]: null },
        archivedAt: { [Op.ne]: null },
      });
      // Older apps: everything but a deleted request.
      expect(wheres[3]).toMatchObject({ declinedAt: null });
      expect(wheres[3]).not.toHaveProperty('acceptedAt');
    });

    it('request rows carry their context, waiting rows their count, and no read receipt', async () => {
      const incoming = { ...row(me, { requestAt }), conversationId: 'c-in' };
      const outgoing = {
        ...row(me, { acceptedAt: accepted }),
        conversationId: 'c-out',
      };
      part.findAndCountAll.mockResolvedValue({
        rows: [incoming, outgoing],
        count: 2,
      });
      msg.findAll
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ conversationId: 'c-out', count: 2 }]);
      part.findAll.mockResolvedValue([
        { ...row(other, { acceptedAt: accepted }), conversationId: 'c-in' },
        {
          ...row(other, { requestAt }),
          conversationId: 'c-out',
          lastReadAt: new Date('2026-11-20T09:30:00Z'),
        },
      ]);
      const context = {
        sharedGroupName: 'Morning Runners',
        sharedGroupCount: 1,
        isCoach: true,
      };
      safety.requestContextsFor.mockResolvedValue(new Map([[other, context]]));
      safety.requestLimitsFor.mockResolvedValue(new Map([[other, 3]]));

      const page = await service.listConversations(me, 1, 20);

      const [request, waiting] = page.items;
      expect(request.isRequest).toBe(true);
      expect(request.requestContext).toEqual(context);
      expect(request.waiting).toBeNull();
      expect(waiting.isRequest).toBe(false);
      expect(waiting.waiting).toEqual({ remaining: 1 });
      expect(waiting.lastReadByOther).toBeNull();
    });

    it('unread counts keep requests and archived chats out of the chats badge', async () => {
      part.findAll.mockResolvedValue([
        { conversationId: 'c1', lastReadAt: null, acceptedAt: accepted },
        {
          conversationId: 'c2',
          lastReadAt: null,
          acceptedAt: accepted,
          archivedAt: accepted,
        },
        {
          conversationId: 'c3',
          lastReadAt: null,
          acceptedAt: null,
          conversation: { lastMessageAt: requestAt },
        },
      ]);
      msg.findAll.mockResolvedValue([
        { conversationId: 'c1', count: 2 },
        { conversationId: 'c2', count: 4 },
        { conversationId: 'c3', count: 1 },
      ]);

      expect(await service.getUnreadCount(me)).toEqual({
        count: 7,
        inbox: 2,
        requests: 1,
      });
    });

    it('reading a request tells its sender nothing', async () => {
      part.findOne.mockResolvedValue({ id: 'p-1', acceptedAt: null });

      await service.markRead(me, 'conv-r');

      expect(emitter.emitConversationRead).not.toHaveBeenCalled();
    });

    it('accepting a request tells both sides', async () => {
      part.findOne.mockResolvedValue(row(me, { requestAt }));
      part.findAll.mockResolvedValue([{ userId: other }]);
      jest
        .spyOn(service, 'getConversation')
        .mockResolvedValue({ id: conversation.id } as never);

      await service.acceptRequest(me, conversation.id);

      expect(part.update).toHaveBeenCalledWith(
        { acceptedAt: expect.any(Date), declinedAt: null },
        { where: { id: `p-${me.slice(0, 1)}` } },
      );
      expect(emitter.emitConversationAccepted).toHaveBeenCalledWith(
        [me, other],
        expect.objectContaining({ userId: me }),
      );
    });

    it('deleting a request hides it for me and tells only my own sessions', async () => {
      part.findOne.mockResolvedValue(row(me, { requestAt }));

      await service.declineRequest(me, conversation.id);

      expect(part.update).toHaveBeenCalledWith(
        {
          declinedAt: expect.any(Date),
          clearedAt: expect.any(Date),
          markedUnread: false,
        },
        { where: { id: `p-${me.slice(0, 1)}` } },
      );
      expect(emitter.emitConversationDeclined).toHaveBeenCalledWith(
        [me],
        expect.anything(),
      );
    });

    it('only a request can be deleted as one, and only an accepted chat archived', async () => {
      part.findOne.mockResolvedValue(row(me, { acceptedAt: accepted }));
      await expect(
        service.declineRequest(me, conversation.id),
      ).rejects.toBeInstanceOf(BadRequestException);

      part.findOne.mockResolvedValue(row(me, { requestAt }));
      await expect(
        service.setArchived(me, conversation.id, true),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('archives and unarchives', async () => {
      part.findOne.mockResolvedValue(row(me, { acceptedAt: accepted }));

      await service.setArchived(me, conversation.id, true);
      await service.setArchived(me, conversation.id, false);

      expect(part.update.mock.calls[0][0]).toEqual({
        archivedAt: expect.any(Date),
      });
      expect(part.update.mock.calls[1][0]).toEqual({ archivedAt: null });
    });

    it('reach never reveals a block by the other person', async () => {
      part.findAll.mockResolvedValue([]);
      safety.canMessage.mockResolvedValue({
        kind: 'silentDrop',
        reason: 'BLOCKED_BY_RECIPIENT',
      });
      safety.deliveryFor.mockResolvedValue({ kind: 'request', limit: 3 });

      expect(await service.reach(me, other)).toEqual({
        status: 'REQUEST',
        requestLimit: 3,
      });
    });

    it('reach names the refusals the caller may know about', async () => {
      part.findAll.mockResolvedValue([]);
      safety.canMessage.mockResolvedValue({
        kind: 'forbidden',
        reason: apiError('messaging.youBlockedThem'),
      });
      expect((await service.reach(me, other)).status).toBe('YOU_BLOCKED');

      safety.canMessage.mockResolvedValue({ kind: 'allowed' });
      safety.deliveryFor.mockResolvedValue({
        kind: 'refused',
        reason: apiError('messaging.connectionsOnly'),
      });
      expect((await service.reach(me, other)).status).toBe('CONNECTIONS_ONLY');

      part.findAll.mockResolvedValue([
        row(me, { acceptedAt: accepted }),
        row(other, { acceptedAt: accepted }),
      ]);
      expect((await service.reach(me, other)).status).toBe('DIRECT');
    });
  });
  // ─────────────────────────── sharing (migration 092) ────────────────

  describe('sharing', () => {
    const me = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const sessionRef = {
      type: 'SESSION' as const,
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    };
    const card = {
      type: 'SESSION' as const,
      state: 'AVAILABLE' as const,
      name: 'Morning yoga flow',
      startAt: new Date('2026-11-21T08:00:00Z'),
      endAt: new Date('2026-11-21T09:00:00Z'),
      durationMinutes: 60,
      timezone: 'Europe/Bucharest',
      online: false,
      placeName: 'Herăstrău',
      placeCity: 'București',
      capacity: 12,
      confirmedCount: 8,
      priceCents: null,
      currency: null,
    };

    function sendable() {
      userFindByPkSpy.mockResolvedValue({
        id: other,
        firstName: 'Bob',
        lastName: 'Builder',
        avatarUrl: null,
      });
      const accepted = new Date('2026-11-01T00:00:00Z');
      const rows = [
        {
          id: 'p-a',
          conversationId: 'conv-s',
          userId: me,
          acceptedAt: accepted,
          leftAt: null,
          conversation: { id: 'conv-s', type: ConversationType.DIRECT },
        },
        {
          id: 'p-b',
          conversationId: 'conv-s',
          userId: other,
          acceptedAt: accepted,
          leftAt: null,
          conversation: { id: 'conv-s', type: ConversationType.DIRECT },
          user: { id: other, firstName: 'Bob', lastName: 'Builder' },
        },
      ];
      part.findAll.mockResolvedValue(rows);
      msg.findOne.mockResolvedValue(null);
      // INSERT ... RETURNING hands back the row as written.
      msg.create.mockImplementation((values: { body: string }) =>
        Promise.resolve({
          id: 'msg-s',
          conversationId: 'conv-s',
          senderId: me,
          kind: MessageKind.TEXT,
          body: values.body,
          deletedAt: null,
          createdAt: new Date('2026-11-20T09:00:00Z'),
        }),
      );
    }

    async function flush() {
      await new Promise((resolve) => setImmediate(resolve));
    }

    it('refuses something that is not public, before writing anything', async () => {
      sendable();
      share.shareableCard.mockResolvedValue(null);

      await expect(
        service.sendMessage(me, other, '', sessionRef),
      ).rejects.toEqual(
        new BadRequestException(apiError('messaging.notShareable')),
      );
      expect(msg.create).not.toHaveBeenCalled();
    });

    it('an empty message is still refused when it shares nothing', async () => {
      sendable();
      await expect(service.sendMessage(me, other, '  ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('stores the type and id only, and answers with the card and the name as body', async () => {
      sendable();
      share.shareableCard.mockResolvedValue(card);

      const result = await service.sendMessage(me, other, '', sessionRef);
      await flush();

      expect(attachments.create).toHaveBeenCalledWith(
        {
          messageId: 'msg-s',
          targetType: 'SESSION',
          targetId: sessionRef.id,
          position: 0,
        },
        expect.anything(),
      );
      expect(conv.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastMessagePreview: 'Morning yoga flow',
          lastMessageAttachmentType: 'SESSION',
        }),
        expect.anything(),
      );
      expect(result.message).toMatchObject({
        body: 'Morning yoga flow',
        caption: '',
        attachments: [{ type: 'SESSION', id: sessionRef.id, card }],
      });
      // The live event carries type and id; the card comes with the read.
      expect(
        emitter.emitMessageCreated.mock.calls[0][1].message.attachments,
      ).toEqual([sessionRef]);
      // Announced as a share, with the session's name.
      expect(notifications.notify.mock.calls[0][0].message).toEqual({
        key: 'messaging.shared',
        params: {
          name: 'Bob Builder',
          type: 'SESSION',
          title: 'Morning yoga flow',
        },
      });
    });

    it('with a caption, the caption is the message and the preview', async () => {
      sendable();
      share.shareableCard.mockResolvedValue(card);

      const result = await service.sendMessage(
        me,
        other,
        'Thursday has 4 spots',
        sessionRef,
      );
      await flush();

      expect(result.message.body).toBe('Thursday has 4 spots');
      expect(result.message.caption).toBe('Thursday has 4 spots');
      expect(notifications.notify.mock.calls[0][0].message.key).toBe(
        'messaging.received',
      );
    });

    it('reads cards for a page of messages in one go, and none for a deleted one', async () => {
      msg.findAll.mockResolvedValue([
        {
          id: 'm-1',
          conversationId: 'c',
          senderId: other,
          kind: MessageKind.TEXT,
          body: '',
          deletedAt: null,
          createdAt: new Date(),
        },
        {
          id: 'm-2',
          conversationId: 'c',
          senderId: other,
          kind: MessageKind.TEXT,
          body: '[deleted]',
          deletedAt: new Date(),
          createdAt: new Date(),
        },
      ]);
      part.findOne.mockResolvedValue({ clearedAt: null });
      attachments.findAll.mockResolvedValue([
        {
          messageId: 'm-1',
          targetType: 'SESSION',
          targetId: sessionRef.id,
          position: 0,
        },
      ]);
      share.cardsFor.mockResolvedValue(
        new Map([[`SESSION:${sessionRef.id}`, card]]),
      );

      const page = await service.listMessages(me, 'c', { limit: 25 });

      expect(attachments.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { messageId: { [Op.in]: ['m-1'] } } }),
      );
      expect(page.items[0]).toMatchObject({
        body: 'Morning yoga flow',
        attachments: [{ card }],
      });
      expect(page.items[1]).toMatchObject({
        body: '[deleted]',
        attachments: [],
      });
    });

    it('shares to several people, one result each, and keeps going past a refusal', async () => {
      share.shareableCard.mockResolvedValue(card);
      const send = jest
        .spyOn(service, 'sendMessage')
        .mockResolvedValueOnce({
          conversation: { id: 'c-1', waiting: null },
        } as never)
        .mockRejectedValueOnce(
          new ForbiddenException(apiError('messaging.connectionsOnly')),
        )
        .mockResolvedValueOnce({
          conversation: { id: 'c-3', waiting: { remaining: 2 } },
        } as never);

      const { results } = await service.shareTo(
        me,
        ['u-1', 'u-2', 'u-2', 'u-3', me],
        sessionRef,
        'Join?',
      );

      expect(send).toHaveBeenCalledTimes(3);
      expect(results).toEqual([
        {
          recipientId: 'u-1',
          status: 'SENT',
          conversationId: 'c-1',
          reason: null,
        },
        {
          recipientId: 'u-2',
          status: 'REFUSED',
          conversationId: null,
          reason: 'messaging.connectionsOnly',
        },
        {
          recipientId: 'u-3',
          status: 'WAITING',
          conversationId: 'c-3',
          reason: null,
        },
      ]);
    });
  });
});
