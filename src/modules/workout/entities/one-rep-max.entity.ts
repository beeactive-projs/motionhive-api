import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
} from 'sequelize-typescript';
import { Exercise } from '../../exercise/entities/exercise.entity';
import { User } from '../../user/entities/user.entity';
import { WorkoutLog } from './workout-log.entity';
import { OneRepMaxSource } from './workout.enums';

/**
 * One-rep-max history per (user, exercise). Used by the log service
 * to resolve `target_weight_percent_1rm` to an absolute weight when
 * the client starts a workout (locked decision §15).
 *
 * Source values:
 *   - TESTED            — the client actually performed a 1RM lift
 *   - ESTIMATED_EPLEY   — derived from a heavy logged set via Epley
 *   - ESTIMATED_BRZYCKI — alt formula
 *   - MANUAL            — user-entered self-report
 *
 * Latest row (by `recorded_at`) is the one the resolver uses.
 */
@Table({
  tableName: 'one_rep_max',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class OneRepMax extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare userId: string;

  @ForeignKey(() => Exercise)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare exerciseId: string;

  @Column({
    type: DataType.DECIMAL(6, 2),
    allowNull: false,
    get(this: OneRepMax): number {
      const raw = this.getDataValue('weightKg') as unknown as string;
      return Number(raw);
    },
  })
  declare weightKg: number;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
  })
  declare source: OneRepMaxSource;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  declare recordedAt: Date;

  /**
   * The finished workout an estimated record came from (migration 079),
   * so deleting the workout deletes its records (ON DELETE CASCADE).
   * Null for a tested or typed-in one-rep max.
   */
  @ForeignKey(() => WorkoutLog)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare workoutLogId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @CreatedAt declare createdAt: Date;

  @BelongsTo(() => User, 'userId')
  declare user: User;

  @BelongsTo(() => Exercise, 'exerciseId')
  declare exercise: Exercise;
}
