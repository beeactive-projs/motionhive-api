import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { RefundService } from './refund.service';
import { StripeService } from './stripe.service';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { NotificationService } from '../../notification/notification.service';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

/**
 * Every charge is a destination charge, so a refund must take the money
 * back from the coach: without `reverse_transfer` the platform's balance
 * paid it and the coach kept the transfer.
 */
describe('RefundService.createRefund', () => {
  let service: RefundService;
  let refundsCreate: jest.Mock;
  let paymentModel: { findByPk: jest.Mock };

  function payment(overrides: Partial<Payment> = {}) {
    return {
      id: 'pay-1',
      instructorId: 'coach-1',
      clientId: 'client-1',
      status: PaymentStatus.SUCCEEDED,
      paidAt: new Date(),
      amountCents: 10_000,
      amountRefundedCents: 0,
      applicationFeeCents: 0,
      currency: 'ron',
      stripeChargeId: 'ch_1',
      stripePaymentIntentId: null,
      invoiceId: null,
      save: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as Payment;
  }

  beforeEach(async () => {
    refundsCreate = jest.fn().mockResolvedValue({ id: 're_1' });
    paymentModel = { findByPk: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RefundService,
        { provide: getModelToken(Payment), useValue: paymentModel },
        {
          provide: StripeService,
          useValue: {
            stripe: { refunds: { create: refundsCreate } },
            buildIdempotencyKey: (...parts: string[]) => parts.join(':'),
          },
        },
        {
          provide: NotificationService,
          useValue: { notify: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = moduleRef.get(RefundService);
  });

  it('takes the refund back from the coach, not the platform', async () => {
    paymentModel.findByPk.mockResolvedValue(payment());

    await service.createRefund('coach-1', { paymentId: 'pay-1' });

    const params = refundsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(params).toMatchObject({
      charge: 'ch_1',
      amount: 10_000,
      reverse_transfer: true,
    });
    // No platform fee on this payment: nothing to give back.
    expect(params).not.toHaveProperty('refund_application_fee');
  });

  it("gives back the platform's fee in proportion when there was one", async () => {
    paymentModel.findByPk.mockResolvedValue(
      payment({ applicationFeeCents: 500 }),
    );

    await service.createRefund('coach-1', {
      paymentId: 'pay-1',
      amountCents: 4_000,
    });

    expect(refundsCreate.mock.calls[0][0]).toMatchObject({
      amount: 4_000,
      reverse_transfer: true,
      refund_application_fee: true,
    });
  });

  it("says so when the coach's balance can't cover it, and records nothing", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const row = payment({ save } as Partial<Payment>);
    paymentModel.findByPk.mockResolvedValue(row);
    refundsCreate.mockRejectedValue(
      Object.assign(new Error('Insufficient funds'), {
        code: 'balance_insufficient',
      }),
    );

    await expect(
      service.createRefund('coach-1', { paymentId: 'pay-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });

  it('lets any other Stripe error through unchanged', async () => {
    paymentModel.findByPk.mockResolvedValue(payment());
    const stripeError = Object.assign(new Error('No such charge'), {
      code: 'resource_missing',
    });
    refundsCreate.mockRejectedValue(stripeError);

    await expect(
      service.createRefund('coach-1', { paymentId: 'pay-1' }),
    ).rejects.toBe(stripeError);
  });
});
