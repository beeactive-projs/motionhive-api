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
import { Product } from './product.entity';

/**
 * Stripe subscription status values — mapped 1:1 from
 * `Stripe.Subscription.Status`. Stored as VARCHAR in the DB and
 * validated at the application layer (matches project convention).
 *
 * Lifecycle summary:
 *   trialing           → active client in trial period
 *   active             → paying normally
 *   past_due           → most recent renewal failed, Smart Retries in progress
 *   unpaid             → retries exhausted, no access
 *   canceled           → ended (by client or instructor)
 *   incomplete         → first invoice never paid
 *   incomplete_expired → first invoice expired unpaid, sub voided
 *   paused             → manually paused (we don't use this in v1)
 *   incomplete_payment_failed → additional Stripe state
 */
export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
  CANCELED = 'canceled',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired',
  PAUSED = 'paused',
  INCOMPLETE_PAYMENT_FAILED = 'incomplete_payment_failed',
}

/**
 * Subscription Entity
 *
 * Local mirror of a Stripe Subscription. Webhook-driven — we never
 * poll Stripe to refresh these rows.
 *
 * Relationships:
 * - instructorId: who is getting paid
 * - clientId: who is paying (NULL for guest)
 * - productId: the BeeActive product template (NULL allowed for legacy
 *   subs created outside our product catalog)
 *
 * Proration policy (v1): `proration_behavior = 'none'` — price
 * changes take effect at the next billing cycle only, no partial
 * charges or credits. This is the simplest-to-explain policy for
 * non-technical instructors.
 *
 * Cancel default: `cancel_at_period_end = true`. Immediate cancellation
 * is an explicit override (admin or instructor UI toggle).
 */
@Table({
  tableName: 'subscription',
  timestamps: true,
  underscored: true,
})
export class Subscription extends Model {
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
  declare instructorId: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare clientId: string | null;

  /**
   * Stripe customer id of the paying party. Kept denormalized because
   * subscriptions are sometimes created before we have a client_id
   * (e.g. guest registering into the subscription after the fact).
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare stripeCustomerId: string;

  @ForeignKey(() => Product)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare productId: string | null;

  /**
   * Nullable on insert: the local row is created BEFORE the Stripe
   * `subscriptions.create` call so the Stripe network round-trip happens
   * outside any open DB transaction and so the local id can be used as
   * an idempotency key. Backfilled with the real Stripe id once the
   * call returns. Mirrors invoice.stripe_invoice_id (migration 024).
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare stripeSubscriptionId: string | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare stripePriceId: string;

  // VARCHAR + app-level enum validation — see webhook-event.entity.ts.
  @Column({
    type: DataType.STRING(30),
    allowNull: false,
    validate: { isIn: [Object.values(SubscriptionStatus)] },
  })
  declare status: SubscriptionStatus;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare currentPeriodStart: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare currentPeriodEnd: Date | null;

  /**
   * Scheduled future cancellation — when `cancelAtPeriodEnd` is TRUE,
   * this equals currentPeriodEnd.
   */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare cancelAt: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare canceledAt: Date | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare cancelAtPeriodEnd: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare trialStart: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare trialEnd: Date | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare amountCents: number;

  @Column({
    type: DataType.STRING(3),
    allowNull: false,
  })
  declare currency: string;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => User, 'instructorId')
  declare instructor: User;

  @BelongsTo(() => User, 'clientId')
  declare client: User | null;

  @BelongsTo(() => Product, 'productId')
  declare product: Product | null;

  /**
   * Public response shape — strips Stripe-only ids from the serialized
   * payload so the FE can't accidentally call Stripe directly with our
   * customer / subscription / price ids. Kept on the entity itself so
   * every serialization path (NestJS interceptor, manual JSON.stringify,
   * test assertions) gets the filtered shape.
   *
   * Internal service code should still use the typed accessors
   * (`sub.stripeSubscriptionId`) — those work on the in-memory instance
   * regardless of what `toJSON` outputs.
   */
  toJSON(): Record<string, unknown> {
    const raw = super.toJSON();
    delete raw.stripeCustomerId;
    delete raw.stripeSubscriptionId;
    delete raw.stripePriceId;
    return raw;
  }
}
