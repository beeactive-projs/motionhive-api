import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Role } from './role.entity';

/**
 * UserRole Pivot Entity
 *
 * Links users to roles (many-to-many)
 * Supports group-scoped roles
 */
@Table({
  tableName: 'user_role',
  timestamps: false, // Only assigned_at
  paranoid: false,
  underscored: true,
})
export class UserRole extends Model {
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

  @ForeignKey(() => Role)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare roleId: string;

  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  /** Null for a platform role; a group id for a role inside that group. */
  declare groupId: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare assignedAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare expiresAt: Date;

  // Relationships
  @BelongsTo(() => User)
  declare user: User;

  @BelongsTo(() => Role)
  declare role: Role;
}
