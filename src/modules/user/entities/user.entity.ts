import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  BelongsToMany,
  HasMany,
} from 'sequelize-typescript';
import { Role } from '../../role/entities/role.entity';
import { UserRole } from '../../role/entities/user-role.entity';
import { SocialAccount } from './social-account.entity';

/**
 * User Entity
 *
 * Represents a user in the system.
 * Maps to the 'user' table in PostgreSQL database.
 *
 * Sequelize decorators:
 * - @Table() → Configure table settings
 * - @Column() → Define database column
 * - @BelongsToMany() → Define relationship with other tables
 *
 * Settings:
 * - paranoid: true → Soft deletes (sets deleted_at instead of removing row)
 * - timestamps: true → Auto-manage created_at, updated_at
 * - underscored: true → Use snake_case in DB (firstName → first_name)
 */
@Table({
  tableName: 'user',
  paranoid: true, // Soft deletes - users are never truly deleted
  timestamps: true, // Automatically manage created_at, updated_at
  underscored: true, // Convert camelCase to snake_case for DB columns
})
export class User extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  // ✅ SECURITY FIX: Email is now required (allowNull: false)
  @Column({
    type: DataType.STRING(255),
    unique: true,
    allowNull: false, // Email is required for authentication
  })
  declare email: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare passwordHash: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare firstName: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare lastName: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  declare phone: string;

  @Column({
    type: DataType.SMALLINT,
    defaultValue: 1,
  })
  declare avatarId: number;

  @Column({
    type: DataType.STRING(5),
    defaultValue: 'en',
  })
  declare language: string;

  @Column({
    type: DataType.STRING(50),
    defaultValue: 'Europe/Bucharest',
  })
  declare timezone: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: true,
  })
  declare isActive: boolean;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare isEmailVerified: boolean;

  // ✅ SECURITY FIX: Tokens are now hashed (stores SHA-256 hash, not plain token)
  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare emailVerificationToken: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare emailVerificationExpires: Date | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare passwordResetToken: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare passwordResetExpires: Date | null;

  // ✅ SECURITY FEATURE: Account lockout after failed login attempts
  @Column({
    type: DataType.INTEGER,
    defaultValue: 0,
  })
  declare failedLoginAttempts: number;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare lockedUntil: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare passwordChangedAt: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare lastLoginAt: Date;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date;

  // Relationships
  @BelongsToMany(() => Role, () => UserRole)
  declare roles: Role[];

  @HasMany(() => SocialAccount)
  declare socialAccounts: SocialAccount[];
}
