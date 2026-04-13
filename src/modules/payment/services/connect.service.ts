import {
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
 * Country policy: Romania-only for v1 (`country: 'RO'`). When BeeActive expands,
 * derive country from the instructor profile's `locationCountry` field.
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
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
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

    const stripeAccount = await this.stripeService.stripe.accounts.create(
      {
        type: 'express',
        country: 'RO',
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
    const returnUrl =
      options.returnUrl ??
      `${frontendUrl}/instructor/payments/onboarding-complete`;
    const refreshUrl =
      options.refreshUrl ??
      `${frontendUrl}/instructor/payments/onboarding-refresh`;

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
   * Handle `account.application.deauthorized` — the instructor revoked our
   * OAuth grant via the Stripe Express Dashboard. We mark the account as
   * disconnected and refuse new charges, but we DO NOT auto-cancel active
   * subscriptions: those are owned by the platform account and continue to
   * run. A support agent + the instructor must manually resolve.
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
    local.disconnectedAt = new Date();
    local.chargesEnabled = false;
    local.payoutsEnabled = false;
    await local.save({ transaction: tx });

    await this.notificationService.notify({
      userId: local.userId,
      type: NotificationType.STRIPE_ACCOUNT_RESTRICTED,
      title: 'Stripe account disconnected',
      body:
        'Your Stripe account was disconnected from BeeActive. Existing ' +
        'subscriptions still run on the platform. Contact support to reconnect.',
      data: { screen: 'instructor-payments' },
    });
  }
}
