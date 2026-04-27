import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Group } from '../../group/entities/group.entity';
import { SessionParticipant } from './session-participant.entity';

/**
 * Shape of the `recurringRule` JSON column for recurring sessions.
 * Co-located with the entity so consumers (service, DTOs) import one
 * canonical type rather than redefining locally.
 */
export interface RecurringRule {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval?: number;
  daysOfWeek?: number[];
  endDate?: string;
  endAfterOccurrences?: number;
}

/**
 * Session Entity
 *
 * Represents a training session (class, workshop, one-on-one).
 * Created by an instructor, optionally linked to a group.
 *
 * Visibility controls who can see the session:
 * - PUBLIC: Anyone can view
 * - GROUP: Must be a member of session.groupId
 * - CLIENTS: Must be a client of session.instructorId
 * - PRIVATE: Only the instructor can view
 */
@Table({
  tableName: 'session',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class Session extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Group)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare groupId: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare instructorId: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string;

  @Column({
    type: DataType.ENUM('ONE_ON_ONE', 'GROUP', 'ONLINE', 'WORKSHOP'),
    allowNull: false,
  })
  declare sessionType: string;

  @Column({
    type: DataType.ENUM('PUBLIC', 'GROUP', 'CLIENTS', 'PRIVATE'),
    defaultValue: 'GROUP',
  })
  declare visibility: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare scheduledAt: Date;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare durationMinutes: number;

  @Column({
    type: DataType.STRING(255),
    allowNull: true,
  })
  declare location: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare maxParticipants: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: true,
  })
  declare price: number;

  @Column({
    type: DataType.STRING(3),
    defaultValue: 'RON',
  })
  declare currency: string;

  @Column({
    type: DataType.ENUM(
      'DRAFT',
      'SCHEDULED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ),
    defaultValue: 'SCHEDULED',
  })
  declare status: string;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare isRecurring: boolean;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
  })
  declare recurringRule: RecurringRule | null;

  @Column({
    type: DataType.BOOLEAN,
    defaultValue: false,
  })
  declare reminderSent: boolean;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date;

  // Relationships
  @BelongsTo(() => User, 'instructorId')
  declare instructor: User;

  @BelongsTo(() => Group)
  declare group: Group;

  @HasMany(() => SessionParticipant)
  declare participants: SessionParticipant[];
}
