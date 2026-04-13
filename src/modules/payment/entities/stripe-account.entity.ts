import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';

/**
 * StripeAccount Entity
 *
 * Represents an instructor's Stripe Connect Express account — the link
 * between a BeeActive instructor and their ability to receive money.
 *
 * One row per instructor. Created when the instructor kicks off
 * onboarding via POST /payments/onboarding/start; mutated entirely by
 * the `account.updated` webhook thereafter (we never read these flags
 * from the Stripe API in request handlers).
 *
 * Key field: `chargesEnabled`. We block invoice creation unless it is
 * TRUE — see PaymentService#assertInstructorCanCharge.
 *
 * `platformFeeBps` is the per-instructor commission in basis points
 * (100 bps = 1%). Defaults to 0 (today's policy). Switching an
 * instructor to a non-zero fee is a pure data change.
 *
 * IMPORTANT: `application_fee_amount = 0` is REJECTED by Stripe, so
 * when platformFeeBps is 0 the payment code must OMIT the parameter
 * entirely (see StripeService#buildFeeParams).
 */
@Table({
  tableName: 'stripe_account',
  timestamps: true,
  underscored: true,
})
export class StripeAccount extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare userId: string;

  /**
   * The Stripe-assigned Connect account id. Always starts with `acct_`.
   * Unique per account. Used as the `stripeAccount` option on every
   * Stripe API call we make on this instructor's behalf.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare stripeAccountId: string;

  /**
   * TRUE = instructor can accept charges. Mirrored from Stripe's
   * `charges_enabled` via the account.updated webhook. Until TRUE, we
   * must refuse to create invoices on this account.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare chargesEnabled: boolean;

  /**
   * TRUE = Stripe can send the instructor their money. Independent of
   * chargesEnabled (an account can be temporarily payout-blocked even
   * while still allowed to charge).
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare payoutsEnabled: boolean;

  /**
   * TRUE = instructor completed the hosted Express onboarding form.
   * Doesn't imply chargesEnabled — Stripe may still be verifying.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare detailsSubmitted: boolean;

  @Column({
    type: DataType.STRING(2),
    allowNull: true,
  })
  declare country: string | null;

  @Column({
    type: DataType.STRING(3),
    allowNull: true,
  })
  declare defaultCurrency: string | null;

  /**
   * Platform fee in basis points. 0 = 0%, 100 = 1%. Applied to new
   * charges only — existing invoices are not re-priced when this
   * value changes.
   */
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  declare platformFeeBps: number;

  /**
   * Populated from Stripe when the account is in a blocked state
   * (e.g. 'requirements.past_due'). Displayed to the instructor in
   * their onboarding status UI.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare disabledReason: string | null;

  /**
   * JSONB snapshot of the latest Stripe `requirements.currently_due`
   * array. Surfaced to instructors in plain language so they know
   * what document / field is still missing.
   */
  @Column({
    type: DataType.JSONB,
    allowNull: true,
  })
  declare requirementsCurrentlyDue: string[] | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare onboardingCompletedAt: Date | null;

  /**
   * Set when Stripe fires `account.application.deauthorized`. We do
   * NOT auto-cancel active subscriptions when this happens (they are
   * owned by the platform account, not the connect account) — instead
   * we notify both parties and require manual support resolution.
   */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare disconnectedAt: Date | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => User, 'userId')
  declare user: User;
}
