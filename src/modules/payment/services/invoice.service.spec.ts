import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
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
import { NotificationService } from '../../notification/notification.service';
import {
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
        idempotencyKey: expect.stringMatching(
          /^invoice:inv-1:update_/,
        ) as unknown as string,
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
        ) as unknown as string,
      }),
    );
    expect(stripeMock.stripe.invoiceItems.del).toHaveBeenCalledWith(
      'ii_old2',
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^invoice_item:inv-1:edit_.*_del_ii_old2$/,
        ) as unknown as string,
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
});
