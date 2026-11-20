import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Conversation } from './conversation.entity';

/**
 * Per-conversation role. v1 DMs never read this field; group v2 enforces
 * it for rename / add / remove operations.
 */
export enum ConversationParticipantRole {
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
}

@Table({
  tableName: 'conversation_participant',
  timestamps: false,
  underscored: true,
})
export class ConversationParticipant extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Conversation)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare conversationId: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare userId: string;

  @Column({
    type: DataType.ENUM(...Object.values(ConversationParticipantRole)),
    allowNull: false,
    defaultValue: ConversationParticipantRole.MEMBER,
  })
  declare role: ConversationParticipantRole;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare lastReadAt: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare mutedUntil: Date | null;

  /**
   * The reader asked to come back to this thread ("Mark as unread").
   * Independent of `lastReadAt`; mark-read clears it.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare markedUnread: boolean;

  /**
   * The participant deleted the chat for themselves ("Delete chat").
   * Messages at or before it are hidden from them and never unread; the
   * other participant is unaffected.
   */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare clearedAt: Date | null;

  /**
   * When this person took the chat in. Null = it is a message request
   * waiting for them (migration 090). Sending in a chat accepts it.
   */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare acceptedAt: Date | null;

  /**
   * When the request to this person started, set once on its first
   * message. The sender's waiting limit counts their messages from here.
   */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare requestAt: Date | null;

  /** This person deleted the request. Nothing tells the sender. */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare declinedAt: Date | null;

  /**
   * This person archived the chat: out of their list and quiet, and it
   * stays archived when messages arrive. Writing in it brings it back.
   */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare archivedAt: Date | null;

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

  @BelongsTo(() => Conversation)
  declare conversation: Conversation;

  @BelongsTo(() => User)
  declare user: User;
}
