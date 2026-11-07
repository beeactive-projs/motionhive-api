import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { NotificationService, NotificationType } from './notification.service';
import {
  Notification,
  NotificationAudienceType,
  NotificationSeverity,
} from './entities/notification.entity';
import { NotificationReceipt } from './entities/notification-receipt.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { User } from '../user/entities/user.entity';
import { EmailService } from '../../common/services/email.service';
import { JobsService } from '../jobs/jobs.service';
import {
  fakeTx,
  makeModelMock,
  makeSequelizeMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../test/helpers/sequelize-mocks';

type ReceiptStub = {
  id: string;
  notificationId: string;
  userId: string;
  deliveredAt: Date | null;
  deliveredChannels: Record<string, string>;
  save: jest.Mock;
};

type NotificationStub = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: {
    screen: string;
    entityId?: string;
    queryParams?: Record<string, string>;
  } | null;
  severity: NotificationSeverity;
  audienceType: NotificationAudienceType;
  audienceId: string | null;
  fingerprint: string | null;
};

function makeNotificationRow(
  overrides: Partial<NotificationStub> = {},
): NotificationStub {
  return {
    id: 'notif-1',
    type: NotificationType.INVOICE_PAID,
    title: 'Invoice paid',
    body: 'Your invoice was paid',
    data: { screen: 'invoice', entityId: 'inv-9' },
    severity: NotificationSeverity.INFO,
    audienceType: NotificationAudienceType.USER,
    audienceId: 'user-1',
    fingerprint: null,
    ...overrides,
  };
}

function makeReceiptRow(overrides: Partial<ReceiptStub> = {}): ReceiptStub {
  return {
    id: 'receipt-1',
    notificationId: 'notif-1',
    userId: 'user-1',
    deliveredAt: new Date(),
    deliveredChannels: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('NotificationService', () => {
  let service: NotificationService;
  let notificationModel: ModelMock;
  let receiptModel: ModelMock & { findOrCreate: jest.Mock };
  let preferenceModel: ModelMock;
  let userModel: ModelMock;
  let emailService: { sendNotificationEmail: jest.Mock };
  let configMock: { get: jest.Mock };
  // Default: enqueue returns a fake Job ref → tests assert email is
  // queued, NOT sent synchronously. The "Redis missing" fallback
  // path is covered by a dedicated test that overrides this.
  let jobsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    notificationModel = makeModelMock();
    receiptModel = Object.assign(makeModelMock(), {
      findOrCreate: jest.fn(),
    });
    preferenceModel = makeModelMock();
    userModel = makeModelMock();
    emailService = {
      sendNotificationEmail: jest.fn().mockResolvedValue({ ok: true }),
    };
    configMock = {
      get: jest.fn((key: string) =>
        key === 'FRONTEND_URL' ? 'http://app.test' : undefined,
      ),
    };
    jobsService = {
      enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getModelToken(Notification), useValue: notificationModel },
        { provide: getModelToken(NotificationReceipt), useValue: receiptModel },
        {
          provide: getModelToken(NotificationPreference),
          useValue: preferenceModel,
        },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: makeSequelizeMock() },
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: configMock },
        { provide: JobsService, useValue: jobsService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(NotificationService);
  });

  describe('notify (single user)', () => {
    it('creates a notification + receipt and delivers in-app + email', async () => {
      const notif = makeNotificationRow();
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(notif);
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io', firstName: 'Una' },
      ]);
      const receipt = makeReceiptRow();
      receiptModel.findOrCreate.mockResolvedValue([receipt, true]);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.INVOICE_PAID,
        title: 'Invoice paid',
        body: 'Your invoice was paid',
        data: { screen: 'invoice', entityId: 'inv-9' },
      });

      expect(notificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.INVOICE_PAID,
          audienceType: NotificationAudienceType.USER,
          audienceId: 'user-1',
        }),
        { transaction: fakeTx },
      );
      expect(receiptModel.findOrCreate).toHaveBeenCalled();
      // Phase 6+: the email goes onto the BullMQ queue; the producer
      // never calls EmailService directly.
      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        'notifications.email_send',
        expect.objectContaining({
          to: 'u1@test.io',
          title: 'Invoice paid',
          ctaUrl: 'http://app.test/invoice/inv-9',
        }),
        expect.objectContaining({
          jobId: expect.stringContaining('email_send.') as string,
        }),
      );
      expect(result.delivered.in_app).toBe('sent');
      expect(result.delivered.email).toBe('queued');
      expect(result.delivered.push).toBe('skipped:preference_off');
      expect(result.delivered.sms).toBe('skipped:preference_off');
      expect(result.deduped).toBe(false);
    });

    it('queues a push carrying the deep link the app routes on', async () => {
      // SESSION_REMINDER_1H defaults to in-app + push and no email, so
      // this exercises the push branch on its own.
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(
        makeNotificationRow({
          type: NotificationType.SESSION_REMINDER_1H,
          title: 'Session in 1 hour',
          body: 'Today at 18:00',
          data: {
            screen: 'sessions',
            entityId: 'sess-1',
            queryParams: { tab: 'cancelled' },
          },
        }),
      );
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io', firstName: 'U' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.SESSION_REMINDER_1H,
        title: 'Session in 1 hour',
        body: 'Today at 18:00',
      });

      expect(jobsService.enqueue).toHaveBeenCalledWith(
        'notifications.push_send',
        expect.objectContaining({
          userId: 'user-1',
          title: 'Session in 1 hour',
          body: 'Today at 18:00',
          // Both vendors only carry strings, so the nested queryParams
          // object is flattened. The mobile deep-link resolver reads
          // exactly these keys.
          data: {
            screen: 'sessions',
            entityId: 'sess-1',
            qp_tab: 'cancelled',
          },
        }),
        expect.objectContaining({
          jobId: expect.stringContaining('push_send.') as string,
        }),
      );
      expect(result.delivered.push).toBe('queued');
    });

    it('collapses pushes on the caller key, falling back to the fingerprint', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(
        makeNotificationRow({
          type: NotificationType.SESSION_REMINDER_1H,
          fingerprint: 'fp-1',
        }),
      );
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io', firstName: 'U' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);

      await service.notify({
        userId: 'user-1',
        type: NotificationType.SESSION_REMINDER_1H,
        title: 't',
        body: 'b',
        collapseKey: 'conversation.c-1',
      });
      await service.notify({
        userId: 'user-1',
        type: NotificationType.SESSION_REMINDER_1H,
        title: 't',
        body: 'b',
      });

      const pushes = (
        jobsService.enqueue.mock.calls as [string, { collapseKey?: string }][]
      ).filter(([name]) => name === 'notifications.push_send');
      expect(pushes.map(([, payload]) => payload.collapseKey)).toEqual([
        'conversation.c-1',
        'fp-1',
      ]);
    });

    it('reports push as unqueued rather than sent when there is no Redis', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(
        makeNotificationRow({ type: NotificationType.SESSION_REMINDER_1H }),
      );
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io', firstName: 'U' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);
      // What JobsService returns when REDIS_HOST is unset.
      jobsService.enqueue.mockResolvedValue(null);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.SESSION_REMINDER_1H,
        title: 't',
        body: 'b',
      });

      // Deliberately not a synchronous fallback like email has: a push
      // needs credentials a dev machine will not have, and claiming it
      // was sent would hide that.
      expect(result.delivered.push).toBe('skipped:no_queue');
    });

    it('skips email when the user has no email on file', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(makeNotificationRow());
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: null, firstName: null },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.INVOICE_PAID,
        title: 't',
        body: 'b',
      });

      expect(jobsService.enqueue).not.toHaveBeenCalled();
      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
      expect(result.delivered.email).toBe('skipped:no_email');
    });

    it('respects user preference override (email off)', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(makeNotificationRow());
      preferenceModel.findAll.mockResolvedValue([
        {
          userId: 'user-1',
          type: NotificationType.INVOICE_PAID,
          channels: { email: false },
        },
      ]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io', firstName: 'Una' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.INVOICE_PAID,
        title: 't',
        body: 'b',
      });

      expect(jobsService.enqueue).not.toHaveBeenCalled();
      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
      expect(result.delivered.email).toBe('skipped:preference_off');
      // in_app default is still on for INVOICE_PAID
      expect(result.delivered.in_app).toBe('sent');
    });

    it('falls back to synchronous email when Redis is unavailable', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(makeNotificationRow());
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);
      // JobsService returns null when REDIS_HOST isn't set —
      // simulate that here.
      jobsService.enqueue.mockResolvedValue(null);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.INVOICE_PAID,
        title: 't',
        body: 'b',
      });

      expect(jobsService.enqueue).toHaveBeenCalled();
      // Producer notices null → calls EmailService directly so
      // emails still go out in dev mode without Redis.
      expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'u1@test.io' }),
      );
      expect(result.delivered.email).toBe('sent');
    });

    it('dedupes by fingerprint — second call returns existing notification', async () => {
      const existing = makeNotificationRow({
        id: 'notif-existing',
        fingerprint: 'fp-1',
      });
      notificationModel.findOne.mockResolvedValue(existing);
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([
        makeReceiptRow({ notificationId: 'notif-existing' }),
        false,
      ]);

      const result = await service.notify({
        userId: 'user-1',
        type: NotificationType.INVOICE_PAID,
        title: 't',
        body: 'b',
        fingerprint: 'fp-1',
      });

      expect(notificationModel.create).not.toHaveBeenCalled();
      expect(result.deduped).toBe(true);
      expect(result.notificationId).toBe('notif-existing');
    });
  });

  describe('notifyMany', () => {
    it('creates one notification + N receipts (deduplicating user list)', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(makeNotificationRow());
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io' },
        { id: 'user-2', email: 'u2@test.io' },
      ]);
      receiptModel.findOrCreate
        .mockResolvedValueOnce([
          makeReceiptRow({ id: 'r-1', userId: 'user-1' }),
          true,
        ])
        .mockResolvedValueOnce([
          makeReceiptRow({ id: 'r-2', userId: 'user-2' }),
          true,
        ]);

      const result = await service.notifyMany(
        // intentionally pass user-1 twice — must be deduped
        ['user-1', 'user-2', 'user-1'],
        {
          type: NotificationType.SESSION_CANCELLED,
          title: 'Cancelled',
          body: 'Session cancelled',
        },
      );

      expect(notificationModel.create).toHaveBeenCalledTimes(1);
      expect(receiptModel.findOrCreate).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(2);
      // multi-recipient → audienceId is null on the notification
      expect(notificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ audienceId: null }),
        { transaction: fakeTx },
      );
    });

    it('skips a deactivated account entirely: no receipt, no email', async () => {
      // Someone closing their account must not be emailed about everything
      // the closing winds down, and reminders must stop reaching them.
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(makeNotificationRow());
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'u1@test.io', isActive: true },
        { id: 'user-2', email: 'u2@test.io', isActive: false },
      ]);
      receiptModel.findOrCreate.mockResolvedValueOnce([
        makeReceiptRow({ id: 'r-1', userId: 'user-1' }),
        true,
      ]);

      const result = await service.notifyMany(['user-1', 'user-2'], {
        type: NotificationType.SESSION_CANCELLED,
        title: 'Cancelled',
        body: 'Session cancelled',
      });

      expect(receiptModel.findOrCreate).toHaveBeenCalledTimes(1);
      expect(result.results).toHaveLength(1);
    });

    it('renders a catalog message per recipient, in their language', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      // The row comes back as stored: English text + key + raw params.
      notificationModel.create.mockImplementation(
        (row: Record<string, unknown>) =>
          Promise.resolve({ ...makeNotificationRow(), ...row }),
      );
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-en', email: 'en@test.io', language: 'en' },
        { id: 'user-ro', email: 'ro@test.io', language: 'ro' },
      ]);
      receiptModel.findOrCreate
        .mockResolvedValueOnce([makeReceiptRow({ id: 'r-en' }), true])
        .mockResolvedValueOnce([makeReceiptRow({ id: 'r-ro' }), true]);

      await service.notifyMany(['user-en', 'user-ro'], {
        type: NotificationType.CLIENT_REQUEST_RECEIVED,
        message: { key: 'client.requestReceived', params: { name: 'Ana' } },
        data: { screen: 'coaching/pending-requests' },
        channelOverride: { email: true },
      });

      expect(notificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New coaching request',
          body: 'Ana would like to work with you.',
          messageKey: 'client.requestReceived',
          messageParams: { name: 'Ana' },
        }),
        { transaction: fakeTx },
      );
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        'notifications.email_send',
        expect.objectContaining({
          to: 'en@test.io',
          title: 'New coaching request',
          body: 'Ana would like to work with you.',
          locale: 'en',
          ctaLabel: 'Open MotionHive',
        }),
        expect.anything(),
      );
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        'notifications.email_send',
        expect.objectContaining({
          to: 'ro@test.io',
          title: 'Cerere nouă',
          body: 'Ana vrea să se antreneze sub îndrumarea ta.',
          locale: 'ro',
          ctaLabel: 'Deschide MotionHive',
        }),
        expect.anything(),
      );
    });

    it('keeps an uncatalogued notification English end to end', async () => {
      notificationModel.findOne.mockResolvedValue(null);
      notificationModel.create.mockResolvedValue(makeNotificationRow());
      preferenceModel.findAll.mockResolvedValue([]);
      userModel.findAll.mockResolvedValue([
        { id: 'user-1', email: 'ro@test.io', language: 'ro' },
      ]);
      receiptModel.findOrCreate.mockResolvedValue([makeReceiptRow(), true]);

      await service.notify({
        userId: 'user-1',
        type: NotificationType.INVOICE_PAID,
        title: 'Invoice paid',
        body: 'Your invoice was paid',
        data: { screen: 'invoice', entityId: 'inv-9' },
      });

      // English text in an English layout, not English wrapped in Romanian.
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        'notifications.email_send',
        expect.objectContaining({
          title: 'Invoice paid',
          locale: 'en',
          ctaLabel: 'Open MotionHive',
        }),
        expect.anything(),
      );
    });

    it('throws when called with an empty user list', async () => {
      await expect(
        service.notifyMany([], {
          type: NotificationType.SESSION_CANCELLED,
          title: 't',
          body: 'b',
        }),
      ).rejects.toThrow(/empty userIds/);
    });
  });
});
