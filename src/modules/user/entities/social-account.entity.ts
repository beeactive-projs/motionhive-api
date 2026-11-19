import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from './user.entity';

export type SocialProvider = 'GOOGLE' | 'FACEBOOK' | 'APPLE';

/**
 * SocialAccount Entity
 *
 * Links a user to an OAuth provider (Google, Facebook, Apple).
 * Maps to the 'social_account' table.
 * One user can have multiple social accounts (e.g. Google + Facebook).
 */
@Table({
  tableName: 'social_account',
  timestamps: true,
  underscored: true,
})
export class SocialAccount extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare userId: string;

  @Column({
    type: DataType.ENUM('GOOGLE', 'FACEBOOK', 'APPLE'),
    allowNull: false,
  })
  declare provider: SocialProvider;

  @Column({ type: DataType.STRING(255), allowNull: false })
  declare providerUserId: string;

  @Column({ type: DataType.STRING(255), allowNull: true })
  declare providerEmail: string | null;

  /**
   * Apple only (migration 085): the newest Sign in with Apple refresh token,
   * encrypted with `CryptoService.encrypt`. It is what revokes the grant
   * when the account is deleted; cleared once revoked. Never exported.
   */
  @Column({ type: DataType.TEXT, allowNull: true })
  declare refreshTokenEnc: string | null;

  /** Apple only: the client id the refresh token belongs to (bundle id or Services ID). */
  @Column({ type: DataType.STRING(255), allowNull: true })
  declare tokenClientId: string | null;

  /** Apple only: `providerEmail` is a Hide My Email relay address. */
  @Column({ type: DataType.BOOLEAN, allowNull: true })
  declare isPrivateEmail: boolean | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => User)
  declare user: User;
}
