import type { ShareTargetType } from '../../share/share.types';
import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  ForeignKey,
  BelongsTo,
  HasMany,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { ConversationParticipant } from './conversation-participant.entity';
import { Message } from './message.entity';

/**
 * Whether the conversation is a DM or a group thread.
 *
 * v1 only writes DIRECT. GROUP rows are accepted by the schema but no
 * endpoint creates them yet (see docs/plans/messaging-backend-plan.md).
 */
export enum ConversationType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
}

@Table({
  tableName: 'conversation',
  timestamps: true,
  underscored: true,
})
export class Conversation extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.ENUM(...Object.values(ConversationType)),
    allowNull: false,
  })
  declare type: ConversationType;

  @Column({
    type: DataType.STRING(120),
    allowNull: true,
  })
  declare name: string | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare avatarUrl: string | null;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare createdById: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare lastMessageAt: Date | null;

  @Column({
    type: DataType.STRING(200),
    allowNull: true,
  })
  declare lastMessagePreview: string | null;

  /**
   * The type of the thing the last message shared, if it shared one
   * (migration 092), so the chat list can say "Session · ..." per reader.
   */
  @Column({
    type: DataType.STRING(24),
    allowNull: true,
  })
  declare lastMessageAttachmentType: ShareTargetType | null;

  /**
   * sha256(sorted(participantA:participantB)) for DIRECT conversations.
   * Backed by a partial UNIQUE index (migration 039) so two concurrent
   * first-sends from opposite sides cannot create duplicate rows.
   * NULL for GROUP conversations and legacy DIRECT rows pre-039.
   */
  @Column({
    type: DataType.CHAR(64),
    allowNull: true,
  })
  declare directKey: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => User, 'createdById')
  declare createdBy: User | null;

  @HasMany(() => ConversationParticipant)
  declare participants: ConversationParticipant[];

  @HasMany(() => Message)
  declare messages: Message[];
}
