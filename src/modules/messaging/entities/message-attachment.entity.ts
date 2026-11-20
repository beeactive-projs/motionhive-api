import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import type { ShareTargetType } from '../../share/share.types';
import { Message } from './message.entity';

/**
 * A public thing a message carries as a card (migration 092): its type and
 * id only. The card is drawn from the live row each time it is read
 * (`ShareService.cardsFor`), so nothing about the thing is copied here.
 */
@Table({
  tableName: 'message_attachment',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class MessageAttachment extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Message)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare messageId: string;

  @Column({ type: DataType.STRING(24), allowNull: false })
  declare targetType: ShareTargetType;

  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare targetId: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  declare position: number;

  @CreatedAt
  declare createdAt: Date;

  @BelongsTo(() => Message)
  declare message: Message;
}
