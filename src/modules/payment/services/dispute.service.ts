import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction } from 'sequelize';
import type { Stripe } from 'stripe-types';
import { Dispute } from '../entities/dispute.entity';
import { Payment } from '../entities/payment.entity';
import { NotificationOutbox } from '../../notification/notification-outbox';
import { OrphanedWebhookError } from './webhook-errors';
import { disputeOpenedForInstructor } from '../notifications';

/**
 * Local mirror of Stripe disputes (chargebacks). `charge.dispute.created`
 * (and future dispute.* events) call `syncFromWebhook` inside the webhook
 * handler's transaction. Persisting the dispute lets us:
 *   - notify the instructor immediately on open (via the outbox), and
 *   - drive the `payments.dispute_deadline` cron (T-3 / T-1 reminders).
 */
@Injectable()
export class DisputeService {
  constructor(
    @InjectModel(Dispute)
    private readonly disputeModel: typeof Dispute,
    @InjectModel(Payment)
    private readonly paymentModel: typeof Payment,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async syncFromWebhook(
    dispute: Stripe.Dispute,
    tx: Transaction,
    outbox?: NotificationOutbox,
    /**
     * For `charge.dispute.updated` / `.closed`: refresh a dispute we already
     * track, never create one. A first sighting on a later event must not
     * announce "dispute opened" for something that may be long settled.
     */
    opts: { onlyExisting?: boolean } = {},
  ): Promise<void> {
    const existing = await this.disputeModel.findOne({
      where: { stripeDisputeId: dispute.id },
      transaction: tx,
    });
    if (!existing && opts.onlyExisting) return;

    const dueBy = dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000)
      : null;

    if (existing) {
      // Status / deadline can change across dispute.updated events.
      await existing.update(
        {
          status: dispute.status,
          evidenceDueBy: dueBy,
          reason: dispute.reason ?? null,
        },
        { transaction: tx },
      );
      return;
    }

    const chargeId =
      typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
    if (!chargeId) {
      // No charge reference — can't attribute to an instructor; orphan it.
      throw new OrphanedWebhookError('charge', dispute.id);
    }

    const payment = await this.paymentModel.findOne({
      where: { stripeChargeId: chargeId },
      transaction: tx,
    });
    if (!payment) {
      // Race / out-of-band: the originating payment row isn't here yet.
      // Orphan → reconciliation sweep revisits once it appears.
      throw new OrphanedWebhookError('charge', chargeId);
    }

    const created = await this.disputeModel.create(
      {
        stripeDisputeId: dispute.id,
        stripeChargeId: chargeId,
        paymentId: payment.id,
        instructorId: payment.instructorId,
        amountCents: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason ?? null,
        status: dispute.status,
        evidenceDueBy: dueBy,
        openedAt: dispute.created
          ? new Date(dispute.created * 1000)
          : new Date(),
      },
      { transaction: tx },
    );

    // notify-after-commit (outbox flushes once the webhook tx commits).
    outbox?.add(
      disputeOpenedForInstructor(payment.instructorId, {
        id: created.id,
        amountCents: created.amountCents,
        currency: created.currency,
        reason: created.reason,
        evidenceDueBy: created.evidenceDueBy,
      }),
    );

    this.logger.log?.(
      `Dispute opened: ${dispute.id} on charge ${chargeId} (instructor ${payment.instructorId})`,
      'DisputeService',
    );
  }
}
