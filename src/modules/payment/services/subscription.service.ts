import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Stripe } from 'stripe-types';

import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { Product, ProductType } from '../entities/product.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import {
  NotificationService,
  NotificationType,
} from '../../notification/notification.service';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';

// Stripe API versions vary on whether current_period_start/end live
// directly on Subscription or nested. Safe accessor via Record cast.
type SubRaw = Record<string, unknown>;
function subTs(raw: SubRaw, field: string): Date | null {
  const v = raw[field];
  return typeof v === 'number' ? new Date(v * 1000) : null;
}

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(Subscription)
    private readonly subscriptionModel: typeof Subscription,
    @InjectModel(Product)
    private readonly productModel: typeof Product,
    @InjectModel(StripeAccount)
    private readonly stripeAccountModel: typeof StripeAccount,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly customerService: CustomerService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async create(
    instructorId: string,
    dto: CreateSubscriptionDto,
  ): Promise<Subscription> {
    const account = await this.stripeAccountModel.findOne({
      where: { userId: instructorId },
    });
    if (!account?.chargesEnabled) {
      throw new UnprocessableEntityException(
        'Complete Stripe onboarding before creating subscriptions.',
      );
    }

    const product = await this.productModel.findByPk(dto.productId);
    if (!product || product.instructorId !== instructorId) {
      throw new NotFoundException('Product not found.');
    }
    if (product.type !== ProductType.SUBSCRIPTION) {
      throw new BadRequestException('Product must be of type SUBSCRIPTION.');
    }
    if (!product.stripePriceId) {
      throw new BadRequestException('Product has no Stripe Price linked.');
    }

    const tx = await this.sequelize.transaction();
    try {
      const customer = await this.customerService.getOrCreateForUser(
        dto.clientUserId,
        tx,
      );

      const feeBps = account.platformFeeBps ?? 0;

      const subParams: Record<string, unknown> = {
        customer: customer.stripeCustomerId,
        items: [{ price: product.stripePriceId }],
        transfer_data: { destination: account.stripeAccountId },
        proration_behavior: 'none',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
        trial_settings: {
          end_behavior: { missing_payment_method: 'cancel' },
        },
        metadata: {
          beeactive_instructor_id: instructorId,
          beeactive_client_id: dto.clientUserId,
          beeactive_product_id: dto.productId,
        },
      };

      if (dto.trialDays && dto.trialDays > 0) {
        subParams.trial_period_days = dto.trialDays;
      }

      if (feeBps > 0) {
        subParams.application_fee_percent = feeBps / 100;
      }

      const stripeSub = await this.stripeService.stripe.subscriptions.create(
        subParams as Stripe.SubscriptionCreateParams,
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'subscription',
            `${instructorId}:${dto.clientUserId}:${dto.productId}`,
            'create',
          ),
        },
      );

      const row = await this.subscriptionModel.create(
        {
          instructorId,
          clientId: dto.clientUserId,
          stripeCustomerId: customer.stripeCustomerId,
          productId: dto.productId,
          stripeSubscriptionId: stripeSub.id,
          stripePriceId: product.stripePriceId,
          status: stripeSub.status as SubscriptionStatus,
          currentPeriodStart: subTs(
            stripeSub as unknown as SubRaw,
            'current_period_start',
          ),
          currentPeriodEnd: subTs(
            stripeSub as unknown as SubRaw,
            'current_period_end',
          ),
          cancelAt: null,
          canceledAt: null,
          cancelAtPeriodEnd: false,
          trialStart: subTs(stripeSub as unknown as SubRaw, 'trial_start'),
          trialEnd: subTs(stripeSub as unknown as SubRaw, 'trial_end'),
          amountCents: product.amountCents,
          currency: product.currency,
        },
        { transaction: tx },
      );

      await tx.commit();

      await this.notificationService.notify({
        userId: dto.clientUserId,
        type: NotificationType.SUBSCRIPTION_CREATED,
        title: 'New subscription',
        body: `You have been subscribed to ${product.name}.`,
        data: { screen: 'client-subscriptions', entityId: row.id },
      });

      this.logger.log(
        `Subscription ${row.id} (stripe ${stripeSub.id}) created`,
        'SubscriptionService',
      );
      return row;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async listForInstructor(
    instructorId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Subscription>> {
    const { rows, count } = await this.subscriptionModel.findAndCountAll({
      where: { instructorId },
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async listForClient(
    clientId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Subscription>> {
    const { rows, count } = await this.subscriptionModel.findAndCountAll({
      where: { clientId },
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async cancel(
    instructorId: string,
    subscriptionId: string,
    immediate: boolean,
  ): Promise<Subscription> {
    const sub = await this.subscriptionModel.findByPk(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found.');
    if (sub.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this subscription.');
    }
    if (sub.status === SubscriptionStatus.CANCELED) {
      return sub;
    }

    if (immediate) {
      await this.stripeService.stripe.subscriptions.cancel(
        sub.stripeSubscriptionId,
      );
      sub.status = SubscriptionStatus.CANCELED;
      sub.canceledAt = new Date();
    } else {
      await this.stripeService.stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        { cancel_at_period_end: true },
      );
      sub.cancelAtPeriodEnd = true;
      sub.cancelAt = sub.currentPeriodEnd;
    }
    await sub.save();

    if (sub.clientId) {
      await this.notificationService.notify({
        userId: sub.clientId,
        type: NotificationType.SUBSCRIPTION_CANCELED,
        title: immediate ? 'Subscription canceled' : 'Subscription will cancel',
        body: immediate
          ? 'Your subscription has been canceled.'
          : 'Your subscription will cancel at the end of the current period.',
        data: { screen: 'client-subscriptions', entityId: sub.id },
      });
    }
    return sub;
  }

  // =====================================================================
  // WEBHOOK SYNC
  // =====================================================================

  async syncFromWebhook(
    stripeSub: Stripe.Subscription,
    tx: Transaction,
  ): Promise<void> {
    const local = await this.subscriptionModel.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
      transaction: tx,
    });
    if (!local) {
      this.logger.warn(
        `Subscription webhook for unknown stripe sub ${stripeSub.id}`,
        'SubscriptionService',
      );
      return;
    }

    const raw = stripeSub as unknown as SubRaw;
    local.status = stripeSub.status as SubscriptionStatus;
    local.currentPeriodStart =
      subTs(raw, 'current_period_start') ?? local.currentPeriodStart;
    local.currentPeriodEnd =
      subTs(raw, 'current_period_end') ?? local.currentPeriodEnd;
    local.cancelAtPeriodEnd = stripeSub.cancel_at_period_end ?? false;
    local.cancelAt = stripeSub.cancel_at
      ? new Date(stripeSub.cancel_at * 1000)
      : null;
    local.canceledAt = stripeSub.canceled_at
      ? new Date(stripeSub.canceled_at * 1000)
      : null;
    local.trialStart = subTs(raw, 'trial_start');
    local.trialEnd = subTs(raw, 'trial_end');
    await local.save({ transaction: tx });
  }
}
