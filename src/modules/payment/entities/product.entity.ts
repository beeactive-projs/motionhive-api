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
 * Product types an instructor can sell.
 *
 * - ONE_OFF: single-purchase item (e.g. "Single PT Session", "10-pack")
 * - SUBSCRIPTION: recurring billing (e.g. "Monthly Coaching")
 */
export enum ProductType {
  ONE_OFF = 'ONE_OFF',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

/**
 * Subscription interval units. Only used when type = SUBSCRIPTION.
 * Maps 1:1 with Stripe's price.recurring.interval values.
 */
export enum ProductInterval {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

/**
 * Product Entity
 *
 * An instructor's reusable price list item. Each product maps to a
 * Stripe Product + Price pair.
 *
 * Why a local mirror?
 * - So the instructor dashboard can list products without calling
 *   Stripe on every render.
 * - So we can filter/search/paginate with SQL.
 * - So we can soft-deactivate a product (`isActive = false`) without
 *   deleting the Stripe Product (which would break historical
 *   invoices that reference it).
 *
 * Money is stored in the SMALLEST CURRENCY UNIT:
 *   €10.50  →  amountCents = 1050, currency = 'EUR'
 *   50 RON  →  amountCents = 5000, currency = 'RON'
 */
@Table({
  tableName: 'product',
  timestamps: true,
  underscored: true,
})
export class Product extends Model {
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

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string | null;

  /**
   * ONE_OFF or SUBSCRIPTION. Determines whether this product can be
   * attached to an Invoice (ONE_OFF) or a Subscription (SUBSCRIPTION).
   */
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    validate: { isIn: [Object.values(ProductType)] },
  })
  declare type: ProductType;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare amountCents: number;

  /**
   * ISO-4217 3-letter code. BeeActive v1 locks RON by default; EUR
   * requires an explicit per-instructor opt-in flag (Stripe applies
   * a 2% FX fee on top of processing for cross-currency settlement).
   */
  @Column({
    type: DataType.STRING(3),
    allowNull: false,
    defaultValue: 'RON',
  })
  declare currency: string;

  /**
   * SUBSCRIPTION only — the billing cadence unit.
   */
  @Column({
    type: DataType.STRING(10),
    allowNull: true,
    validate: { isIn: [[...Object.values(ProductInterval), null]] },
  })
  declare interval: ProductInterval | null;

  /**
   * SUBSCRIPTION only — e.g. interval=month + intervalCount=2 means
   * "bill every 2 months". NULL for ONE_OFF products.
   */
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare intervalCount: number | null;

  /**
   * Stripe Product id (`prod_...`). Created when the BeeActive product
   * is first saved. Reused on subsequent invoices/subscriptions.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare stripeProductId: string | null;

  /**
   * Stripe Price id (`price_...`). Prices in Stripe are immutable —
   * editing amount/currency on our side creates a new Stripe Price
   * and updates this column; the old Price lingers for historical
   * invoices and is archived (not deleted) in Stripe.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare stripePriceId: string | null;

  /**
   * Soft-deactivation flag. Hidden from the invoice-create picker but
   * kept around so historical invoices can still resolve the product.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
  declare isActive: boolean;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => User, 'instructorId')
  declare instructor: User;
}
