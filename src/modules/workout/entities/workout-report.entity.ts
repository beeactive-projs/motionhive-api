import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import {
  MessageReportCategory,
  MessageReportStatus,
} from '../../messaging/entities/message-report.entity';
import { WorkoutLog } from './workout-log.entity';

/**
 * A report about a workout someone shows on their profile (migration 076).
 * Same categories and statuses as a message report, so staff read one
 * vocabulary across the moderation queues.
 */
@Table({
  tableName: 'workout_report',
  // `@CreatedAt` needs `timestamps: true` to map the column; transitions
  // are tracked by `resolvedAt`, and there is no `updated_at`.
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class WorkoutReport extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare reporterId: string;

  /** Whose workout it is, so the queue can show a repeat pattern. */
  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare ownerId: string;

  @ForeignKey(() => WorkoutLog)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare workoutLogId: string;

  @Column({
    type: DataType.ENUM(...Object.values(MessageReportCategory)),
    allowNull: false,
  })
  declare category: MessageReportCategory;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(MessageReportStatus)),
    allowNull: false,
    defaultValue: MessageReportStatus.OPEN,
  })
  declare status: MessageReportStatus;

  /** Whether resolving this report took the workout down. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare takenDown: boolean;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare resolvedById: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare resolvedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare resolutionNotes: string | null;

  @CreatedAt
  declare createdAt: Date;

  @BelongsTo(() => User, 'reporterId')
  declare reporter: User;

  @BelongsTo(() => User, 'ownerId')
  declare owner: User;

  @BelongsTo(() => WorkoutLog, 'workoutLogId')
  declare workoutLog: WorkoutLog;

  @BelongsTo(() => User, 'resolvedById')
  declare resolvedBy: User | null;
}
