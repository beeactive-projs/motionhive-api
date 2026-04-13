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
 * StripeCustomer Entity
 *
 * Represents a paying party — either a registered BeeActive user OR
 * an external guest invoiced by email only.
 *
 * `userId` is NULLABLE on purpose. An instructor might do a one-off PT
 * session for a walk-in client who isn't on BeeActive; we can still
 * issue them an invoice by creating a guest row with email + name.
 *
 * Later, if that guest registers on BeeActive with the same email, we
 * link this row to their new user_id (see customer.service.ts —
 * linkGuestToUser — mirrors the existing linkPendingInvitations flow
 * from the invitation module).
 *
 * One row per BeeActive user (NOT one per instructor-client
 * relationship) so that saved cards are reused across every instructor
 * the user works with. To find "does my client have a stripe_customer
 * yet?" from the invoice-create flow:
 *
 *     SELECT * FROM stripe_customer WHERE user_id = :clientUserId
 *
 * Lazy-created: the row only exists once the client is first invoiced
 * or first tries to save a card.
 */
@Table({
  tableName: 'stripe_customer',
  timestamps: true,
  underscored: true,
})
export class StripeCustomer extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  /**
   * Nullable — set only when the customer is a registered BeeActive
   * user. Guests invoiced by email have userId = null until they
   * register with the same email address.
   */
  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare userId: string | null;

  /**
   * Stripe-assigned customer id, starts with `cus_`. Global across
   * BeeActive — NOT scoped to a specific Connect account — so a single
   * saved card can pay multiple instructors. This is possible because
   * the customer lives on the platform account, not on a connected
   * account.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare stripeCustomerId: string;

  /**
   * Always set. For registered users this mirrors user.email at the
   * time of creation; for guests it's whatever the instructor typed.
   * Indexed so the guest→user linking flow can find rows by email.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare email: string;

  /**
   * Display name. For registered users we prefer `user.fullName`; for
   * guests it's the manually-entered name. Sent to Stripe so it
   * appears on the hosted invoice page.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare name: string | null;

  /**
   * Stripe PaymentMethod id of the customer's default card. Mirrored
   * from Stripe and updated by webhooks on `customer.updated`. We
   * read it so the UI can show "Visa •••• 4242" without an API call.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare defaultPaymentMethodId: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => User, 'userId')
  declare user: User | null;
}
