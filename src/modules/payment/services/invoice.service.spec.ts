import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { InvoiceService } from './invoice.service';
import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment } from '../entities/payment.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../user/entities/user.entity';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import { EmailService } from '../../../common/services/email.service';
import {
  NotificationService,
  NotificationType,
} from '../../notification/notification.service';
import { NotificationOutbox } from '../../notification/notification-outbox';
import {
  fakeTx,
  makeModelMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../../test/helpers/sequelize-mocks';

/**
 * These specs cover the `updateDraft` flow only. The legacy create/send
 * paths predate this spec file and remain covered by integration use —
 * we add coverage incrementally as we touch new behavior, rather than
 * back-filling all 800 lines at once.
 */
describe('InvoiceService.updateDraft', () => {
  let service: InvoiceService;
  let invoiceModel: ModelMock;
  let stripeAccountModel: ModelMock;
  let stripeMock: {
    stripe: {
      invoices: {
        update: jest.Mock;
        retrieve: jest.Mock;
      };
      invoiceItems: {
        list: jest.Mock;
        del: jest.Mock;
        create: jest.Mock;
      };
    };
    buildIdempotencyKey: jest.Mock;
    buildFeeParams: jest.Mock;
  };

  function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
    const base = {
      id: 'inv-1',
      instructorId: 'user-1',
      clientId: null,
      stripeInvoiceId: 'in_test',
      stripeCustomerId: 'cus_test',
      currency: 'RON',
      amountDueCents: 5000,
      amountRemainingCents: 5000,
      applicationFeeCents: 0,
      dueDate: null,
      description: null,
      status: InvoiceStatus.DRAFT,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: function () {
        // Match the shape of the real Sequelize toJSON output for the
        // `enrich` step. Functions and the toJSON itself are stripped.
        const {
          save: _s,
          toJSON: _t,
          ...rest
        } = this as Record<string, unknown>;
        return rest;
      },
      ...overrides,
    };
    return base as unknown as Invoice;
  }

  // The enrich() helper goes through `this.sequelize.models.User.findAll`.
  // We give it a stub that always resolves empty so guest-only invoices
  // (which is what makeInvoice produces, clientId=null) are returned as-is.
  const userFindAll = jest.fn().mockResolvedValue([]);
  const sequelizeMock = {
    transaction: jest.fn((cb: (tx: { LOCK: { UPDATE: string } }) => unknown) =>
      Promise.resolve(cb({ LOCK: { UPDATE: 'UPDATE' } })),
    ),
    models: { User: { findAll: userFindAll } },
  };

  beforeEach(async () => {
    invoiceModel = makeModelMock();
    stripeAccountModel = makeModelMock();
    // Account row drives fee recalculation.
    stripeAccountModel.findOne.mockResolvedValue({
      userId: 'user-1',
      stripeAccountId: 'acct_test',
      platformFeeBps: 0,
    });

    stripeMock = {
      stripe: {
        invoices: {
          update: jest.fn().mockResolvedValue({}),
          retrieve: jest.fn().mockResolvedValue({
            amount_due: 5000,
            amount_remaining: 5000,
          }),
        },
        invoiceItems: {
          list: jest.fn().mockResolvedValue({ data: [] }),
          del: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({}),
        },
      },
      buildIdempotencyKey: jest.fn(
        (resource, id, op) => `${resource}:${id}:${op}`,
      ),
      buildFeeParams: jest.fn().mockReturnValue({}),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: getModelToken(Invoice), useValue: invoiceModel },
        { provide: getModelToken(Payment), useValue: makeModelMock() },
        { provide: getModelToken(StripeAccount), useValue: stripeAccountModel },
        {
          provide: getModelToken(StripeCustomer),
          useValue: {
            ...makeModelMock(),
            findAll: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: getModelToken(Subscription), useValue: makeModelMock() },
        { provide: getModelToken(User), useValue: makeModelMock() },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: StripeService, useValue: stripeMock },
        { provide: CustomerService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(InvoiceService);
  });

  it('rejects when no fields are supplied', async () => {
    invoiceModel.findByPk.mockResolvedValue(makeInvoice());
    await expect(service.updateDraft('user-1', 'inv-1', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an unknown invoice with 404', async () => {
    invoiceModel.findByPk.mockResolvedValue(null);
    await expect(
      service.updateDraft('user-1', 'inv-x', { description: 'noop' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when caller is not the owner', async () => {
    invoiceModel.findByPk.mockResolvedValue(
      makeInvoice({ instructorId: 'someone-else' }),
    );
    await expect(
      service.updateDraft('user-1', 'inv-1', { description: 'noop' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an OPEN invoice (only DRAFT is editable)', async () => {
    invoiceModel.findByPk.mockResolvedValue(
      makeInvoice({ status: InvoiceStatus.OPEN }),
    );
    await expect(
      service.updateDraft('user-1', 'inv-1', { description: 'noop' }),
    ).rejects.toThrow(/draft/i);
  });

  it('rejects a past due date', async () => {
    invoiceModel.findByPk.mockResolvedValue(makeInvoice());
    await expect(
      service.updateDraft('user-1', 'inv-1', { dueDate: '2000-01-01' }),
    ).rejects.toThrow(/past/i);
  });

  it("accepts today's date regardless of server timezone", async () => {
    // Regression: a previous implementation built `today` via
    // `new Date(); setHours(0,0,0,0)` (LOCAL midnight) and compared to
    // a UTC-parsed due date. On servers west of UTC, a same-day input
    // was rejected as "past". The fix uses UTC midnight on both sides.
    //
    // We pin the system clock to a known UTC moment and pass the same
    // UTC date as input — must NOT throw on past-date validation.
    jest.useFakeTimers().setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
    try {
      invoiceModel.findByPk.mockResolvedValue(makeInvoice());
      await expect(
        service.updateDraft('user-1', 'inv-1', { dueDate: '2026-04-25' }),
      ).resolves.toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('updates description without touching line items', async () => {
    const inv = makeInvoice();
    invoiceModel.findByPk.mockResolvedValue(inv);

    await service.updateDraft('user-1', 'inv-1', { description: 'new memo' });

    expect(stripeMock.stripe.invoiceItems.list).not.toHaveBeenCalled();
    expect(stripeMock.stripe.invoiceItems.del).not.toHaveBeenCalled();
    expect(stripeMock.stripe.invoiceItems.create).not.toHaveBeenCalled();
    expect(stripeMock.stripe.invoices.update).toHaveBeenCalledWith(
      'in_test',
      expect.objectContaining({ description: 'new memo' }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^invoice:inv-1:update_/),
      }),
    );
    expect(inv.description).toBe('new memo');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() reference; we're asserting on the spy, not invoking it.
    expect(inv.save).toHaveBeenCalled();
  });

  it('replaces every existing line item then re-creates from the DTO', async () => {
    invoiceModel.findByPk.mockResolvedValue(makeInvoice());
    stripeMock.stripe.invoiceItems.list.mockResolvedValue({
      data: [{ id: 'ii_old1' }, { id: 'ii_old2' }],
    });
    stripeMock.stripe.invoices.retrieve.mockResolvedValue({
      amount_due: 7500,
      amount_remaining: 7500,
    });

    await service.updateDraft('user-1', 'inv-1', {
      lineItems: [
        { description: 'New session', amountCents: 5000, quantity: 1 },
        { description: 'Add-on', amountCents: 2500 },
      ],
    });

    expect(stripeMock.stripe.invoiceItems.del).toHaveBeenCalledWith(
      'ii_old1',
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^invoice_item:inv-1:edit_.*_del_ii_old1$/,
        ),
      }),
    );
    expect(stripeMock.stripe.invoiceItems.del).toHaveBeenCalledWith(
      'ii_old2',
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^invoice_item:inv-1:edit_.*_del_ii_old2$/,
        ),
      }),
    );
    expect(stripeMock.stripe.invoiceItems.create).toHaveBeenCalledTimes(2);

    const firstCall = stripeMock.stripe.invoiceItems.create.mock.calls[0];
    expect(firstCall[0]).toEqual(
      expect.objectContaining({
        invoice: 'in_test',
        amount: 5000,
        currency: 'ron',
      }),
    );
    // Idempotency key includes a per-edit version so a second edit
    // doesn't collide with the first.
    expect(firstCall[1].idempotencyKey).toMatch(
      /^invoice_item:inv-1:edit_\d+_line_0$/,
    );
  });

  it('refreshes amount totals from the Stripe response after editing', async () => {
    const inv = makeInvoice();
    invoiceModel.findByPk.mockResolvedValue(inv);
    stripeMock.stripe.invoices.retrieve.mockResolvedValue({
      amount_due: 9999,
      amount_remaining: 9999,
    });

    await service.updateDraft('user-1', 'inv-1', {
      lineItems: [{ description: 'Bigger plan', amountCents: 9999 }],
    });

    expect(inv.amountDueCents).toBe(9999);
    expect(inv.amountRemainingCents).toBe(9999);
  });

  it('passes the new ISO due date as a unix timestamp to Stripe', async () => {
    invoiceModel.findByPk.mockResolvedValue(makeInvoice());
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    await service.updateDraft('user-1', 'inv-1', { dueDate: future });

    const update = stripeMock.stripe.invoices.update.mock.calls[0][1];
    expect(typeof update.due_date).toBe('number');
    expect(update.due_date).toBe(Math.floor(new Date(future).getTime() / 1000));
  });

  // The client's own list renders whoever is on the *other* side of the bill.
  // Without this the row named the person reading it, which tells them
  // nothing about which coach to pay.
  it('names both parties, from the one user lookup', async () => {
    invoiceModel.findByPk.mockResolvedValue(
      makeInvoice({ clientId: 'client-1' }),
    );
    userFindAll.mockClear();
    userFindAll.mockResolvedValueOnce([
      {
        id: 'user-1',
        email: 'coach@x.com',
        firstName: 'Alex',
        lastName: 'Rivera',
        avatarUrl: null,
      },
      {
        id: 'client-1',
        email: 'client@x.com',
        firstName: 'Sarah',
        lastName: 'Mitchell',
        avatarUrl: null,
      },
    ]);

    const result = await service.updateDraft('user-1', 'inv-1', {
      description: 'Coaching',
    });

    expect(result.instructor).toMatchObject({
      id: 'user-1',
      firstName: 'Alex',
    });
    expect(result.client).toMatchObject({ id: 'client-1', firstName: 'Sarah' });
    // Both sides come out of a single query, not one per party.
    expect(userFindAll).toHaveBeenCalledTimes(1);
    expect(userFindAll.mock.calls[0][0].where.id[Op.in].sort()).toEqual([
      'client-1',
      'user-1',
    ]);
  });
});

// =====================================================================
// Phase 7 wiring — notification side effects
// =====================================================================
//
// These tests guard the producer wiring added in Phase 7:
//   1. INVOICE_CREATED on sendInvoice() (DRAFT → OPEN transition).
//   2. INVOICE_PAID via outbox in syncFromStripeInvoice() (paid transition only).
//   3. PAYMENT_FAILED via outbox in handlePaymentFailed().
//
// We test the *queue side* (was outbox.add called?) separately from
// the *delivery side* (does outbox.flush actually call notify?), which
// is covered by notification-outbox.spec.ts. Keeping the two layers
// independent makes regressions easier to localize.
describe('InvoiceService — Phase 7 notification wiring', () => {
  let service: InvoiceService;
  let invoiceModel: ModelMock;
  let stripeAccountModel: ModelMock;
  let userModel: ModelMock;
  let stripeCustomerModel: ModelMock;
  let stripeMock: {
    stripe: {
      invoices: {
        finalizeInvoice: jest.Mock;
        sendInvoice: jest.Mock;
        retrieve: jest.Mock;
      };
    };
    buildIdempotencyKey: jest.Mock;
    buildFeeParams: jest.Mock;
  };
  let notificationMock: { notify: jest.Mock };
  let outbox: NotificationOutbox;

  function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
    const base = {
      id: 'inv-1',
      instructorId: 'user-1',
      clientId: 'client-1',
      stripeInvoiceId: 'in_test',
      stripeCustomerId: 'cus_test',
      currency: 'EUR',
      amountDueCents: 1000,
      amountPaidCents: 0,
      amountRemainingCents: 1000,
      applicationFeeCents: 0,
      dueDate: null,
      description: null,
      number: null,
      hostedInvoiceUrl: null,
      invoicePdf: null,
      status: InvoiceStatus.DRAFT,
      finalizedAt: null,
      paidAt: null,
      voidedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
      toJSON: function () {
        const {
          save: _s,
          toJSON: _t,
          ...rest
        } = this as Record<string, unknown>;
        return rest;
      },
      ...overrides,
    };
    return base as unknown as Invoice;
  }

  beforeEach(async () => {
    invoiceModel = makeModelMock();
    stripeAccountModel = makeModelMock();
    userModel = makeModelMock();
    stripeCustomerModel = makeModelMock();
    stripeCustomerModel.findAll = jest.fn().mockResolvedValue([]);
    stripeAccountModel.findOne.mockResolvedValue({
      userId: 'user-1',
      stripeAccountId: 'acct_test',
      platformFeeBps: 0,
    });
    stripeCustomerModel.findOne.mockResolvedValue({ email: 'client@x.com' });
    userModel.findByPk.mockResolvedValue({
      id: 'client-1',
      email: 'client@x.com',
      firstName: 'Casey',
      lastName: 'Client',
    });

    stripeMock = {
      stripe: {
        invoices: {
          finalizeInvoice: jest.fn().mockResolvedValue({
            hosted_invoice_url: 'https://invoice.stripe.com/test',
            invoice_pdf: 'https://invoice.stripe.com/test.pdf',
            number: 'INV-001',
          }),
          sendInvoice: jest.fn().mockResolvedValue({}),
          retrieve: jest
            .fn()
            .mockResolvedValue({ amount_due: 1000, amount_remaining: 1000 }),
        },
      },
      buildIdempotencyKey: jest.fn(
        (resource, id, op) => `${resource}:${id}:${op}`,
      ),
      buildFeeParams: jest.fn().mockReturnValue({}),
    };

    notificationMock = { notify: jest.fn().mockResolvedValue(undefined) };
    outbox = new NotificationOutbox(
      notificationMock as unknown as NotificationService,
    );

    const sequelizeMock = {
      transaction: jest.fn(
        (cb: (tx: { LOCK: { UPDATE: string } }) => unknown) =>
          Promise.resolve(cb({ LOCK: { UPDATE: 'UPDATE' } })),
      ),
      models: {
        User: {
          findAll: jest.fn().mockResolvedValue([]),
          findByPk: userModel.findByPk,
        },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: getModelToken(Invoice), useValue: invoiceModel },
        { provide: getModelToken(Payment), useValue: makeModelMock() },
        { provide: getModelToken(StripeAccount), useValue: stripeAccountModel },
        {
          provide: getModelToken(StripeCustomer),
          useValue: stripeCustomerModel,
        },
        { provide: getModelToken(Subscription), useValue: makeModelMock() },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: StripeService, useValue: stripeMock },
        { provide: CustomerService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: NotificationService, useValue: notificationMock },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(InvoiceService);
  });

  describe('sendInvoice — INVOICE_CREATED notification', () => {
    it('fires INVOICE_CREATED to client on DRAFT → OPEN transition', async () => {
      invoiceModel.findByPk.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.DRAFT }),
      );

      await service.sendInvoice('user-1', 'inv-1');

      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'client-1',
          type: NotificationType.INVOICE_CREATED,
          title: 'New invoice',
          data: expect.objectContaining({
            screen: 'profile/invoices',
            entityId: 'inv-1',
          }),
        }),
      );
    });

    it('formats body with due date when present', async () => {
      const dueDate = new Date('2026-12-31T00:00:00.000Z');
      invoiceModel.findByPk.mockResolvedValue(
        makeInvoice({
          status: InvoiceStatus.DRAFT,
          dueDate,
          amountDueCents: 5000,
          currency: 'EUR',
        }),
      );

      await service.sendInvoice('user-1', 'inv-1');

      const call = notificationMock.notify.mock.calls[0][0] as {
        body: string;
      };
      // Amount is rendered with locale formatting. Just check structure.
      expect(call.body).toMatch(/due/i);
      expect(call.body).toMatch(/2026/);
    });

    it('formats body without due date when missing', async () => {
      invoiceModel.findByPk.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.DRAFT, dueDate: null }),
      );

      await service.sendInvoice('user-1', 'inv-1');

      const call = notificationMock.notify.mock.calls[0][0] as {
        body: string;
      };
      expect(call.body).toMatch(/open to view details/i);
      expect(call.body).not.toMatch(/due/i);
    });

    it('does NOT fire INVOICE_CREATED for guest invoice (clientId=null)', async () => {
      invoiceModel.findByPk.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.DRAFT, clientId: null }),
      );
      // Guest path: no User.findByPk, just stripe customer email.
      userModel.findByPk.mockResolvedValue(null);

      await service.sendInvoice('user-1', 'inv-1');

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('still fires INVOICE_CREATED when re-sending an already OPEN invoice', async () => {
      // Re-sending an already-finalized invoice doesn't transition status,
      // but the spec says "fires when invoice is finalized + sent". An OPEN
      // invoice has been sent before, so re-sending is also a "sent" event.
      // (We deliberately do NOT dedup here — it's the FE's job to disable
      // the button after first send if that's the desired UX.)
      invoiceModel.findByPk.mockResolvedValue(
        makeInvoice({
          status: InvoiceStatus.OPEN,
          hostedInvoiceUrl: 'https://x',
        }),
      );

      await service.sendInvoice('user-1', 'inv-1');

      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.INVOICE_CREATED }),
      );
    });
  });

  describe('syncFromStripeInvoice — INVOICE_PAID via outbox', () => {
    it('queues INVOICE_PAID for instructor on transition into paid', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN }),
      );

      await service.syncFromStripeInvoice(
        {
          id: 'in_test',
          status: 'paid',
          amount_due: 1000,
          amount_paid: 1000,
          amount_remaining: 0,
          number: 'INV-001',
        } as never,
        fakeTx as never,
        outbox,
      );

      // Pre-flush — notify must NOT have been called yet.
      expect(notificationMock.notify).not.toHaveBeenCalled();
      expect(outbox.size()).toBeGreaterThan(0);

      await outbox.flush();

      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: NotificationType.INVOICE_PAID,
          title: 'Invoice paid',
        }),
      );
    });

    it('queues a SECOND INVOICE_PAID for the client when present', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN, clientId: 'client-1' }),
      );

      await service.syncFromStripeInvoice(
        {
          id: 'in_test',
          status: 'paid',
          amount_due: 1000,
          amount_paid: 1000,
          amount_remaining: 0,
          number: 'INV-001',
        } as never,
        fakeTx as never,
        outbox,
      );
      await outbox.flush();

      const calls = notificationMock.notify.mock.calls.map(
        (c) => c[0] as { userId: string; title: string },
      );
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'user-1',
            title: 'Invoice paid',
          }),
          expect.objectContaining({
            userId: 'client-1',
            title: 'Payment received',
          }),
        ]),
      );
    });

    it('does NOT queue INVOICE_PAID when invoice was already paid (idempotent webhook replay)', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.PAID }),
      );

      await service.syncFromStripeInvoice(
        {
          id: 'in_test',
          status: 'paid',
          amount_due: 1000,
          amount_paid: 1000,
          amount_remaining: 0,
        } as never,
        fakeTx as never,
        outbox,
      );
      await outbox.flush();

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('does NOT queue INVOICE_PAID when invoice is still open after sync', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN }),
      );

      await service.syncFromStripeInvoice(
        {
          id: 'in_test',
          status: 'open',
          amount_due: 1000,
          amount_paid: 0,
          amount_remaining: 1000,
        } as never,
        fakeTx as never,
        outbox,
      );
      await outbox.flush();

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('outbox.discard() before flush prevents the email entirely (rollback semantics)', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN }),
      );

      await service.syncFromStripeInvoice(
        {
          id: 'in_test',
          status: 'paid',
          amount_due: 1000,
          amount_paid: 1000,
          amount_remaining: 0,
        } as never,
        fakeTx as never,
        outbox,
      );

      // Tx rolled back.
      outbox.discard();
      await outbox.flush();

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('works when outbox is undefined (legacy / non-webhook callers do not break)', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN }),
      );

      await expect(
        service.syncFromStripeInvoice(
          {
            id: 'in_test',
            status: 'paid',
            amount_due: 1000,
            amount_paid: 1000,
            amount_remaining: 0,
          } as never,
          fakeTx as never,
        ),
      ).resolves.toBeDefined();

      // No outbox → no notify call (acceptable; webhook flow always
      // passes one). This guards against null-pointer crashes.
      expect(notificationMock.notify).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentFailed — PAYMENT_FAILED via outbox', () => {
    it('queues PAYMENT_FAILED to client', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN, clientId: 'client-1' }),
      );

      await service.handlePaymentFailed(
        {
          id: 'in_test',
          status: 'open',
          amount_due: 1000,
          amount_paid: 0,
          amount_remaining: 1000,
        } as never,
        fakeTx as never,
        outbox,
      );
      await outbox.flush();

      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'client-1',
          type: NotificationType.PAYMENT_FAILED,
          title: 'Payment failed',
          data: expect.objectContaining({
            screen: 'profile/invoices',
            entityId: 'inv-1',
          }),
        }),
      );
    });

    it('skips notification for guest invoice (no clientId)', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN, clientId: null }),
      );

      await service.handlePaymentFailed(
        {
          id: 'in_test',
          status: 'open',
          amount_due: 1000,
          amount_paid: 0,
          amount_remaining: 1000,
        } as never,
        fakeTx as never,
        outbox,
      );
      await outbox.flush();

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('returns early without queuing when local invoice is missing', async () => {
      invoiceModel.findOne.mockResolvedValue(null);

      await service.handlePaymentFailed(
        { id: 'in_unknown', status: 'open' } as never,
        fakeTx as never,
        outbox,
      );

      expect(outbox.size()).toBe(0);
      await outbox.flush();
      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('outbox.discard() before flush prevents the failure email (rollback semantics)', async () => {
      invoiceModel.findOne.mockResolvedValue(
        makeInvoice({ status: InvoiceStatus.OPEN, clientId: 'client-1' }),
      );

      await service.handlePaymentFailed(
        {
          id: 'in_test',
          status: 'open',
          amount_due: 1000,
          amount_paid: 0,
          amount_remaining: 1000,
        } as never,
        fakeTx as never,
        outbox,
      );

      outbox.discard();
      await outbox.flush();

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });
  });
});
