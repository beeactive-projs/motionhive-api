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
import { Invoice } from './invoice.entity';

/**
 * Payment (PaymentIntent outcome) status values.
 *
 * - PENDING            — intent created, awaiting confirmation
 * - SUCCEEDED          — charge completed, money captured
 * - FAILED             — intent failed (e.g. card declined)
 * - REFUNDED           — fully refunded
 * - PARTIALLY_REFUNDED — some amount refunded
 */
export enum PaymentStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}

/**
 * Payment Entity
 *
 * Local mirror of a Stripe PaymentIntent. One invoice can produce
 * multiple payment rows: failed card → retried on another card →
 * succeeded. That's why `payment` is separate from `invoice`.
 *
 * Why we keep this table:
 * - Earnings dashboard aggregates from SUCCEEDED rows.
 * - Refund history comes from this table.
 * - The failure_reason is used to show the client a human-readable
 *   retry message (never the raw Stripe decline code).
 *
 * Race-condition note (important): we ALWAYS create this row BEFORE
 * handing the client a Checkout URL, so that when the `payment_intent.
 * succeeded` webhook arrives it has something to UPDATE. If the row
 * is somehow missing when the webhook arrives, the handler marks the
 * event as `orphaned` in webhook_event and a reconciliation sweep
 * cleans it up later.
 */
@Table({
  tableName: 'payment',
  timestamps: true,
  underscored: true,
})
export class Payment extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Invoice)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare invoiceId: string | null;

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

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare stripePaymentIntentId: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare stripeChargeId: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare amountCents: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  declare amountRefundedCents: number;

  @Column({
    type: DataType.STRING(3),
    allowNull: false,
  })
  declare currency: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  declare applicationFeeCents: number;

  @Column({
    type: DataType.STRING(30),
    allowNull: false,
    validate: { isIn: [Object.values(PaymentStatus)] },
  })
  declare status: PaymentStatus;

  /**
   * e.g. 'card', 'sepa_debit', 'ideal'. Surfaced in the instructor's
   * payment history table.
   */
  @Column({
    type: DataType.STRING(50),
    allowNull: true,
  })
  declare paymentMethodType: string | null;

  /**
   * Stripe failure code (e.g. 'card_declined', 'insufficient_funds').
   * Stored for support-ticket debugging but NEVER shown raw to the
   * client — UI translates to plain Romanian.
   */
  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare failureCode: string | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare failureMessage: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare paidAt: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare refundedAt: Date | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => Invoice, 'invoiceId')
  declare invoice: Invoice | null;

  @BelongsTo(() => User, 'instructorId')
  declare instructor: User;

  @BelongsTo(() => User, 'clientId')
  declare client: User | null;
}
