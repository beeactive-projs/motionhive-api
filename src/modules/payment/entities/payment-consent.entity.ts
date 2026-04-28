import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Invoice } from './invoice.entity';
import { Subscription } from './subscription.entity';

/**
 * Consent types. Extend this enum if new consent flavors are needed
 * (e.g. recurring subscription consent, marketing opt-in).
 */
export enum ConsentType {
  /**
   * 14-day cooling-off waiver (Romanian OUG 34/2014, implementing EU
   * Directive 2011/83/EU). Required when a digital service begins
   * immediately on payment.
   */
  IMMEDIATE_ACCESS_WAIVER = 'IMMEDIATE_ACCESS_WAIVER',
}

/**
 * PaymentConsent Entity
 *
 * Legal audit log for consumer-rights consents given at checkout.
 * Rows are NEVER deleted — not even under GDPR erasure requests —
 * because Romanian fiscal law + EU Consumer Rights Directive require
 * a provable 5-year retention window (GDPR Art. 6(1)(c) /
 * Art. 17(3)(b) — "legal obligation" override).
 *
 * What we capture (and why):
 *   - consentType   → which rule this satisfies
 *   - consentText   → the EXACT text the user saw. If we change the
 *                     wording later, prior consents still reference
 *                     the words that were actually shown at the time.
 *   - ipAddress     → evidence of who ticked the box
 *   - userAgent     → further device-level evidence
 *   - givenAt       → when it happened (immutable)
 *
 * This table has NO updated_at — consent is immutable by design.
 */
@Table({
  tableName: 'payment_consent',
  timestamps: false,
  underscored: true,
})
export class PaymentConsent extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  /**
   * Either invoiceId OR subscriptionId must be set (XOR — enforced by
   * `payment_consent_target_xor` CHECK in migration 032). One row =
   * one consent for one billable artefact.
   */
  @ForeignKey(() => Invoice)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare invoiceId: string | null;

  /**
   * Subscription-level waiver. Set when the consent is given at
   * subscription create time (no invoice exists yet). XOR with
   * invoiceId — see CHECK above.
   */
  @ForeignKey(() => Subscription)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare subscriptionId: string | null;

  /**
   * Nullable — a guest checking out without an account has no userId,
   * but we still log their ip + user_agent + email (via the invoice).
   */
  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare userId: string | null;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
    validate: { isIn: [Object.values(ConsentType)] },
  })
  declare consentType: ConsentType;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare consentText: string;

  /**
   * IPv4 or IPv6. VARCHAR(45) covers both.
   */
  @Column({
    type: DataType.STRING(45),
    allowNull: true,
  })
  declare ipAddress: string | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare userAgent: string | null;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
    field: 'given_at',
  })
  declare givenAt: Date;

  // Relationships
  @BelongsTo(() => Invoice, 'invoiceId')
  declare invoice: Invoice | null;

  @BelongsTo(() => Subscription, 'subscriptionId')
  declare subscription: Subscription | null;

  @BelongsTo(() => User, 'userId')
  declare user: User | null;
}
