import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  BelongsToMany,
} from 'sequelize-typescript';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';

/**
 * Permission Entity
 *
 * Format: resource.action (e.g., user.create, session.read)
 * Already seeded in database
 */
@Table({
  tableName: 'permission',
  timestamps: false, // Only created_at
  paranoid: false,
  underscored: true,
})
export class Permission extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
    unique: true,
  })
  declare name: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare displayName: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  declare resource: string;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  declare action: string;

  @CreatedAt
  declare createdAt: Date;

  // Relationships
  @BelongsToMany(() => Role, () => RolePermission)
  declare roles: Role[];
}
