import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  BelongsToMany,
} from 'sequelize-typescript';
import { Permission } from './permission.entity';
import { RolePermission } from './role-permission.entity';
import { User } from '../../user/entities/user.entity';
import { UserRole } from './user-role.entity';

/**
 * Role Entity
 *
 * System roles: SUPER_ADMIN, ADMIN, SUPPORT, INSTRUCTOR, USER
 * Already seeded in database
 */
@Table({
  tableName: 'role',
  timestamps: true,
  paranoid: false,
  underscored: true,
})
export class Role extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(50),
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
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 10,
  })
  declare level: number;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isSystemRole: boolean;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  // Relationships
  @BelongsToMany(() => Permission, () => RolePermission)
  declare permissions: Permission[];

  @BelongsToMany(() => User, () => UserRole)
  declare users: User[];
}
