import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';

/**
 * Client Request Type
 *
 * - CLIENT_TO_INSTRUCTOR: A user wants to become a client of an instructor
 * - INSTRUCTOR_TO_CLIENT: An instructor invites a user to become their client
 */
export enum ClientRequestType {
  CLIENT_TO_INSTRUCTOR = 'CLIENT_TO_INSTRUCTOR',
  INSTRUCTOR_TO_CLIENT = 'INSTRUCTOR_TO_CLIENT',
}

/**
 * Client Request Status
 *
 * - PENDING: Waiting for the recipient to respond
 * - ACCEPTED: Recipient accepted the request
 * - DECLINED: Recipient declined the request
 * - CANCELLED: Sender cancelled their own request
 */
export enum ClientRequestStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  CANCELLED = 'CANCELLED',
}

/**
 * Client Request Entity
 *
 * Tracks the request/invitation flow for establishing an instructor-client
 * relationship. Either party can initiate:
 * - Instructor invites a user (INSTRUCTOR_TO_CLIENT)
 * - User requests to become a client (CLIENT_TO_INSTRUCTOR)
 *
 * Requests expire after 30 days if not responded to.
 */
@Table({
  tableName: 'client_request',
  timestamps: true,
  underscored: true,
})
export class ClientRequest extends Model {
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
  declare fromUserId: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare toUserId: string | null;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare invitedEmail: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ClientRequestType)),
    allowNull: false,
  })
  declare type: ClientRequestType;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare message: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ClientRequestStatus)),
    allowNull: false,
    defaultValue: ClientRequestStatus.PENDING,
  })
  declare status: ClientRequestStatus;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare token: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare expiresAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare respondedAt: Date | null;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare createdAt: Date;

  @UpdatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare updatedAt: Date;

  // Relationships
  @BelongsTo(() => User, 'fromUserId')
  declare fromUser: User;

  @BelongsTo(() => User, 'toUserId')
  declare toUser: User;
}
