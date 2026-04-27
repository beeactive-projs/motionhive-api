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

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => User)
  declare user: User;
}
