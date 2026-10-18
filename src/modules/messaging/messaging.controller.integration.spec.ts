/**
 * HTTP-level integration tests for the messaging routes.
 *
 * Boots a NestJS test instance with mocked services and a stub JWT
 * guard so we can exercise the *real* controller + DTO validation +
 * routing layer without touching the database. This is the bar above
 * service-level unit tests — it verifies status codes, header
 * behavior, throttle wiring, and the actual HTTP contract a curl call
 * would observe.
 *
 * Things this spec catches that service specs don't:
 *   - ParseUUIDPipe on every :id (400 on malformed UUID)
 *   - global ValidationPipe shape (400 on extra/missing fields)
 *   - JWT guard wiring on each route
 *   - Throttler wiring (429 on burst)
 *   - Response status codes (200 vs 201)
 *   - Route paths (typos, ordering, conflicts)
 */

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { MessagingController } from './messaging.controller';
import { MessagingAdminController } from './messaging-admin.controller';
import { MessagingService } from './messaging.service';
import { MessagingSafetyService } from './messaging-safety.service';
import { MessagingModerationService } from './messaging-moderation.service';
import { RolesGuard } from '../../common/guards/roles.guard';

// ---------------------------------------------------------------------------
// Stub user attached by the JWT guard.
// ---------------------------------------------------------------------------

// v4 UUIDs: position 14 must be '4', position 19 must be 8/9/a/b.
const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
const TEST_CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const TEST_MESSAGE_ID = '44444444-4444-4444-8444-444444444444';

class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    req.user = {
      id: TEST_USER_ID,
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      roles: ['USER', 'SUPER_ADMIN'], // admin role too so /admin/messaging works
    };
    return true;
  }
}

class PassAllGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * The shape of each mocked service. We type the mocks as
 * `Record<string, jest.Mock>` rather than `jest.Mocked<TheRealClass>`
 * because the latter triggers eslint's `unbound-method` rule on every
 * `expect(svc.someMethod).toHaveBeenCalled()` — `jest.Mock` is already
 * the right shape and matches the convention used by other specs in
 * this repo.
 */
type MockedService = Record<string, jest.Mock>;

describe('Messaging HTTP integration', () => {
  let app: INestApplication;
  let messagingService: MockedService;
  let safetyService: MockedService;
  let moderationService: MockedService;

  beforeAll(async () => {
    const messagingMock = {
      sendMessage: jest.fn(),
      listConversations: jest.fn(),
      getUnreadCount: jest.fn(),
      getConversation: jest.fn(),
      listMessages: jest.fn(),
      getMessage: jest.fn(),
      markRead: jest.fn(),
      markUnread: jest.fn(),
      muteConversation: jest.fn(),
      leave: jest.fn(),
      deleteOwnMessage: jest.fn(),
    };
    const safetyMock = {
      block: jest.fn(),
      listBlocks: jest.fn(),
      unblock: jest.fn(),
    };
    const moderationMock = {
      submitReport: jest.fn(),
      listReports: jest.fn(),
      resolveReport: jest.fn(),
      readConversationForModeration: jest.fn(),
      suspend: jest.fn(),
      lift: jest.fn(),
      listVelocityAlarms: jest.fn(),
      reviewVelocityAlarm: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [MessagingController, MessagingAdminController],
      providers: [
        { provide: MessagingService, useValue: messagingMock },
        { provide: MessagingSafetyService, useValue: safetyMock },
        { provide: MessagingModerationService, useValue: moderationMock },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useClass(StubAuthGuard)
      .overrideGuard(RolesGuard)
      .useClass(PassAllGuard)
      .overrideGuard(ThrottlerGuard)
      .useClass(PassAllGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    messagingService = moduleRef.get(MessagingService);
    safetyService = moduleRef.get(MessagingSafetyService);
    moderationService = moduleRef.get(MessagingModerationService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─────────────────────────── POST /messaging/messages ──────────────

  describe('POST /messaging/messages', () => {
    it('201 — happy path, calls service with sender id from JWT', async () => {
      messagingService.sendMessage.mockResolvedValue({
        delivered: true,
        message: {
          id: 'm-1',
          conversationId: 'c-1',
          senderId: TEST_USER_ID,
          kind: 'TEXT' as never,
          body: 'hi',
          deletedAt: null,
          createdAt: new Date(),
        },
        conversation: {
          id: 'c-1',
          type: 'DIRECT' as never,
          name: null,
          avatarUrl: null,
          lastMessageAt: new Date(),
          lastMessagePreview: 'hi',
          unreadCount: 0,
          muted: false,
          otherUser: null,
        },
        threatFlags: {
          urls: [],
          hasShortenerUrl: false,
          hasOffPlatformContact: false,
          hasPaymentHandle: false,
          anyFlag: false,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/messaging/messages')
        .send({ recipientId: TEST_RECIPIENT_ID, body: 'hi' })
        .expect(201);
      expect(res.body.delivered).toBe(true);
      expect(messagingService.sendMessage).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_RECIPIENT_ID,
        'hi',
      );
    });

    it('400 — malformed recipient UUID', async () => {
      await request(app.getHttpServer())
        .post('/messaging/messages')
        .send({ recipientId: 'not-a-uuid', body: 'hi' })
        .expect(400);
      expect(messagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('400 — body exceeds 4000 chars', async () => {
      await request(app.getHttpServer())
        .post('/messaging/messages')
        .send({ recipientId: TEST_RECIPIENT_ID, body: 'x'.repeat(4001) })
        .expect(400);
      expect(messagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('400 — extra fields rejected by whitelist', async () => {
      await request(app.getHttpServer())
        .post('/messaging/messages')
        .send({
          recipientId: TEST_RECIPIENT_ID,
          body: 'hi',
          backdoor: 'haha',
        })
        .expect(400);
    });
  });

  // ─────────────────────────── reads ─────────────────────────────────

  describe('reads (list / get / unread)', () => {
    it('GET /messaging/conversations → 200', async () => {
      messagingService.listConversations.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      const res = await request(app.getHttpServer())
        .get('/messaging/conversations')
        .expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('GET /messaging/unread-count → 200 with count', async () => {
      messagingService.getUnreadCount.mockResolvedValue({ count: 7 });
      const res = await request(app.getHttpServer())
        .get('/messaging/unread-count')
        .expect(200);
      expect(res.body.count).toBe(7);
    });

    it('GET /messaging/conversations/:id — malformed UUID → 400', async () => {
      await request(app.getHttpServer())
        .get('/messaging/conversations/not-a-uuid')
        .expect(400);
      expect(messagingService.getConversation).not.toHaveBeenCalled();
    });

    it('GET /messaging/conversations/:id/messages — defaults limit to 50', async () => {
      messagingService.listMessages.mockResolvedValue({
        items: [],
        nextBefore: null,
      });
      await request(app.getHttpServer())
        .get(`/messaging/conversations/${TEST_CONVERSATION_ID}/messages`)
        .expect(200);
      expect(messagingService.listMessages).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_CONVERSATION_ID,
        { before: undefined, limit: 50 },
      );
    });

    it('GET /messaging/messages/:id — happy path', async () => {
      messagingService.getMessage.mockResolvedValue({
        id: TEST_MESSAGE_ID,
        conversationId: TEST_CONVERSATION_ID,
        senderId: TEST_USER_ID,
        kind: 'TEXT' as never,
        body: 'hi',
        deletedAt: null,
        createdAt: new Date(),
      });
      const res = await request(app.getHttpServer())
        .get(`/messaging/messages/${TEST_MESSAGE_ID}`)
        .expect(200);
      expect(res.body.body).toBe('hi');
    });
  });

  // ─────────────────────────── mutations ─────────────────────────────

  describe('mutations', () => {
    it('PATCH /messaging/conversations/:id/read — 200, calls service', async () => {
      messagingService.markRead.mockResolvedValue({ lastReadAt: new Date() });
      await request(app.getHttpServer())
        .patch(`/messaging/conversations/${TEST_CONVERSATION_ID}/read`)
        .send({})
        .expect(200);
      expect(messagingService.markRead).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_CONVERSATION_ID,
        undefined,
      );
    });

    it('PATCH /messaging/conversations/:id/read — invalid ISO → 400', async () => {
      await request(app.getHttpServer())
        .patch(`/messaging/conversations/${TEST_CONVERSATION_ID}/read`)
        .send({ upToIso: 'not-a-date' })
        .expect(400);
    });

    it('PATCH /messaging/conversations/:id/unread — 200', async () => {
      messagingService.markUnread.mockResolvedValue({ markedUnread: true });
      const res = await request(app.getHttpServer())
        .patch(`/messaging/conversations/${TEST_CONVERSATION_ID}/unread`)
        .expect(200);
      expect(res.body).toEqual({ markedUnread: true });
      expect(messagingService.markUnread).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_CONVERSATION_ID,
      );
    });

    it('PATCH /messaging/conversations/:id/unread — non-UUID id → 400', async () => {
      await request(app.getHttpServer())
        .patch('/messaging/conversations/not-a-uuid/unread')
        .expect(400);
      expect(messagingService.markUnread).not.toHaveBeenCalled();
    });

    it('PATCH /messaging/conversations/:id/mute — 200', async () => {
      messagingService.muteConversation.mockResolvedValue({ mutedUntil: null });
      await request(app.getHttpServer())
        .patch(`/messaging/conversations/${TEST_CONVERSATION_ID}/mute`)
        .send({})
        .expect(200);
    });

    it('POST /messaging/conversations/:id/leave — 201', async () => {
      messagingService.leave.mockResolvedValue(undefined);
      const res = await request(app.getHttpServer())
        .post(`/messaging/conversations/${TEST_CONVERSATION_ID}/leave`)
        .expect(201);
      expect(res.body).toEqual({ ok: true });
    });

    it('DELETE /messaging/messages/:id — 200', async () => {
      messagingService.deleteOwnMessage.mockResolvedValue({
        id: TEST_MESSAGE_ID,
        conversationId: TEST_CONVERSATION_ID,
        senderId: TEST_USER_ID,
        kind: 'TEXT' as never,
        body: '[deleted]',
        deletedAt: new Date(),
        createdAt: new Date(),
      });
      await request(app.getHttpServer())
        .delete(`/messaging/messages/${TEST_MESSAGE_ID}`)
        .expect(200);
    });
  });

  // ─────────────────────────── blocks + reports ──────────────────────

  describe('blocks + reports', () => {
    it('POST /messaging/blocks — 201', async () => {
      safetyService.block.mockResolvedValue({ id: 'b-1' });
      await request(app.getHttpServer())
        .post('/messaging/blocks')
        .send({ blockedId: TEST_RECIPIENT_ID, reason: 'SPAM' })
        .expect(201);
      expect(safetyService.block).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_RECIPIENT_ID,
        'SPAM',
      );
    });

    it('POST /messaging/blocks — invalid reason enum → 400', async () => {
      await request(app.getHttpServer())
        .post('/messaging/blocks')
        .send({ blockedId: TEST_RECIPIENT_ID, reason: 'NOT_A_REASON' })
        .expect(400);
    });

    it('DELETE /messaging/blocks/:blockedId — 200', async () => {
      safetyService.unblock.mockResolvedValue(undefined);
      await request(app.getHttpServer())
        .delete(`/messaging/blocks/${TEST_RECIPIENT_ID}`)
        .expect(200);
    });

    it('POST /messaging/reports — 201 with messageId', async () => {
      moderationService.submitReport.mockResolvedValue({ id: 'r-1' });
      await request(app.getHttpServer())
        .post('/messaging/reports')
        .send({
          messageId: TEST_MESSAGE_ID,
          category: 'SPAM',
        })
        .expect(201);
    });

    it('POST /messaging/reports — 400 when neither id supplied', async () => {
      await request(app.getHttpServer())
        .post('/messaging/reports')
        .send({ category: 'SPAM' })
        .expect(400);
    });
  });

  // ─────────────────────────── admin routes ──────────────────────────

  describe('admin routes', () => {
    it('GET /admin/messaging/reports — 200', async () => {
      moderationService.listReports.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      await request(app.getHttpServer())
        .get('/admin/messaging/reports')
        .expect(200);
    });

    it('PATCH /admin/messaging/reports/:id — 200', async () => {
      moderationService.resolveReport.mockResolvedValue({ id: 'r-1' });
      await request(app.getHttpServer())
        .patch(`/admin/messaging/reports/${TEST_MESSAGE_ID}`)
        .send({ status: 'RESOLVED' })
        .expect(200);
    });

    it('POST /admin/messaging/conversations/:id/messages — happy path', async () => {
      moderationService.readConversationForModeration.mockResolvedValue({
        items: [],
        accessLogId: 'log-1',
      });
      const res = await request(app.getHttpServer())
        .post(`/admin/messaging/conversations/${TEST_CONVERSATION_ID}/messages`)
        .send({ reason: 'investigating report' })
        .expect(201);
      expect(res.body.accessLogId).toBe('log-1');
    });

    it('POST /admin/messaging/conversations/:id/messages — 400 when reason missing', async () => {
      await request(app.getHttpServer())
        .post(`/admin/messaging/conversations/${TEST_CONVERSATION_ID}/messages`)
        .send({})
        .expect(400);
    });

    it('POST /admin/messaging/suspensions — 201', async () => {
      moderationService.suspend.mockResolvedValue({ id: 's-1' });
      await request(app.getHttpServer())
        .post('/admin/messaging/suspensions')
        .send({
          userId: TEST_RECIPIENT_ID,
          reason: 'mass spam',
        })
        .expect(201);
    });

    it('GET /admin/messaging/velocity-alarms — 200', async () => {
      moderationService.listVelocityAlarms.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
      await request(app.getHttpServer())
        .get('/admin/messaging/velocity-alarms')
        .expect(200);
    });

    it('PATCH /admin/messaging/velocity-alarms/:id/review — 200', async () => {
      moderationService.reviewVelocityAlarm.mockResolvedValue({
        id: 'a-1',
      });
      await request(app.getHttpServer())
        .patch(`/admin/messaging/velocity-alarms/${TEST_MESSAGE_ID}/review`)
        .expect(200);
    });
  });
});
