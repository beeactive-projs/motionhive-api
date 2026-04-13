import {
  BadRequestException,
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
import {
  NotificationService,
  NotificationType,
} from '../../notification/notification.service';
import { CreateRefundDto } from '../dto/create-refund.dto';

const MAX_REFUND_WINDOW_DAYS = 14;

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
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this payment.');
    }
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new BadRequestException(
        `Cannot refund a payment in status ${payment.status}.`,
      );
    }

    // Enforce 14-day refund window.
    if (payment.paidAt) {
      const windowMs = MAX_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (Date.now() - payment.paidAt.getTime() > windowMs) {
        throw new ForbiddenException(
          `Refund window of ${MAX_REFUND_WINDOW_DAYS} days has expired.`,
        );
      }
    }

    const refundAmount = dto.amountCents ?? payment.amountCents;
    const alreadyRefunded = payment.amountRefundedCents ?? 0;
    if (refundAmount + alreadyRefunded > payment.amountCents) {
      throw new BadRequestException(
        'Refund amount exceeds the original payment.',
      );
    }

    if (!payment.stripeChargeId && !payment.stripePaymentIntentId) {
      throw new BadRequestException('No Stripe charge to refund.');
    }

    const refundParams: Record<string, unknown> = {
      amount: refundAmount,
      ...(dto.reason && { reason: 'requested_by_customer' }),
      metadata: {
        beeactive_reason: dto.reason ?? 'instructor_initiated',
        beeactive_payment_id: payment.id,
      },
    };
    if (payment.stripeChargeId) {
      refundParams.charge = payment.stripeChargeId;
    } else {
      refundParams.payment_intent = payment.stripePaymentIntentId;
    }

    await this.stripeService.stripe.refunds.create(
      refundParams as Stripe.RefundCreateParams,
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'refund',
          payment.id,
          `${refundAmount}`,
        ),
      },
    );

    payment.amountRefundedCents = alreadyRefunded + refundAmount;
    payment.status =
      payment.amountRefundedCents >= payment.amountCents
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    payment.refundedAt = new Date();
    await payment.save();

    if (payment.clientId) {
      await this.notificationService.notify({
        userId: payment.clientId,
        type: NotificationType.REFUND_ISSUED,
        title: 'Refund processed',
        body: `A refund of ${(refundAmount / 100).toFixed(2)} ${payment.currency} has been issued.`,
        data: { screen: 'client-payments', entityId: payment.id },
      });
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
  ): Promise<void> {
    const payment = await this.paymentModel.findOne({
      where: { stripeChargeId: charge.id },
      transaction: tx,
    });
    if (!payment) {
      this.logger.warn(
        `charge.refunded for unknown charge ${charge.id}`,
        'RefundService',
      );
      return;
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
