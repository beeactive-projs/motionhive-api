import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { toLocale } from '../../common/i18n';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { WORKOUT_PHOTO_RESOURCE } from '../workout/workout-photo.service';
import { escapeLikeWildcards } from '../../common/utils/search.utils';
import { EmailService } from '../../common/services/email.service';
import { MessagingService } from '../messaging/messaging.service';
import { StripeCustomer } from '../payment/entities/stripe-customer.entity';
import { StripeService } from '../payment/services/stripe.service';
import { User } from '../user/entities/user.entity';
import { AccountWindDownService } from './account-wind-down.service';
import {
  AccountDeletion,
  AccountDeletionStatus,
} from './entities/account-deletion.entity';

export interface ErasureSweepResult {
  /** Wind-downs that had failed before and finished now. */
  woundDown: number;
  erased: number;
  failed: number;
  /** Accounts switched back on (by support) before their date: kept. */
  kept: number;
}

/**
 * The address an erased account keeps: unique (the email column is UNIQUE
 * across deleted rows too), undeliverable (`.invalid` is reserved), and
 * free of the person's real address, which can then sign up again.
 */
export function erasedEmail(userId: string): string {
  return `erased-${userId}@erased.motionhive.invalid`;
}

/**
 * What erasure does in the database, in order, inside one transaction.
 * Mirrors the published policy (website /legal/delete-account): what the
 * person did and owned is deleted, what they wrote in groups stays but is
 * no longer linked to anyone, payment records stay for the 5 years the law
 * requires, with the name and address taken off them.
 *
 * The user row itself is never deleted: posts, invoices, programs and admin
 * logs keep RESTRICT / NO ACTION keys to it. It stays as an empty, inactive
 * husk with no name, address, photo or sign-in.
 *
 * Replacements: :id, :email (their real address), :erasedEmail, :now.
 */
const ERASURE_STATEMENTS: ReadonlyArray<readonly [string, string]> = [
  // ── What they did and planned ──
  // Cascades to logged exercises and sets.
  ['workout logs', `DELETE FROM workout_log WHERE user_id = :id`],
  // Reports against their workouts go with the workouts (ON DELETE
  // CASCADE); the ones they filed hold their notes about someone else.
  [
    'workout reports they filed',
    `DELETE FROM workout_report WHERE reporter_id = :id`,
  ],
  ['personal records', `DELETE FROM one_rep_max WHERE user_id = :id`],
  // Plans assigned to them, by a coach or themselves; cascades to the copies.
  ['assigned plans', `DELETE FROM program_assignment WHERE client_id = :id`],
  // Programs and routines they wrote. Copies already assigned to clients
  // keep living: their link back to the original is set to NULL.
  [
    'own programs',
    `DELETE FROM program WHERE owner_id = :id AND source <> 'SYSTEM'`,
  ],

  // ── People they trained with ──
  [
    'coaching relationships',
    `DELETE FROM instructor_client WHERE client_id = :id OR instructor_id = :id`,
  ],
  [
    'client requests',
    `DELETE FROM client_request WHERE from_user_id = :id OR to_user_id = :id`,
  ],
  // Bookings stay as anonymous seats so past sessions keep their numbers;
  // the notes about or by the person go.
  [
    'booking notes',
    `UPDATE session_participant
        SET booking_note = NULL, private_note = NULL, cancel_reason = NULL
      WHERE user_id = :id`,
  ],

  // ── Groups ──
  ['group memberships', `DELETE FROM group_member WHERE user_id = :id`],
  ['join requests', `DELETE FROM group_join_request WHERE user_id = :id`],
  [
    'group invitations',
    `DELETE FROM invitation WHERE inviter_id = :id OR LOWER(email) = LOWER(:email)`,
  ],
  // Groups they owned were closed at the request; their contact details go.
  [
    'owned group contacts',
    `UPDATE "group"
        SET contact_email = NULL, contact_phone = NULL, address = NULL
      WHERE instructor_id = :id`,
  ],

  // ── Coach profile ──
  [
    'venues',
    `DELETE FROM venue
      WHERE instructor_id IN (SELECT id FROM instructor_profile WHERE user_id = :id)`,
  ],
  // Reviews about a coach who no longer exists describe nobody.
  [
    'reviews of them',
    `DELETE FROM review
      WHERE instructor_profile_id IN (SELECT id FROM instructor_profile WHERE user_id = :id)`,
  ],
  [
    'coach profile',
    `UPDATE instructor_profile
        SET display_name = NULL, bio = NULL, certifications = NULL,
            social_links = NULL, specializations = NULL,
            is_accepting_clients = false, is_public = false,
            show_email = false, show_phone = false,
            deleted_at = COALESCE(deleted_at, :now), updated_at = :now
      WHERE user_id = :id`,
  ],

  // ── What they sent us ──
  [
    'feedback',
    `UPDATE feedback SET email = NULL, user_id = NULL WHERE user_id = :id`,
  ],
  ['blocks they made', `DELETE FROM user_block WHERE blocker_id = :id`],

  // ── Sign-in, devices, notifications ──
  ['linked sign-ins', `DELETE FROM social_account WHERE user_id = :id`],
  ['sessions', `DELETE FROM refresh_token WHERE user_id = :id`],
  ['devices', `DELETE FROM device_token WHERE user_id = :id`],
  [
    'notification preferences',
    `DELETE FROM notification_preference WHERE user_id = :id`,
  ],
  [
    'notification receipts',
    `DELETE FROM notification_receipt WHERE user_id = :id`,
  ],
  // Notifications addressed to them alone (cascades their receipts).
  ['their notifications', `DELETE FROM notification WHERE audience_id = :id`],
  [
    'search',
    `DELETE FROM search_doc
      WHERE owner_id = :id OR (entity_type IN ('user', 'instructor') AND entity_id = :id)`,
  ],

  // ── Payment records: kept 5 years, name and address taken off ──
  [
    'payment customers',
    `UPDATE stripe_customer
        SET email = :erasedEmail, name = NULL, default_payment_method_id = NULL,
            updated_at = :now
      WHERE user_id = :id OR LOWER(email) = LOWER(:email)`,
  ],

  // ── The account itself ──
  [
    'account',
    `UPDATE "user"
        SET email = :erasedEmail, first_name = '', last_name = '',
            phone = NULL, avatar_url = NULL, avatar_public_id = NULL,
            city = NULL, country_code = NULL, handle = NULL,
            password_hash = NULL,
            email_verification_token = NULL, email_verification_expires = NULL,
            password_reset_token = NULL, password_reset_expires = NULL,
            locked_until = NULL, last_login_at = NULL,
            privacy_settings = '{}'::jsonb,
            is_active = false, is_email_verified = false, updated_at = :now
      WHERE id = :id`,
  ],
];

/**
 * Erases accounts whose cooling-off has run out, and retries the
 * wind-down for any deletion where a step failed. Driven by the daily
 * `maintenance.erase_accounts` job.
 */
@Injectable()
export class AccountErasureService {
  constructor(
    @InjectModel(AccountDeletion)
    private readonly deletionModel: typeof AccountDeletion,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(StripeCustomer)
    private readonly stripeCustomerModel: typeof StripeCustomer,
    private readonly windDownService: AccountWindDownService,
    private readonly messagingService: MessagingService,
    private readonly stripeService: StripeService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly emailService: EmailService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /** The daily sweep. A failure is logged and retried on the next run. */
  async runDaily(now: Date): Promise<ErasureSweepResult> {
    const result: ErasureSweepResult = {
      woundDown: 0,
      erased: 0,
      failed: 0,
      kept: 0,
    };

    result.kept = await this.cancelReactivated();

    const unfinished = await this.deletionModel.findAll({
      where: { status: AccountDeletionStatus.SCHEDULED, woundDownAt: null },
    });
    for (const deletion of unfinished) {
      if (await this.windDownService.windDown(deletion.userId)) {
        await deletion.update({ woundDownAt: new Date() });
        result.woundDown++;
      }
    }

    const due = await this.deletionModel.findAll({
      where: {
        status: AccountDeletionStatus.SCHEDULED,
        scheduledFor: { [Op.lte]: now },
      },
    });
    for (const deletion of due) {
      try {
        await this.erase(deletion);
        result.erased++;
      } catch (err) {
        result.failed++;
        this.logger.error(
          `Erasure failed for ${deletion.userId}: ${err instanceof Error ? err.message : String(err)}`,
          'AccountErasureService',
        );
      }
    }
    return result;
  }

  /**
   * A scheduled deletion whose account is active again was kept another
   * way (support switched it back on): cancel it rather than erase someone
   * who is using the app.
   */
  private async cancelReactivated(): Promise<number> {
    const [, rows] = await this.sequelize.query(
      `UPDATE account_deletion d
          SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
         FROM "user" u
        WHERE u.id = d.user_id AND u.is_active = true
          AND d.status = 'SCHEDULED'
      RETURNING d.user_id`,
      { type: QueryTypes.UPDATE },
    );
    if (rows > 0) {
      this.logger.warn(
        `${rows} scheduled deletion(s) cancelled: the account was active again`,
        'AccountErasureService',
      );
    }
    return rows;
  }

  /**
   * Erase one account. Stripe goes first: if it fails nothing local has
   * changed and the next sweep tries again. Safe to run twice.
   */
  async erase(deletion: AccountDeletion): Promise<void> {
    const user = await this.userModel.findByPk(deletion.userId, {
      paranoid: false,
    });
    if (!user) {
      throw new Error(`user ${deletion.userId} not found`);
    }

    // Captured before the scrub: the last email goes to the real address.
    const farewell = {
      email: user.email,
      firstName: user.firstName || null,
      locale: toLocale(deletion.locale ?? user.language),
    };

    // Read before the scrub: the Stripe ids and the address are what find
    // this person inside stored Stripe events.
    const stripeEventPatterns = await this.stripeEventPatterns(
      user.id,
      user.email,
    );

    // Anything a failed step left running ends before the data goes.
    await this.windDownService.windDown(user.id);
    await this.deleteStripeCustomers(user.id, user.email);
    await this.messagingService.eraseMessagesFrom(user.id);

    const now = new Date();
    await this.sequelize.transaction(async (tx) => {
      const replacements = {
        id: user.id,
        email: user.email,
        erasedEmail: erasedEmail(user.id),
        now,
      };
      for (const [, sql] of ERASURE_STATEMENTS) {
        await this.sequelize.query(sql, {
          replacements,
          transaction: tx,
          type: QueryTypes.RAW,
        });
      }
      // The raw Stripe events we stored hold names, addresses and card
      // endings. Ours to drop once handled: Stripe keeps its own record.
      // Events still waiting to be processed are left for the handler.
      await this.sequelize.query(
        `UPDATE webhook_event SET payload = '{"erased": true}'::jsonb
          WHERE status IN ('processed', 'ignored', 'failed')
            AND payload::text ILIKE ANY (ARRAY[:patterns]::text[])`,
        {
          replacements: { patterns: stripeEventPatterns },
          transaction: tx,
          type: QueryTypes.UPDATE,
        },
      );
      await deletion.update(
        {
          status: AccountDeletionStatus.ERASED,
          erasedAt: now,
          codeHash: null,
          codeExpiresAt: null,
        },
        { transaction: tx },
      );
    });

    // Best effort, after the commit: the files hold no link to anyone once
    // the rows above are gone.
    await this.cloudinaryService.deleteFolder(
      this.cloudinaryService.buildUserFolder('avatars', user.id),
    );
    // Workout photos are private assets, which a prefix delete only
    // reaches when told their type.
    await this.cloudinaryService.deleteFolder(
      this.cloudinaryService.buildPrivateFolder(
        WORKOUT_PHOTO_RESOURCE,
        user.id,
      ),
      'authenticated',
    );

    await this.emailService.sendAccountDeletionCompletedEmail(
      farewell.email,
      farewell.firstName,
      farewell.locale,
    );
    this.logger.log(`Account erased: ${user.id}`, 'AccountErasureService');
  }

  /**
   * ILIKE patterns that find this person in stored Stripe events: their
   * address, every Stripe customer id they had, and their Connect account
   * if they coached.
   */
  private async stripeEventPatterns(
    userId: string,
    email: string,
  ): Promise<string[]> {
    const ids = await this.sequelize.query<{ id: string }>(
      `SELECT stripe_customer_id AS id FROM stripe_customer
        WHERE user_id = :userId OR LOWER(email) = LOWER(:email)
       UNION
       SELECT stripe_account_id AS id FROM stripe_account WHERE user_id = :userId`,
      { replacements: { userId, email }, type: QueryTypes.SELECT },
    );
    return [email, ...ids.map((row) => row.id)].map(
      (value) => `%${escapeLikeWildcards(value)}%`,
    );
  }

  /**
   * Ask Stripe to delete every customer for this person, linked or a guest
   * one a coach invoiced by email (the policy promises it). Stripe keeps
   * the transaction records itself. A customer already gone counts as done.
   */
  private async deleteStripeCustomers(
    userId: string,
    email: string,
  ): Promise<void> {
    const customers = await this.stripeCustomerModel.findAll({
      where: {
        [Op.or]: [
          { userId },
          this.sequelize.where(
            this.sequelize.fn('LOWER', this.sequelize.col('email')),
            email.toLowerCase(),
          ),
        ],
      },
      attributes: ['stripeCustomerId'],
    });
    if (customers.length === 0) return;
    if (!this.stripeService.isConfigured) {
      this.logger.warn(
        `Stripe is not configured; ${customers.length} customer(s) of ${userId} left on Stripe`,
        'AccountErasureService',
      );
      return;
    }
    for (const { stripeCustomerId } of customers) {
      try {
        await this.stripeService.stripe.customers.del(stripeCustomerId);
      } catch (err) {
        if (isMissingResource(err)) continue;
        throw err;
      }
    }
  }
}

function isMissingResource(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'resource_missing'
  );
}
