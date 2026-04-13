import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { WebhookHandlerService } from './webhook-handler.service';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { InvoiceService } from './invoice.service';
import { SubscriptionService } from './subscription.service';
import { RefundService } from './refund.service';
import {
  WebhookEvent,
  WebhookEventStatus,
} from '../entities/webhook-event.entity';
import { makeStripeEvent } from '../../../../test/helpers/stripe-event.factory';
import {
  fakeTx,
  makeModelMock,
  makeSequelizeMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../../test/helpers/sequelize-mocks';

type AuditRowStub = {
  status: WebhookEventStatus;
  processedAt: Date | null;
  error: string | null;
  save: jest.Mock;
};

function makeAuditRow(): AuditRowStub {
  return {
    status: WebhookEventStatus.PROCESSING,
    processedAt: null,
    error: null,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

// Stripe's handledEventTypes set has 18 entries — enumerate them here so
// the parameterized test fails loudly if the set ever shrinks.
const HANDLED_EVENT_TYPES = [
  'account.updated',
  'account.application.deauthorized',
  'capability.updated',
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'payout.paid',
  'payout.failed',
] as const;

describe('WebhookHandlerService', () => {
  let service: WebhookHandlerService;
  let model: ModelMock;
  let sequelizeMock: ReturnType<typeof makeSequelizeMock>;
  let stripeMock: {
    verifyWebhookSignature: jest.Mock;
    stripe: { accounts: { retrieve: jest.Mock } };
  };
  let connectMock: {
    syncAccountFromWebhook: jest.Mock;
    handleDeauthorized: jest.Mock;
  };
  let invoiceMock: {
    syncFromStripeInvoice: jest.Mock;
    handlePaymentFailed: jest.Mock;
    syncPaymentFromIntent: jest.Mock;
  };
  let subscriptionMock: { syncFromWebhook: jest.Mock };
  let refundMock: { syncRefundFromWebhook: jest.Mock };
  let logger: ReturnType<typeof makeSilentLogger>;

  beforeEach(async () => {
    model = makeModelMock();
    sequelizeMock = makeSequelizeMock();
    stripeMock = {
      verifyWebhookSignature: jest.fn(),
      stripe: { accounts: { retrieve: jest.fn() } },
    };
    connectMock = {
      syncAccountFromWebhook: jest.fn().mockResolvedValue(undefined),
      handleDeauthorized: jest.fn().mockResolvedValue(undefined),
    };
    invoiceMock = {
      syncFromStripeInvoice: jest.fn().mockResolvedValue(null),
      handlePaymentFailed: jest.fn().mockResolvedValue(undefined),
      syncPaymentFromIntent: jest.fn().mockResolvedValue(undefined),
    };
    subscriptionMock = {
      syncFromWebhook: jest.fn().mockResolvedValue(undefined),
    };
    refundMock = {
      syncRefundFromWebhook: jest.fn().mockResolvedValue(undefined),
    };
    logger = makeSilentLogger();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookHandlerService,
        { provide: getModelToken(WebhookEvent), useValue: model },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: StripeService, useValue: stripeMock },
        { provide: ConnectService, useValue: connectMock },
        { provide: InvoiceService, useValue: invoiceMock },
        { provide: SubscriptionService, useValue: subscriptionMock },
        { provide: RefundService, useValue: refundMock },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: logger },
      ],
    }).compile();

    service = moduleRef.get(WebhookHandlerService);
  });

  it('happy path — handled event runs dispatcher inside a transaction and returns PROCESSED', async () => {
    const event = makeStripeEvent('account.updated');
    stripeMock.verifyWebhookSignature.mockReturnValue(event);

    const auditRow = makeAuditRow();
    model.create.mockResolvedValue(auditRow);

    const result = await service.handleIncomingEvent(
      Buffer.from('raw'),
      't=1,v1=sig',
    );

    expect(result).toEqual({
      eventId: event.id,
      type: 'account.updated',
      duplicate: false,
      status: WebhookEventStatus.PROCESSED,
    });
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeEventId: event.id,
        type: 'account.updated',
        status: WebhookEventStatus.PROCESSING,
      }),
    );
    expect(sequelizeMock.transaction).toHaveBeenCalledTimes(1);
    expect(auditRow.save).toHaveBeenCalledTimes(1);
    expect(auditRow.save).toHaveBeenCalledWith({ transaction: fakeTx });
    expect(auditRow.status).toBe(WebhookEventStatus.PROCESSED);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('ignored event type is marked IGNORED and does NOT open a transaction', async () => {
    const event = makeStripeEvent('customer.updated' as never);
    stripeMock.verifyWebhookSignature.mockReturnValue(event);

    const auditRow = makeAuditRow();
    model.create.mockResolvedValue(auditRow);

    const result = await service.handleIncomingEvent(
      Buffer.from('raw'),
      't=1,v1=sig',
    );

    expect(result.status).toBe(WebhookEventStatus.IGNORED);
    expect(result.duplicate).toBe(false);
    expect(sequelizeMock.transaction).not.toHaveBeenCalled();
    expect(auditRow.save).toHaveBeenCalledTimes(1);
    expect(auditRow.save).toHaveBeenCalledWith(); // no transaction arg
    expect(auditRow.status).toBe(WebhookEventStatus.IGNORED);
  });

  it('duplicate webhook — UniqueConstraintError surfaces the existing row', async () => {
    const event = makeStripeEvent('account.updated');
    stripeMock.verifyWebhookSignature.mockReturnValue(event);

    const uce = new UniqueConstraintError({ errors: [] });
    model.create.mockRejectedValue(uce);
    model.findOne.mockResolvedValue({
      status: WebhookEventStatus.PROCESSED,
    });

    const result = await service.handleIncomingEvent(
      Buffer.from('raw'),
      't=1,v1=sig',
    );

    expect(result).toEqual({
      eventId: event.id,
      type: 'account.updated',
      duplicate: true,
      status: WebhookEventStatus.PROCESSED,
    });
    expect(model.findOne).toHaveBeenCalledWith({
      where: { stripeEventId: event.id },
    });
    expect(sequelizeMock.transaction).not.toHaveBeenCalled();
  });

  it('UniqueConstraintError with no existing row rethrows (should-never-happen guard)', async () => {
    const event = makeStripeEvent('account.updated');
    stripeMock.verifyWebhookSignature.mockReturnValue(event);

    const uce = new UniqueConstraintError({ errors: [] });
    model.create.mockRejectedValue(uce);
    model.findOne.mockResolvedValue(null);

    await expect(
      service.handleIncomingEvent(Buffer.from('raw'), 't=1,v1=sig'),
    ).rejects.toBe(uce);
  });

  it('handler failure rolls back tx and persists FAILED in a new save', async () => {
    const event = makeStripeEvent('account.updated');
    stripeMock.verifyWebhookSignature.mockReturnValue(event);

    const auditRow = makeAuditRow();
    model.create.mockResolvedValue(auditRow);

    const bang = new Error('handler kaboom');
    // Make the transaction wrapper run the callback then throw.
    sequelizeMock.transaction.mockImplementation(
      async (cb: (tx: typeof fakeTx) => unknown) => {
        await cb(fakeTx);
        throw bang;
      },
    );

    await expect(
      service.handleIncomingEvent(Buffer.from('raw'), 't=1,v1=sig'),
    ).rejects.toBe(bang);

    // Two saves: one inside the (rolled-back) tx, one outside with FAILED.
    expect(auditRow.save).toHaveBeenCalledTimes(2);
    expect(auditRow.save).toHaveBeenNthCalledWith(1, { transaction: fakeTx });
    expect(auditRow.save).toHaveBeenNthCalledWith(2);
    expect(auditRow.status).toBe(WebhookEventStatus.FAILED);
    expect(auditRow.error).toBe('handler kaboom');
    expect(logger.error).toHaveBeenCalled();
  });

  it('signature verification failure bubbles and never touches the DB', async () => {
    const sigErr = new Error('Invalid stripe signature');
    sigErr.name = 'StripeSignatureVerificationError';
    stripeMock.verifyWebhookSignature.mockImplementation(() => {
      throw sigErr;
    });

    await expect(
      service.handleIncomingEvent(Buffer.from('raw'), 'bogus'),
    ).rejects.toBe(sigErr);

    expect(model.create).not.toHaveBeenCalled();
    expect(model.findOne).not.toHaveBeenCalled();
    expect(sequelizeMock.transaction).not.toHaveBeenCalled();
  });

  it('never logs PII fields from event.data.object', async () => {
    const event = makeStripeEvent('account.updated', {
      data: {
        object: {
          id: 'acct_test',
          object: 'account',
          email: 'victim@example.com',
          individual: { last_name: 'SensitiveSurname' },
          external_accounts: { data: [{ last4: '4242' }] },
        },
        previous_attributes: null,
      },
    } as never);
    stripeMock.verifyWebhookSignature.mockReturnValue(event);

    model.create.mockResolvedValue(makeAuditRow());

    await service.handleIncomingEvent(Buffer.from('raw'), 't=1,v1=sig');

    const allCalls: unknown[][] = [
      ...(logger.log.mock.calls as unknown[][]),
      ...(logger.error.mock.calls as unknown[][]),
      ...(logger.warn.mock.calls as unknown[][]),
      ...(logger.debug.mock.calls as unknown[][]),
    ];
    const allLogs = allCalls
      .flat()
      .map((arg) =>
        typeof arg === 'string' ? arg : JSON.stringify(arg ?? ''),
      );

    const joined = allLogs.join('\n');
    expect(joined).not.toContain('victim@example.com');
    expect(joined).not.toContain('SensitiveSurname');
    expect(joined).not.toContain('4242');
  });

  it('logs event.id and event.type on every handled event', async () => {
    const event = makeStripeEvent('account.updated');
    stripeMock.verifyWebhookSignature.mockReturnValue(event);
    model.create.mockResolvedValue(makeAuditRow());

    await service.handleIncomingEvent(Buffer.from('raw'), 't=1,v1=sig');

    const joined = logger.log.mock.calls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg ?? '')))
      .join('\n');

    expect(joined).toContain(event.id);
    expect(joined).toContain('account.updated');
  });

  describe.each(HANDLED_EVENT_TYPES)('handled event type %s', (type) => {
    it('routes through dispatcher and returns PROCESSED', async () => {
      const event = makeStripeEvent(type as never);
      stripeMock.verifyWebhookSignature.mockReturnValue(event);
      model.create.mockResolvedValue(makeAuditRow());

      const result = await service.handleIncomingEvent(
        Buffer.from('raw'),
        't=1,v1=sig',
      );

      expect(result.status).toBe(WebhookEventStatus.PROCESSED);
      expect(result.status).not.toBe(WebhookEventStatus.IGNORED);
      expect(sequelizeMock.transaction).toHaveBeenCalled();
    });
  });
});
