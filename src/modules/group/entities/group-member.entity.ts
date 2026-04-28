import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Group } from './group.entity';
import { User } from '../../user/entities/user.entity';

/**
 * Membership role within a single group.
 *
 * - MEMBER: regular participant
 * - MODERATOR: trusted member with elevated permissions (kick, pin, etc.)
 *   — reserved; UI/permission wiring lands when the feature ships
 * - OWNER: at most one per group (enforced by partial unique index in
 *   migration 031). The original instructor when the group is created.
 */
export enum GroupMemberRole {
  MEMBER = 'MEMBER',
  MODERATOR = 'MODERATOR',
  OWNER = 'OWNER',
}

/**
 * Group Member Entity
 *
 * Links users to groups.
 * Tracks role (member / moderator / owner), health-data sharing consent,
 * and membership dates.
 *
 * `isOwner` is exposed as a virtual getter (read `role === 'OWNER'`) so
 * existing API responses keep their shape during the FE migration window.
 * The DB column `is_owner` is GENERATED ALWAYS from `role` (see migration
 * 031) and will be dropped once the FE has switched to `role`.
 */
@Table({
  tableName: 'group_member',
  timestamps: false,
  underscored: true,
})
export class GroupMember extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Group)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare groupId: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare userId: string;

  @Column({
    type: DataType.ENUM(...Object.values(GroupMemberRole)),
    allowNull: false,
    defaultValue: GroupMemberRole.MEMBER,
  })
  declare role: GroupMemberRole;

  /**
   * Read-only convenience: `role === 'OWNER'`. Kept so existing callers
   * (and FE response payloads) continue to work; will be removed once
   * the FE migrates to reading `role` directly.
   */
  get isOwner(): boolean {
    return this.role === GroupMemberRole.OWNER;
  }

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare sharedHealthInfo: boolean;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare nickname: string | null;

  @Column({
    type: DataType.DATE,
    defaultValue: DataType.NOW,
  })
  declare joinedAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare leftAt: Date | null;

  // -- Relationships --

  @BelongsTo(() => Group)
  declare group: Group;

  @BelongsTo(() => User)
  declare user: User;
}
