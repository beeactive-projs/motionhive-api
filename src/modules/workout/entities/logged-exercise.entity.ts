import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany,
  CreatedAt,
} from 'sequelize-typescript';
import { Exercise } from '../../exercise/entities/exercise.entity';
import { AssignedExercise } from './assigned-exercise.entity';
import { PrescribedExercise } from './prescribed-exercise.entity';
import { LoggedSet } from './logged-set.entity';
import { WorkoutLog } from './workout-log.entity';

/**
 * Logged exercise — what the client actually performed (one per
 * exercise in the log). Snapshot fields (`exercise_name_snapshot`,
 * `exercise_thumbnail_url_snapshot`) preserve historical legibility
 * if the catalog row is later renamed or deleted (locked decision §15).
 *
 * `exercise_id` is nullable because the catalog row may be soft-deleted
 * later; the snapshot keeps the log readable.
 */
@Table({
  tableName: 'logged_exercise',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class LoggedExercise extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => WorkoutLog)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare workoutLogId: string;

  @ForeignKey(() => Exercise)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare exerciseId: string | null;

  @ForeignKey(() => AssignedExercise)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare assignedExerciseId: string | null;

  /** Parity with `assignedExerciseId`, for routine-started sessions. */
  @ForeignKey(() => PrescribedExercise)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare prescribedExerciseId: string | null;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare exerciseNameSnapshot: string;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare exerciseThumbnailUrlSnapshot: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare orderIndex: number;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare supersetGroupId: number | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  /**
   * Explicit skip. Distinct from untouched (present, no completed sets)
   * and from absent (never added). Excluded from progress counts. Before
   * migration 056 a skip deleted the row, so a coach could not tell a
   * skipped exercise from one that was never there.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isSkipped: boolean;

  /** Set when substituted mid-workout, so the coach sees what changed. */
  @ForeignKey(() => Exercise)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare swappedFromExerciseId: string | null;

  @CreatedAt declare createdAt: Date;

  @BelongsTo(() => WorkoutLog)
  declare log: WorkoutLog;

  @BelongsTo(() => Exercise, 'exerciseId')
  declare exercise: Exercise | null;

  /** The movement this replaced, so a coach sees what actually changed. */
  @BelongsTo(() => Exercise, 'swappedFromExerciseId')
  declare swappedFromExercise: Exercise | null;

  @BelongsTo(() => AssignedExercise, 'assignedExerciseId')
  declare assignedExercise: AssignedExercise | null;

  /** The routine's exercise this one was started from, with its note. */
  @BelongsTo(() => PrescribedExercise, 'prescribedExerciseId')
  declare prescribedExercise: PrescribedExercise | null;

  @HasMany(() => LoggedSet)
  declare sets: LoggedSet[];
}
