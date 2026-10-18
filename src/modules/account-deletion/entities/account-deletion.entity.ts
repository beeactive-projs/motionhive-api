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

/** Keep in sync with the `account_deletion_status` enum (migration 069). */
export enum AccountDeletionStatus {
  /** A code was emailed to the account address; nothing has happened yet. */
  PENDING_CODE = 'PENDING_CODE',
  /** Confirmed: deactivated now, erased at `scheduledFor` unless cancelled. */
  SCHEDULED = 'SCHEDULED',
  /** The person signed in during the cooling-off and kept the account. */
  CANCELLED = 'CANCELLED',
  /** Erased. The row stays as the record that the deletion happened. */
  ERASED = 'ERASED',
}

/**
 * One account deletion, from the emailed code to the erasure.
 *
 * Kept after erasure as the deletion record the published policy promises
 * (3 years). `userId` stays valid throughout: the user row is scrubbed, never
 * hard-deleted (see migration 069).
 */
@Table({
  tableName: 'account_deletion',
  timestamps: true,
  underscored: true,
})
export class AccountDeletion extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare userId: string;

  @BelongsTo(() => User)
  declare user?: User;

  @Column({
    type: DataType.ENUM(...Object.values(AccountDeletionStatus)),
    allowNull: false,
    defaultValue: AccountDeletionStatus.PENDING_CODE,
  })
  declare status: AccountDeletionStatus;

  /** HMAC-SHA256 (hex) of the emailed code, keyed with the app secret; cleared once confirmed. */
  @Column({ type: DataType.STRING(64), allowNull: true })
  declare codeHash: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare codeExpiresAt: Date | null;

  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  declare codeAttempts: number;

  /** When the code was confirmed and the account deactivated. */
  @Column({ type: DataType.DATE, allowNull: true })
  declare requestedAt: Date | null;

  /** When the erasure becomes due. */
  @Column({ type: DataType.DATE, allowNull: true })
  declare scheduledFor: Date | null;

  /**
   * When every wind-down step succeeded. NULL while one still needs a retry
   * (a Stripe outage, say); the daily sweep runs those again.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare woundDownAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare cancelledAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare erasedAt: Date | null;

  /** The person's language, for the emails sent once their account is gone. */
  @Column({ type: DataType.STRING(5), allowNull: true })
  declare locale: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;
}
