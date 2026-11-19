import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Role } from '../../role/entities/role.entity';
import { Group } from '../../group/entities/group.entity';

/**
 * Invitation Entity
 *
 * Represents an invitation to join a group.
 * The inviter sends a token (via link/email), the invitee uses it to join.
 *
 * Token is stored as plain text (single-use, expires in 7 days).
 * Unlike password reset tokens, invitation tokens don't need hashing
 * because they don't grant access to existing accounts.
 */
@Table({
  tableName: 'invitation',
  timestamps: false,
  underscored: true,
})
export class Invitation extends Model {
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
  declare inviterId: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare email: string;

  /**
   * The account an in-app invitation was made for (migration 086), which
   * answers it in the app without a verified email. Null for an invitation
   * sent by email: its link proves the address.
   */
  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare inviteeId: string | null;

  @ForeignKey(() => Role)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare roleId: string;

  @ForeignKey(() => Group)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare groupId: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    unique: true,
  })
  declare token: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare message: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare expiresAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare acceptedAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare declinedAt: Date;

  // A plain column, not `@CreatedAt`: with `timestamps: false` that
  // decorator mapped nothing, so ordering by it asked for a "createdAt"
  // column the table does not have.
  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare createdAt: Date;

  // Relationships
  @BelongsTo(() => User, 'inviterId')
  declare inviter: User;

  @BelongsTo(() => Role)
  declare role: Role;

  @BelongsTo(() => Group)
  declare group: Group;
}
