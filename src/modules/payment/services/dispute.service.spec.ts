import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Dispute } from '../entities/dispute.entity';
import { Payment } from '../entities/payment.entity';
import { DisputeService } from './dispute.service';
import { OrphanedWebhookError } from './webhook-errors';
import { NotificationType } from '../../notification/notification-types';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../../test/helpers/sequelize-mocks';

const stripeDispute = (over = {}) =>
  ({
    id: 'dp_1',
    charge: 'ch_1',
    amount: 5000,
    currency: 'eur',
    reason: 'fraudulent',
    status: 'needs_response',
    created: 1_750_000_000,
    evidence_details: { due_by: 1_751_000_000 },
    ...over,
  }) as never;

describe('DisputeService.syncFromWebhook', () => {
  let service: DisputeService;
  const disputeModel = { findOne: jest.fn(), create: jest.fn() };
  const paymentModel = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        DisputeService,
        { provide: getModelToken(Dispute), useValue: disputeModel },
        { provide: getModelToken(Payment), useValue: paymentModel },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = ref.get(DisputeService);
  });

  it('inserts a new dispute + queues a DISPUTE_OPENED notification', async () => {
    paymentModel.findOne.mockResolvedValue({
      id: 'pay-1',
      instructorId: 'ins-1',
    });
    disputeModel.findOne.mockResolvedValue(null);
    disputeModel.create.mockResolvedValue({
      id: 'd-row-1',
      amountCents: 5000,
      currency: 'eur',
      reason: 'fraudulent',
      evidenceDueBy: new Date(),
    });
    const outbox = { add: jest.fn() };

    await service.syncFromWebhook(
      stripeDispute(),
      fakeTx as never,
      outbox as never,
    );

    expect(disputeModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeDisputeId: 'dp_1',
        stripeChargeId: 'ch_1',
        paymentId: 'pay-1',
        instructorId: 'ins-1',
        amountCents: 5000,
      }),
      expect.objectContaining({ transaction: fakeTx }),
    );
    expect(outbox.add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.DISPUTE_OPENED,
        userId: 'ins-1',
      }),
    );
  });

  it('updates an existing dispute (status/deadline) without re-notifying', async () => {
    paymentModel.findOne.mockResolvedValue({
      id: 'pay-1',
      instructorId: 'ins-1',
    });
    const update = jest.fn().mockResolvedValue(undefined);
    disputeModel.findOne.mockResolvedValue({ id: 'd-row-1', update });
    const outbox = { add: jest.fn() };

    await service.syncFromWebhook(
      stripeDispute({ status: 'under_review' }),
      fakeTx as never,
      outbox as never,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'under_review' }),
      expect.objectContaining({ transaction: fakeTx }),
    );
    expect(disputeModel.create).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });

  it('throws OrphanedWebhookError when the local payment is missing', async () => {
    disputeModel.findOne.mockResolvedValue(null);
    paymentModel.findOne.mockResolvedValue(null);
    await expect(
      service.syncFromWebhook(stripeDispute(), fakeTx as never, undefined),
    ).rejects.toBeInstanceOf(OrphanedWebhookError);
  });

  describe('updated / closed events (onlyExisting)', () => {
    it('refreshes the status of a dispute we track', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      disputeModel.findOne.mockResolvedValue({ id: 'd-row-1', update });

      await service.syncFromWebhook(
        stripeDispute({ status: 'won' }),
        fakeTx as never,
        undefined,
        { onlyExisting: true },
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'won' }),
        { transaction: fakeTx },
      );
    });

    it('never creates one, nor announces it, on a first sighting', async () => {
      disputeModel.findOne.mockResolvedValue(null);
      disputeModel.create.mockClear();
      const outbox = { add: jest.fn() };

      await service.syncFromWebhook(
        stripeDispute(),
        fakeTx as never,
        outbox as never,
        { onlyExisting: true },
      );

      expect(disputeModel.create).not.toHaveBeenCalled();
      expect(outbox.add).not.toHaveBeenCalled();
    });
  });
});
