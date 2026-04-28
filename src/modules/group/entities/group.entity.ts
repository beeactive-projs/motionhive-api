import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  HasMany,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { GroupMember } from './group-member.entity';
import { User } from '../../user/entities/user.entity';

/**
 * How new members can join the group
 */
export enum JoinPolicy {
  OPEN = 'OPEN', // Anyone can join instantly
  APPROVAL = 'APPROVAL', // User requests, owner approves (future)
  INVITE_ONLY = 'INVITE_ONLY', // Only via invitation link
}

/**
 * Group Entity
 *
 * Represents a training group created by an instructor.
 * An instructor creates a group to organize their sessions and clients.
 *
 * Groups can be public (discoverable) or private (invite-only).
 * Public groups appear in search results and can be joined based on joinPolicy.
 *
 * Soft deletes enabled — groups are never truly removed.
 */
@Table({
  tableName: 'group',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class Group extends Model {
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
    comment: 'The instructor who owns this group',
  })
  declare instructorId: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
    unique: true,
  })
  declare slug: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string | null;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
  })
  declare logoUrl: string | null;

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

  // -- Discovery fields --

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
    comment: 'Whether this group appears in public search results',
  })
  declare isPublic: boolean;

  @Column({
    type: DataType.STRING(20),
    defaultValue: JoinPolicy.INVITE_ONLY,
    comment: 'How new members join: OPEN, APPROVAL, INVITE_ONLY',
  })
  declare joinPolicy: JoinPolicy;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    comment: 'Tags for categorization, e.g. ["fitness","yoga"]',
  })
  declare tags: string[] | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare contactEmail: string | null;

  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  declare contactPhone: string | null;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
  })
  declare address: string | null;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare city: string | null;

  @Column({
    type: DataType.STRING(5),
    allowNull: true,
  })
  declare country: string | null;

  // -- Join link fields --

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
    comment: 'Hashed join token for invite links',
  })
  declare joinToken: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare joinTokenExpiresAt: Date | null;

  // -- Timestamps --

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date | null;

  // -- Relationships --

  @BelongsTo(() => User, 'instructorId')
  declare instructor: User;

  @HasMany(() => GroupMember)
  declare members: GroupMember[];
}
