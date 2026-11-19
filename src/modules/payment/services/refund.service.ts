import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction } from 'sequelize';
import type { Stripe } from 'stripe-types';

import { Payment, PaymentStatus } from '../entities/payment.entity';
import { StripeService } from './stripe.service';
import { OrphanedWebhookError } from './webhook-errors';
import { NotificationService } from '../../notification/notification.service';
import { NotificationOutbox } from '../../notification/notification-outbox';
import { refundIssuedForClient } from '../notifications';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { apiError } from '../../../common/i18n';

export const MAX_REFUND_WINDOW_DAYS = 14;

/** Stripe's answer when an account's balance can't cover a transfer or reversal. */
function isInsufficientBalance(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  return (err as { code?: unknown }).code === 'balance_insufficient';
}

@Injectable()
export class RefundService {
  constructor(
    @InjectModel(Payment)
    private readonly paymentModel: typeof Payment,
    private readonly stripeService: StripeService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async createRefund(
    instructorId: string,
    dto: CreateRefundDto,
  ): Promise<Payment> {
    const payment = await this.paymentModel.findByPk(dto.paymentId);
    if (!payment) {
      throw new NotFoundException(apiError('payment.paymentNotFound'));
    }
    if (payment.instructorId !== instructorId) {
      throw new ForbiddenException(apiError('payment.paymentNotYours'));
    }
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException(
        apiError('payment.refundNotAllowed', { status: payment.status }),
      );
    }

    // Enforce 14-day refund window.
    if (payment.paidAt) {
      const windowMs = MAX_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (Date.now() - payment.paidAt.getTime() > windowMs) {
        throw new ForbiddenException(
          apiError('payment.refundWindowExpired', {
            days: MAX_REFUND_WINDOW_DAYS,
          }),
        );
      }
    }

    const refundAmount = dto.amountCents ?? payment.amountCents;
    const alreadyRefunded = payment.amountRefundedCents ?? 0;
    if (refundAmount + alreadyRefunded > payment.amountCents) {
      throw new BadRequestException(apiError('payment.refundTooLarge'));
    }

    if (!payment.stripeChargeId && !payment.stripePaymentIntentId) {
      throw new BadRequestException(apiError('payment.notRefundableHere'));
    }

    // Every charge here is a destination charge (`transfer_data.destination`
    // on invoices and subscriptions), so the money sits with the coach.
    // `reverse_transfer` takes the refund back from them; without it the
    // platform's balance paid every refund and the coach kept the money.
    // `refund_application_fee` returns the platform's cut in proportion,
    // so the coach is not charged a fee on money they gave back.
    const refundParams: Record<string, unknown> = {
      amount: refundAmount,
      reverse_transfer: true,
      ...(payment.applicationFeeCents > 0 && { refund_application_fee: true }),
      ...(dto.reason && { reason: 'requested_by_customer' }),
      metadata: {
        beeactive_reason: dto.reason ?? 'instructor_initiated',
        beeactive_payment_id: payment.id,
        ...(dto.notes && { beeactive_notes: dto.notes }),
      },
    };
    if (payment.stripeChargeId) {
      refundParams.charge = payment.stripeChargeId;
    } else {
      refundParams.payment_intent = payment.stripePaymentIntentId;
    }

    try {
      await this.stripeService.stripe.refunds.create(refundParams, {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'refund',
          payment.id,
          `${refundAmount}`,
        ),
      });
    } catch (err: unknown) {
      // With a transfer reversal, Stripe refuses outright (rather than
      // leaving the refund pending) when the coach's balance can't cover
      // it. Said plainly; anything else stays as Stripe answered.
      if (isInsufficientBalance(err)) {
        throw new ConflictException(apiError('payment.refundBalanceTooLow'));
      }
      throw err;
    }

    payment.amountRefundedCents = alreadyRefunded + refundAmount;
    payment.status =
      payment.amountRefundedCents >= payment.amountCents
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    payment.refundedAt = new Date();
    await payment.save();

    if (payment.clientId) {
      await this.notificationService.notify(
        refundIssuedForClient(
          payment.clientId,
          refundAmount,
          payment.currency,
          payment.invoiceId,
        ),
      );
    }

    this.logger.log(
      `Refund of ${refundAmount} cents issued for payment ${payment.id}`,
      'RefundService',
    );
    return payment;
  }

  /**
   * charge.refunded webhook — sync refund state from Stripe to local.
   * Called inside the webhook handler's transaction.
   */
  async syncRefundFromWebhook(
    charge: Stripe.Charge,
    tx: Transaction,
    // Reserved for future post-commit refund notifications (e.g.
    // tell the instructor when a charge is refunded by Stripe Smart
    // Retries failure). Today we only notify on the request-driven
    // refund path in `issueRefund()`.
    _outbox?: NotificationOutbox,
  ): Promise<void> {
    const payment = await this.paymentModel.findOne({
      where: { stripeChargeId: charge.id },
      transaction: tx,
    });
    if (!payment) {
      // Race or out-of-band: no local payment row. Throw orphan; the
      // dispatcher stamps the audit row 'orphaned' and the
      // reconciliation worker (jobs sprint) revisits.
      throw new OrphanedWebhookError('charge', charge.id);
    }
    payment.amountRefundedCents = charge.amount_refunded;
    if (charge.amount_refunded >= charge.amount) {
      payment.status = PaymentStatus.REFUNDED;
    } else if (charge.amount_refunded > 0) {
      payment.status = PaymentStatus.PARTIALLY_REFUNDED;
    }
    payment.refundedAt = new Date();
    await payment.save({ transaction: tx });
  }
}
