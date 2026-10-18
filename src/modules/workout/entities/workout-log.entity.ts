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
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { AssignedWorkout } from './assigned-workout.entity';
import { Program } from './program.entity';
import { LoggedExercise } from './logged-exercise.entity';
import { ProgramAssignment } from './program-assignment.entity';
import { WorkoutLogStatus } from './workout.enums';

/**
 * One workout the client actually performed. Linked optionally to an
 * assignment (assigned + freestyle workouts share this table). When
 * tied to an assignment, the log service flips `assigned_workout.status`
 * to mirror progress.
 */
@Table({
  tableName: 'workout_log',
  timestamps: true,
  underscored: true,
})
export class WorkoutLog extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare userId: string;

  @ForeignKey(() => ProgramAssignment)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare programAssignmentId: string | null;

  @ForeignKey(() => AssignedWorkout)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare assignedWorkoutId: string | null;

  /**
   * The routine this session was started from, when it did not come
   * through an assignment. Without it a routine-started log was
   * indistinguishable from a freestyle one and linked back to nothing.
   */
  @ForeignKey(() => Program)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare sourceProgramId: string | null;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @Column({
    type: DataType.ENUM(...Object.values(WorkoutLogStatus)),
    allowNull: false,
    defaultValue: WorkoutLogStatus.InProgress,
  })
  declare status: WorkoutLogStatus;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare startedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare completedAt: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare durationSeconds: number | null;

  /** When the current pause began; null while the clock is running. */
  @Column({ type: DataType.DATE, allowNull: true })
  declare pausedAt: Date | null;

  /**
   * Every finished pause, summed. The duration and the live clock both
   * subtract it, so time spent away is not counted as training.
   */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare pausedSeconds: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  /** 1–5 emoji-style feeling score. */
  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare feelingRating: number | null;

  // Future-export hooks
  @Column({ type: DataType.STRING(50), allowNull: true })
  declare hkActivityType: string | null;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare healthConnectExerciseType: string | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @BelongsTo(() => User, 'userId')
  declare user: User;

  @BelongsTo(() => ProgramAssignment, 'programAssignmentId')
  declare assignment: ProgramAssignment | null;

  @BelongsTo(() => AssignedWorkout, 'assignedWorkoutId')
  declare assignedWorkout: AssignedWorkout | null;

  /** The routine this came from, so history can name it and link there. */
  @BelongsTo(() => Program, 'sourceProgramId')
  declare sourceProgram: Program | null;

  @HasMany(() => LoggedExercise)
  declare exercises: LoggedExercise[];
}
