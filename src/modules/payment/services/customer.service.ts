import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { StripeCustomer } from '../entities/stripe-customer.entity';
import { User } from '../../user/entities/user.entity';
import { StripeService } from './stripe.service';
import { Locale, apiError, toLocale } from '../../../common/i18n';

/**
 * CustomerService — owns the platform-account `stripe_customer` row.
 *
 * Why one row per BeeActive user (not per instructor-client pair):
 * - Saved cards persist across every instructor a user works with.
 * - Lazy created on first invoice/setup-intent.
 *
 * Guest support: rows can have `userId = null` when an instructor invoices
 * a walk-in by email. If that guest later registers with the same email,
 * `linkGuestToUser` connects the existing row to the new user_id (mirrors
 * `linkPendingInvitations` from the invitation module).
 */
@Injectable()
export class CustomerService {
  constructor(
    @InjectModel(StripeCustomer)
    private readonly stripeCustomerModel: typeof StripeCustomer,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Find or create the stripe_customer row for a registered BeeActive user.
   * Idempotent — second call returns the first row, no Stripe API hit.
   */
  async getOrCreateForUser(
    userId: string,
    tx?: Transaction,
  ): Promise<StripeCustomer> {
    const existing = await this.stripeCustomerModel.findOne({
      where: { userId },
      transaction: tx,
    });
    if (existing) return existing;

    const user = await this.userModel.findByPk(userId, { transaction: tx });
    if (!user) {
      throw new NotFoundException(apiError('payment.userNotFound'));
    }

    const stripeCustomer = await this.stripeService.stripe.customers.create(
      {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
        metadata: { beeactive_user_id: userId },
      },
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'stripe_customer',
          userId,
          'create',
        ),
      },
    );

    // Language of Stripe's own invoice emails and hosted pages. A
    // separate call rather than a `create` param on purpose: the create
    // idempotency key is per user, and Stripe rejects a retried key whose
    // params changed, which a language switch between attempts would do.
    await this.setPreferredLocale(
      userId,
      stripeCustomer.id,
      toLocale(user.language),
    );

    const row = await this.stripeCustomerModel.create(
      {
        userId,
        stripeCustomerId: stripeCustomer.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
      },
      { transaction: tx },
    );
    this.logger.log(
      `Stripe customer created for user ${userId}: ${stripeCustomer.id}`,
      'CustomerService',
    );
    return row;
  }

  /**
   * Find or create a guest stripe_customer row by email. Used when an
   * instructor invoices an external party that isn't on BeeActive yet.
   * `userId` stays null until `linkGuestToUser` runs after registration.
   */
  async getOrCreateGuest(
    email: string,
    name: string,
    tx?: Transaction,
  ): Promise<StripeCustomer> {
    const normalized = email.trim().toLowerCase();

    // First check if a registered user already exists with this email —
    // if yes, prefer the registered-user row over a fresh guest row. Only
    // a verified address: an account that merely typed this email at
    // sign-up must not receive invoices meant for its owner. Until then
    // the bill goes to the email, and joins the account at verification.
    const existingUser = await this.userModel.findOne({
      where: { email: normalized },
      attributes: ['id', 'isEmailVerified'],
      transaction: tx,
    });
    if (existingUser?.isEmailVerified) {
      return this.getOrCreateForUser(existingUser.id, tx);
    }

    const existingGuest = await this.stripeCustomerModel.findOne({
      where: { email: normalized, userId: null },
      transaction: tx,
    });
    if (existingGuest) return existingGuest;

    const stripeCustomer = await this.stripeService.stripe.customers.create(
      {
        email: normalized,
        name,
        metadata: { beeactive_user_id: 'guest' },
      },
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'customer_guest',
          normalized,
          'create',
        ),
      },
    );

    return this.stripeCustomerModel.create(
      {
        userId: null,
        stripeCustomerId: stripeCustomer.id,
        email: normalized,
        name,
      },
      { transaction: tx },
    );
  }

  /**
   * Point a user's Stripe customer at their language, so the invoice
   * emails Stripe sends and the pages it hosts follow the app. Called
   * (via the `payments.sync_customer_locale` job) when a user switches
   * language. Returns false when the user has no Stripe customer yet:
   * nothing to sync, and creation picks the language up on its own.
   */
  async syncPreferredLocale(userId: string, locale: Locale): Promise<boolean> {
    const customer = await this.stripeCustomerModel.findOne({
      where: { userId },
    });
    if (!customer) return false;
    return this.setPreferredLocale(userId, customer.stripeCustomerId, locale);
  }

  /**
   * Never throws: the language of Stripe's emails is cosmetic, and must
   * not fail the invoice or subscription that needed the customer.
   */
  private async setPreferredLocale(
    userId: string,
    stripeCustomerId: string,
    locale: Locale,
  ): Promise<boolean> {
    try {
      await this.stripeService.stripe.customers.update(
        stripeCustomerId,
        { preferred_locales: [locale] },
        {
          // Setting a value is naturally idempotent; the timestamp keeps
          // a later switch back to the same language from replaying this
          // call's cached response.
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'stripe_customer',
            userId,
            `locale_${locale}_${Date.now()}`,
          ),
        },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Could not set Stripe locale for user ${userId}: ${(err as Error).message}`,
        'CustomerService',
      );
      return false;
    }
  }

  /**
   * Run on user registration: any guest stripe_customer rows with the same
   * email become owned by the new user. Idempotent.
   */
  async linkGuestToUser(userId: string, email: string): Promise<number> {
    const normalized = email.trim().toLowerCase();
    const [updated] = await this.stripeCustomerModel.update(
      { userId },
      { where: { email: normalized, userId: null } },
    );
    if (updated > 0) {
      this.logger.log(
        `Linked ${updated} guest stripe_customer row(s) to user ${userId}`,
        'CustomerService',
      );
    }
    return updated;
  }
}
