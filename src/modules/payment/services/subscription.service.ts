import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Stripe } from 'stripe-types';

import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { Product, ProductType } from '../entities/product.entity';
import { User } from '../../user/entities/user.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import { EmailService } from '../../../common/services/email.service';
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
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly customerService: CustomerService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
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

    // Reject obvious duplicates with a friendly message before we
    // hit Stripe — otherwise the user sees Stripe's idempotency-key
    // error for an already-existing subscription.
    const existing = await this.subscriptionModel.findOne({
      where: {
        instructorId,
        clientId: dto.clientUserId,
        productId: dto.productId,
        status: {
          [Op.in]: [
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.UNPAID,
            SubscriptionStatus.INCOMPLETE,
          ],
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This client already has an active subscription to this plan. ' +
          'Cancel it first, or pick another plan.',
      );
    }

    // Two-phase save: insert the local row, commit, then call Stripe
    // OUTSIDE a DB transaction so we don't pin a Postgres connection
    // across an external HTTP call. The local row id seeds the
    // idempotency key, making each create attempt unique by design —
    // a second click reuses the same row id and Stripe's idempotency
    // cache returns the existing subscription.
    const customer = await this.customerService.getOrCreateForUser(
      dto.clientUserId,
    );

    const placeholder = await this.subscriptionModel.create({
      instructorId,
      clientId: dto.clientUserId,
      stripeCustomerId: customer.stripeCustomerId,
      productId: dto.productId,
      // We don't have the Stripe IDs yet; backfill below. Column is
      // nullable (migration 032) — Postgres treats NULLs as distinct in
      // UNIQUE indexes, so concurrent placeholder rows don't collide.
      // Filled in once `subscriptions.create` returns. Mirrors the
      // invoice fix in migration 024.
      stripeSubscriptionId: null,
      stripePriceId: product.stripePriceId,
      status: SubscriptionStatus.INCOMPLETE,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      trialStart: null,
      trialEnd: null,
      amountCents: product.amountCents,
      currency: product.currency,
    });

    try {
      const feeBps = account.platformFeeBps ?? 0;
      const inTrial = !!dto.trialDays && dto.trialDays > 0;

      // Always-confirm policy (consent-first):
      //
      // Every paid subscription is created with
      // `payment_behavior: 'default_incomplete'` regardless of whether
      // the client already has a card on file. The client must then
      // confirm by clicking through the first invoice's hosted page
      // (which shows the actual plan name + amount + cycle) and either
      // pick their saved card or enter a new one.
      //
      // Why: saving a card for one subscription is NOT blanket consent
      // to be charged for any future subscription the trainer creates.
      // PSD2/SCA, GDPR Art.6, and the EU Consumer Rights Directive all
      // require fresh consent per recurring service. Beyond compliance,
      // silent re-billing is the #1 dispute trigger on Stripe Connect
      // and trashes platform reputation. See SECURITY_NOTES.md §"Why
      // every new subscription requires client confirmation".
      //
      // Trial subscriptions are exempt because they defer payment —
      // there's no charge today to consent to. Stripe demands a card
      // before the trial ends; that's a separate reminder flow.
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
        // Expand so we can read latest_invoice.hosted_invoice_url right
        // after create — that URL is the consent surface we email the
        // client.
        expand: ['latest_invoice'],
        metadata: {
          beeactive_subscription_id: placeholder.id,
          beeactive_instructor_id: instructorId,
          beeactive_client_id: dto.clientUserId,
          beeactive_product_id: dto.productId,
        },
      };

      if (!inTrial) {
        subParams.payment_behavior = 'default_incomplete';
      }

      if (inTrial) {
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
            placeholder.id,
            'create',
          ),
        },
      );

      placeholder.stripeSubscriptionId = stripeSub.id;
      placeholder.status = stripeSub.status as SubscriptionStatus;
      placeholder.currentPeriodStart = subTs(
        stripeSub as unknown as SubRaw,
        'current_period_start',
      );
      placeholder.currentPeriodEnd = subTs(
        stripeSub as unknown as SubRaw,
        'current_period_end',
      );
      placeholder.trialStart = subTs(
        stripeSub as unknown as SubRaw,
        'trial_start',
      );
      placeholder.trialEnd = subTs(stripeSub as unknown as SubRaw, 'trial_end');
      await placeholder.save();

      await this.notificationService.notify({
        userId: dto.clientUserId,
        type: NotificationType.SUBSCRIPTION_CREATED,
        title: 'New subscription',
        body: `You have been subscribed to ${product.name}.`,
        data: { screen: 'client-subscriptions', entityId: placeholder.id },
      });

      this.logger.log(
        `Subscription ${placeholder.id} (stripe ${stripeSub.id}) created (status=${stripeSub.status})`,
        'SubscriptionService',
      );

      // Pull the hosted invoice URL from the just-created subscription.
      // For incomplete subs (the default path now), Stripe creates the
      // first invoice in 'open' status and exposes a hosted_invoice_url
      // we can send the client. They land on a Stripe-branded page
      // showing plan/amount/cycle — that's their explicit consent.
      let pendingConfirmationUrl: string | null = null;
      if (stripeSub.status === 'incomplete') {
        const latestInvoice = (
          stripeSub as unknown as {
            latest_invoice?: Stripe.Invoice | string | null;
          }
        ).latest_invoice;
        if (
          latestInvoice &&
          typeof latestInvoice === 'object' &&
          latestInvoice.hosted_invoice_url
        ) {
          pendingConfirmationUrl = latestInvoice.hosted_invoice_url;
        }

        if (pendingConfirmationUrl) {
          try {
            await this.sendConfirmationEmailIfPossible(
              placeholder,
              instructorId,
              product,
              pendingConfirmationUrl,
            );
          } catch (mailErr) {
            // Do NOT fail the subscription create on email failure.
            // The instructor can resend the link from the detail page.
            this.logger.warn(
              `Failed to send confirmation email for subscription ${placeholder.id}: ${(mailErr as Error).message}`,
              'SubscriptionService',
            );
          }
        } else {
          this.logger.warn(
            `Subscription ${placeholder.id} is incomplete but Stripe didn't return a hosted_invoice_url; the instructor will need to resend manually`,
            'SubscriptionService',
          );
        }
      }

      // Transient response field — UI uses it for the immediate post-
      // create toast. Re-mintable on demand via getConfirmationLink.
      const result = placeholder as Subscription & {
        pendingConfirmationUrl?: string | null;
      };
      result.pendingConfirmationUrl = pendingConfirmationUrl;
      return result;
    } catch (err) {
      // Stripe failed: drop the placeholder so the instructor can
      // retry cleanly without seeing a phantom INCOMPLETE row.
      await placeholder.destroy().catch((cleanupErr: unknown) => {
        this.logger.warn(
          `Failed to clean up orphaned subscription placeholder ${placeholder.id}: ${(cleanupErr as Error).message}`,
          'SubscriptionService',
        );
      });
      throw err;
    }
  }

  /**
   * Email the client the membership-confirmation link. Best-effort —
   * failures are logged but never throw the create call. The email
   * names the plan, amount, and cycle so the click-through is
   * informed consent, not a generic "click here".
   */
  private async sendConfirmationEmailIfPossible(
    sub: Subscription,
    instructorId: string,
    product: Product,
    confirmationUrl: string,
  ): Promise<void> {
    if (!sub.clientId) return; // guests don't apply here yet
    const [client, instructor] = await Promise.all([
      this.userModel.findByPk(sub.clientId),
      this.userModel.findByPk(instructorId),
    ]);
    if (!client?.email) return;
    const instructorName =
      [instructor?.firstName, instructor?.lastName]
        .filter((s): s is string => !!s)
        .join(' ') || 'Your trainer';
    const cycleLabel = product.interval
      ? product.intervalCount && product.intervalCount > 1
        ? `every ${product.intervalCount} ${product.interval}s`
        : `${product.interval}ly`
      : null;
    const amountLabel = `${(product.amountCents / 100).toFixed(2)} ${product.currency.toUpperCase()}`;
    await this.emailService.sendSubscriptionSetupEmail({
      to: client.email,
      instructorName,
      planName: product.name,
      amountLabel,
      cycleLabel,
      setupUrl: confirmationUrl,
      recipientName: client.firstName,
    });
  }

  /**
   * Bulk cancel-at-period-end for every active subscription belonging
   * to an instructor. Invoked from
   * `ConnectService.handleDeauthorized` when the instructor disconnects
   * from Stripe — we stop billing future cycles but let the current
   * paid period play out (industry-standard marketplace behaviour).
   *
   * This is best-effort per-subscription:
   * - Each Stripe call carries its own idempotency key so a retried
   *   webhook delivery doesn't double-fire the same cancel.
   * - If one subscription's Stripe call fails, we log + continue to
   *   the next so a single bad row doesn't block all cancellations.
   * - All local row updates run inside the caller's transaction.
   *
   * Returns the count of subscriptions touched (for the audit log).
   *
   * Notification fan-out (instructor + each affected client) is parked
   * for the jobs sprint — see docs/research/jobs-system/11-payment-parked-items.md.
   */
  async cancelAllActiveAtPeriodEndForInstructor(
    instructorId: string,
    tx: Transaction,
  ): Promise<number> {
    const active = await this.subscriptionModel.findAll({
      where: {
        instructorId,
        status: {
          [Op.in]: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ],
        },
        cancelAtPeriodEnd: false,
      },
      transaction: tx,
    });

    if (active.length === 0) return 0;

    let touched = 0;
    for (const sub of active) {
      const stripeId = sub.stripeSubscriptionId;
      if (!stripeId) {
        // Sub never finished its create round-trip; nothing to cancel
        // on Stripe. Local cleanup is enough.
        sub.cancelAtPeriodEnd = true;
        sub.cancelAt = sub.currentPeriodEnd;
        await sub.save({ transaction: tx });
        touched++;
        continue;
      }
      try {
        await this.stripeService.stripe.subscriptions.update(
          stripeId,
          { cancel_at_period_end: true },
          {
            idempotencyKey: this.stripeService.buildIdempotencyKey(
              'subscription',
              sub.id,
              'cancel-at-period-end-deauth',
            ),
          },
        );
        sub.cancelAtPeriodEnd = true;
        sub.cancelAt = sub.currentPeriodEnd;
        await sub.save({ transaction: tx });
        touched++;
      } catch (err: unknown) {
        // Don't bail — log per-sub and keep going. The deauth handler
        // is the only chance to do this without a jobs sweep.
        this.logger.error(
          `Failed to cancel-at-period-end subscription ${sub.id} (stripe ${stripeId}) on deauth: ${
            (err as Error).message
          }`,
          'SubscriptionService',
        );
      }
    }

    this.logger.log(
      `Deauth: cancel-at-period-end applied to ${touched}/${active.length} subscriptions for instructor ${instructorId}`,
      'SubscriptionService',
    );
    return touched;
  }

  /**
   * Assert the local subscription has been linked to its Stripe row.
   * Used as a guard before any subscriptions.* call — if the original
   * `subscriptions.create` failed mid-flight the stripe id stays null
   * and the row should not be operated on.
   */
  private assertStripeId(sub: Subscription): string {
    if (!sub.stripeSubscriptionId) {
      throw new BadRequestException(
        'Subscription is incomplete (Stripe link missing). Recreate it.',
      );
    }
    return sub.stripeSubscriptionId;
  }

  /**
   * Re-mint a confirmation URL for a subscription that's still
   * INCOMPLETE — the instructor uses this from the detail page when
   * the original email got lost. We pull the subscription's
   * `latest_invoice.hosted_invoice_url` from Stripe (NOT a setup-mode
   * Checkout — see the always-confirm policy in `create()`).
   *
   * Returns `{ url: null }` if the subscription is past INCOMPLETE
   * (no confirmation needed).
   */
  async getConfirmationLink(
    instructorId: string,
    subscriptionId: string,
  ): Promise<{ url: string | null; status: SubscriptionStatus }> {
    const sub = await this.getOneForInstructor(instructorId, subscriptionId);
    if (sub.status !== SubscriptionStatus.INCOMPLETE) {
      return { url: null, status: sub.status };
    }
    const stripeSub = (await this.stripeService.stripe.subscriptions.retrieve(
      this.assertStripeId(sub),
      { expand: ['latest_invoice'] },
    )) as Stripe.Subscription & {
      latest_invoice?: Stripe.Invoice | string | null;
    };
    const inv = stripeSub.latest_invoice;
    const url =
      inv && typeof inv === 'object' && inv.hosted_invoice_url
        ? inv.hosted_invoice_url
        : null;
    return { url, status: sub.status };
  }

  /**
   * Single-subscription lookup for the instructor view. Includes the
   * same client + plan eager-loads as the list so the detail page can
   * render names without an extra round-trip.
   */
  async getOneForInstructor(
    instructorId: string,
    subscriptionId: string,
  ): Promise<Subscription> {
    const sub = await this.subscriptionModel.findByPk(subscriptionId, {
      include: [
        {
          model: User,
          as: 'client',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl'],
        },
        {
          model: Product,
          attributes: ['id', 'name', 'interval', 'intervalCount'],
        },
      ],
    });
    if (!sub) throw new NotFoundException('Subscription not found.');
    if (sub.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this subscription.');
    }
    return sub;
  }

  async listForInstructor(
    instructorId: string,
    page: number,
    limit: number,
    status?: SubscriptionStatus,
  ): Promise<PaginatedResponse<Subscription>> {
    const where: Record<string, unknown> = { instructorId };
    if (status) where.status = status;
    // Enrich with client + plan info so the table can render names
    // and emails instead of opaque UUIDs. `findAndCountAll` with
    // includes uses `distinct: true` to keep the count accurate.
    const { rows, count } = await this.subscriptionModel.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'client',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl'],
        },
        {
          model: Product,
          attributes: ['id', 'name', 'interval', 'intervalCount'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
      distinct: true,
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async listForClient(
    clientId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Subscription>> {
    // Eager-load the plan snapshot so the client UI can render plan
    // names instead of opaque UUIDs. We do NOT include the User join
    // here — the row already belongs to this client; rendering their
    // own name back at them is noise.
    const { rows, count } = await this.subscriptionModel.findAndCountAll({
      where: { clientId },
      include: [
        {
          model: Product,
          attributes: ['id', 'name', 'interval', 'intervalCount'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
      distinct: true,
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Count-only lookups for the client's billing tabs. Avoids hydrating
   * the full list just to render a badge.
   */
  async countForClient(
    clientId: string,
  ): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.subscriptionModel.count({ where: { clientId } }),
      this.subscriptionModel.count({
        where: {
          clientId,
          status: {
            [Op.in]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
          },
        },
      }),
    ]);
    return { total, active };
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

    const stripeId = this.assertStripeId(sub);
    if (immediate) {
      await this.stripeService.stripe.subscriptions.cancel(
        stripeId,
        undefined,
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'subscription',
            sub.id,
            'cancel-immediate',
          ),
        },
      );
      sub.status = SubscriptionStatus.CANCELED;
      sub.canceledAt = new Date();
    } else {
      await this.stripeService.stripe.subscriptions.update(
        stripeId,
        { cancel_at_period_end: true },
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'subscription',
            sub.id,
            'cancel-at-period-end',
          ),
        },
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

  /**
   * Client-initiated cancellation. Always at-period-end — clients
   * already paid for the current cycle, so taking access away
   * immediately would feel punitive and is non-standard SaaS behavior.
   * Stripe Customer Portal does the same thing.
   *
   * Ownership: caller must be the subscription's client. Instructors
   * cancel through `cancel()` above.
   */
  async cancelByClient(
    clientId: string,
    subscriptionId: string,
  ): Promise<Subscription> {
    const sub = await this.subscriptionModel.findByPk(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found.');
    if (sub.clientId !== clientId) {
      throw new ForbiddenException('You do not own this subscription.');
    }
    if (sub.status === SubscriptionStatus.CANCELED) {
      return sub;
    }
    if (sub.cancelAtPeriodEnd) {
      // Already scheduled — idempotent.
      return sub;
    }

    await this.stripeService.stripe.subscriptions.update(
      this.assertStripeId(sub),
      { cancel_at_period_end: true },
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'subscription',
          sub.id,
          'cancel-at-period-end-by-client',
        ),
      },
    );
    sub.cancelAtPeriodEnd = true;
    sub.cancelAt = sub.currentPeriodEnd;
    await sub.save();

    // Notify both parties so the instructor sees the pending cancel
    // alongside their other memberships without having to hunt for it.
    await this.notificationService.notify({
      userId: clientId,
      type: NotificationType.SUBSCRIPTION_CANCELED,
      title: 'Membership will cancel',
      body: 'Your membership will end at the close of the current period.',
      data: { screen: 'client-subscriptions', entityId: sub.id },
    });
    await this.notificationService.notify({
      userId: sub.instructorId,
      type: NotificationType.SUBSCRIPTION_CANCELED,
      title: 'Membership cancelled by client',
      body: 'A client cancelled their membership; access ends at period close.',
      data: { screen: 'instructor-subscriptions', entityId: sub.id },
    });

    return sub;
  }

  // =====================================================================
  // WEBHOOK SYNC
  // =====================================================================

  // (NOTE: the previous push-model used `setup_intent.succeeded` to
  // attach a PM after Checkout setup-mode and retry the open invoice.
  // The always-confirm policy uses the invoice's hosted_invoice_url
  // directly, so Stripe handles the entire pay-and-activate cycle and
  // we just react to the resulting `invoice.paid` +
  // `customer.subscription.updated` webhooks via syncFromWebhook below.
  // No SetupIntent handler needed.)

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
