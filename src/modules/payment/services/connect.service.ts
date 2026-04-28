import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { Transaction } from 'sequelize';
// See stripe.service.ts for the path-aliased ambient explanation.
import type { Stripe } from 'stripe-types';

import { StripeAccount } from '../entities/stripe-account.entity';
import { StripeService } from './stripe.service';
import { SubscriptionService } from './subscription.service';
import { User } from '../../user/entities/user.entity';
import { isStripeSupportedCountry } from '../../../common/constants/countries';
import {
  NotificationService,
  NotificationType,
} from '../../notification/notification.service';

/**
 * ConnectService
 *
 * Owns the Stripe Connect Express lifecycle for instructors:
 *
 *   1. **getOrCreateAccount**     — idempotent create on first onboarding click
 *   2. **createOnboardingLink**   — hosted Account Link the FE redirects to
 *   3. **getStatus**              — read local mirror, derive `canIssueInvoices`
 *   4. **createDashboardLink**    — one-time login link to Stripe Express Dashboard
 *   5. **syncAccountFromWebhook** — invoked from `account.updated` / `capability.updated`
 *   6. **handleDeauthorized**     — invoked from `account.application.deauthorized`
 *
 * Why a separate service (not inside StripeService): StripeService is the
 * thin SDK wrapper. Anything that touches local DB tables, fires
 * notifications, or runs business rules belongs here.
 *
 * Country policy: derived from `user.countryCode` (ISO 3166-1 alpha-2)
 * validated against the Stripe Connect Express whitelist in
 * `common/constants/countries.ts`. A user without a country set gets
 * a 400 Bad Request until they complete their profile.
 *
 * Race-safety: `getOrCreateAccount` accepts an optional `tx` so callers
 * already inside a transaction (e.g. invoice creation auto-onboarding flow,
 * if we ever add it) reuse the same transaction.
 */
@Injectable()
export class ConnectService {
  constructor(
    @InjectModel(StripeAccount)
    private readonly stripeAccountModel: typeof StripeAccount,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Find or create the local stripe_account row + remote Stripe account.
   *
   * Idempotency:
   *   - If a local row exists, return it without touching Stripe.
   *   - If not, call Stripe.accounts.create with an idempotency key
   *     derived from the user id, then insert the local row.
   *
   * The Stripe idempotency key is what makes a retried request safe — if
   * the FE clicks "Set up payments" twice in quick succession, the second
   * request resolves to the same Stripe account id rather than creating a
   * second account.
   */
  async getOrCreateAccount(
    userId: string,
    tx?: Transaction,
  ): Promise<StripeAccount> {
    const existing = await this.stripeAccountModel.findOne({
      where: { userId },
      transaction: tx,
    });
    if (existing) return existing;

    const user = await this.userModel.findByPk(userId, { transaction: tx });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    const countryCode = user.countryCode;
    if (!countryCode) {
      throw new BadRequestException(
        'Set your country on your profile before connecting payments.',
      );
    }
    if (!isStripeSupportedCountry(countryCode)) {
      throw new BadRequestException(
        `Stripe Connect is not available in ${countryCode} yet.`,
      );
    }

    const stripeAccount = await this.stripeService.stripe.accounts.create(
      {
        type: 'express',
        country: countryCode,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { beeactive_user_id: userId },
      },
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'connect_account',
          userId,
          'create',
        ),
      },
    );

    const row = await this.stripeAccountModel.create(
      {
        userId,
        stripeAccountId: stripeAccount.id,
        chargesEnabled: stripeAccount.charges_enabled ?? false,
        payoutsEnabled: stripeAccount.payouts_enabled ?? false,
        detailsSubmitted: stripeAccount.details_submitted ?? false,
        country: stripeAccount.country ?? null,
        defaultCurrency: stripeAccount.default_currency ?? null,
        platformFeeBps: this.configService.get<number>(
          'DEFAULT_PLATFORM_FEE_BPS',
          0,
        ),
        disabledReason: stripeAccount.requirements?.disabled_reason ?? null,
        requirementsCurrentlyDue:
          stripeAccount.requirements?.currently_due ?? null,
      },
      { transaction: tx },
    );

    this.logger.log(
      `Stripe Connect account created: ${stripeAccount.id} for user ${userId}`,
      'ConnectService',
    );
    return row;
  }

  /**
   * Create a Stripe Account Link the instructor redirects to. The link is
   * single-use and expires after a few minutes; we never cache it.
   *
   * `type: 'account_onboarding'` is the hosted KYC + bank flow. The
   * alternative `'account_update'` is for re-collecting fields after the
   * webhook flags `requirements.currently_due` items.
   *
   * Wrapped in a transaction so the local row insert (when first onboarding)
   * commits atomically with the Stripe call. If Stripe rejects the link
   * creation, the local row was already inserted on a previous call (or in
   * the same transaction here) and stays put — the next click reuses it.
   */
  async createOnboardingLink(
    userId: string,
    options: { returnUrl?: string; refreshUrl?: string } = {},
  ): Promise<{ url: string; expiresAt: string }> {
    const account = await this.sequelize.transaction((tx) =>
      this.getOrCreateAccount(userId, tx),
    );

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    // FE routes live under `/coaching` (the instructor area) with
    // `onboarding/return` and `onboarding/refresh` — see
    // `projects/web/src/app/main/instructor/instructor.routes.ts`.
    // An earlier iteration pointed Stripe at
    // `/instructor/payments/onboarding-complete` which doesn't exist
    // and 404'd after onboarding completion.
    const returnUrl =
      options.returnUrl ?? `${frontendUrl}/coaching/onboarding/return`;
    const refreshUrl =
      options.refreshUrl ?? `${frontendUrl}/coaching/onboarding/refresh`;

    const link = await this.stripeService.stripe.accountLinks.create({
      account: account.stripeAccountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return {
      url: link.url,
      expiresAt: new Date(link.expires_at * 1000).toISOString(),
    };
  }

  /**
   * Read-only status check used by the dashboard onboarding card.
   *
   * `canIssueInvoices` is the single boolean the FE acts on: when true the
   * "Create invoice" button is enabled, when false a banner explains the
   * required next step (taken from `requirementsCurrentlyDue`).
   */
  async getStatus(userId: string): Promise<{
    account: StripeAccount | null;
    canIssueInvoices: boolean;
  }> {
    const account = await this.stripeAccountModel.findOne({
      where: { userId },
    });
    return {
      account,
      canIssueInvoices: account?.chargesEnabled === true,
    };
  }

  /**
   * Force a fresh pull from Stripe and reconcile the local row. Used
   * as an escape hatch when webhooks are missed (localhost dev without
   * `stripe listen`, or a dropped delivery in prod). Returns the same
   * shape as `getStatus`, so the FE can swap the signal atomically.
   *
   * No-op — but not an error — when the user has no local Stripe row
   * yet: nothing to refresh, the FE should show the "Set up payments"
   * flow instead.
   */
  async refreshStatus(userId: string): Promise<{
    account: StripeAccount | null;
    canIssueInvoices: boolean;
  }> {
    const local = await this.stripeAccountModel.findOne({
      where: { userId },
    });
    if (!local) {
      return { account: null, canIssueInvoices: false };
    }

    const live = await this.stripeService.stripe.accounts.retrieve(
      local.stripeAccountId,
    );

    await this.sequelize.transaction((tx) =>
      this.syncAccountFromWebhook(live, tx),
    );

    return this.getStatus(userId);
  }

  /**
   * One-time login link into the Stripe Express Dashboard.
   *
   * Stripe rejects this call when `details_submitted=false` (the dashboard
   * does not exist yet). Translate that into 422 with a clear message rather
   * than letting the raw Stripe error escape.
   */
  async createDashboardLink(userId: string): Promise<{ url: string }> {
    const account = await this.stripeAccountModel.findOne({
      where: { userId },
    });
    if (!account) {
      throw new NotFoundException(
        'No Stripe Connect account found. Start onboarding first.',
      );
    }
    if (!account.detailsSubmitted) {
      throw new UnprocessableEntityException(
        'Complete Stripe onboarding before opening the Express Dashboard.',
      );
    }
    const link = await this.stripeService.stripe.accounts.createLoginLink(
      account.stripeAccountId,
    );
    return { url: link.url };
  }

  /**
   * Sync the local mirror from a webhook payload. Called from inside the
   * webhook handler's transaction — DO NOT open a new transaction here.
   *
   * Side effect: when `chargesEnabled` flips false → true we fire the
   * STRIPE_ACCOUNT_READY notification. The notification call is awaited
   * inside the transaction; per project policy notifications are
   * fire-and-forget logger writes today, so they're safe to await here.
   * When the real notification system lands (Phase 2 of the notification
   * module), this should move POST-commit.
   */
  async syncAccountFromWebhook(
    stripeAccount: Stripe.Account,
    tx: Transaction,
  ): Promise<void> {
    const local = await this.stripeAccountModel.findOne({
      where: { stripeAccountId: stripeAccount.id },
      transaction: tx,
    });
    if (!local) {
      // Webhook arrived for an account we don't have locally. This happens
      // when a connected account is created out-of-band (e.g. via the Stripe
      // Dashboard during testing). Log and return — the next onboarding
      // click from the user will create the local row.
      this.logger.warn(
        `account.updated received for unknown stripe account ${stripeAccount.id}`,
        'ConnectService',
      );
      return;
    }

    const wasChargesEnabled = local.chargesEnabled;
    const wasRestricted = !!local.disabledReason;

    local.chargesEnabled = stripeAccount.charges_enabled ?? false;
    local.payoutsEnabled = stripeAccount.payouts_enabled ?? false;
    local.detailsSubmitted = stripeAccount.details_submitted ?? false;
    local.country = stripeAccount.country ?? local.country;
    local.defaultCurrency =
      stripeAccount.default_currency ?? local.defaultCurrency;
    local.disabledReason = stripeAccount.requirements?.disabled_reason ?? null;
    local.requirementsCurrentlyDue =
      stripeAccount.requirements?.currently_due ?? null;

    if (
      local.chargesEnabled &&
      local.detailsSubmitted &&
      !local.onboardingCompletedAt
    ) {
      local.onboardingCompletedAt = new Date();
    }

    await local.save({ transaction: tx });

    if (!wasChargesEnabled && local.chargesEnabled) {
      await this.notificationService.notify({
        userId: local.userId,
        type: NotificationType.STRIPE_ACCOUNT_READY,
        title: 'Payments enabled',
        body:
          'Your Stripe account is verified. You can now issue invoices and ' +
          'accept payments from clients.',
        data: { screen: 'instructor-payments' },
      });
    } else if (!wasRestricted && local.disabledReason) {
      await this.notificationService.notify({
        userId: local.userId,
        type: NotificationType.STRIPE_ACCOUNT_RESTRICTED,
        title: 'Action required on your Stripe account',
        body:
          'Stripe has flagged additional information is required to keep ' +
          'your payouts active. Open the Express Dashboard to resolve it.',
        data: { screen: 'instructor-payments' },
      });
    }
  }

  /**
   * Handle `account.application.deauthorized` — the instructor revoked
   * our OAuth grant (or Stripe terminated their account).
   *
   * Two behaviours, in order:
   *
   *   1. Cancel-at-period-end every active subscription for this
   *      instructor. The current cycle continues to run (clients keep
   *      access for what they already paid for) but no future renewal
   *      attempts. Without this, Stripe would silently fail to transfer
   *      money to the deauthorized Connect account on the next renewal
   *      and the client would still be charged. See
   *      docs/research/jobs-system/11-payment-parked-items.md for the
   *      notification fan-out (parked for jobs sprint).
   *
   *   2. Delete the local stripe_account row. The Stripe account id is
   *      dead to us once Stripe revokes our OAuth grant — any future
   *      Stripe call against it will fail. Keeping a soft-flagged row
   *      breaks `getOrCreateAccount` (it short-circuits on an existing
   *      row and returns the dead id). Deleting lets reconnect work
   *      cleanly: the next "Set up payments" click creates a brand-new
   *      Stripe Connect account.
   *
   *      Trade-off: we lose the historical link from instructor →
   *      former Stripe account id. Acceptable: invoices/payments/subs
   *      retain `instructor_id` directly, and Stripe's records are the
   *      legal source of truth for past charges.
   */
  async handleDeauthorized(
    stripeAccountId: string,
    tx: Transaction,
  ): Promise<void> {
    const local = await this.stripeAccountModel.findOne({
      where: { stripeAccountId },
      transaction: tx,
    });
    if (!local) {
      this.logger.warn(
        `account.application.deauthorized received for unknown account ${stripeAccountId}`,
        'ConnectService',
      );
      return;
    }

    const instructorId = local.userId;

    // 1) Stop billing future cycles on every active subscription.
    const cancelled =
      await this.subscriptionService.cancelAllActiveAtPeriodEndForInstructor(
        instructorId,
        tx,
      );

    // 2) Delete the dead row so reconnect works cleanly.
    await local.destroy({ transaction: tx });

    this.logger.log(
      `Stripe account ${stripeAccountId} (instructor ${instructorId}) deauthorized: ${cancelled} subscription(s) cancelled-at-period-end, local row deleted.`,
      'ConnectService',
    );

    // Best-effort instructor notification. Per-client notifications +
    // emails are queued for the jobs sprint.
    await this.notificationService.notify({
      userId: instructorId,
      type: NotificationType.STRIPE_ACCOUNT_RESTRICTED,
      title: 'Stripe account disconnected',
      body:
        cancelled > 0
          ? `Your Stripe account was disconnected. ${cancelled} active subscription${cancelled === 1 ? '' : 's'} will end at the current billing period — no future charges. You can reconnect from the payments page.`
          : 'Your Stripe account was disconnected. You can reconnect from the payments page.',
      data: { screen: 'instructor-payments' },
    });
  }
}
