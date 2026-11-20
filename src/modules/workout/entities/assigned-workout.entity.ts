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
import { AssignedExercise } from './assigned-exercise.entity';
import { ProgramAssignment } from './program-assignment.entity';
import { ProgramWorkout } from './program-workout.entity';
import { WorkoutLogStatus } from './workout.enums';

/**
 * One day in a client's assigned program. Field-for-field mirror of
 * ProgramWorkout (snapshot at assign time) + per-assignment overrides:
 * `scheduled_date` (computed start_date + week*7 + day) and `status`
 * (nullable until the client opens it).
 *
 * master_workout_id is informational and ON DELETE SET NULL —
 * deleting the master program doesn't break the assignment.
 */
@Table({
  tableName: 'assigned_workout',
  timestamps: true,
  underscored: true,
})
export class AssignedWorkout extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => ProgramAssignment)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare programAssignmentId: string;

  @ForeignKey(() => ProgramWorkout)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare masterWorkoutId: string | null;

  // ── Mirror of program_workout (snapshot) ──────────────────────────

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare weekIndex: number;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare dayIndex: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sequenceNumber: number;

  @Column({ type: DataType.STRING(50), allowNull: true })
  declare phase: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare estimatedDurationMinutes: number | null;

  // ── Assignment-specific ──────────────────────────────────────────

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare scheduledDate: string | null;

  /** Nullable until the client starts logging it. */
  @Column({
    type: DataType.ENUM(...Object.values(WorkoutLogStatus)),
    allowNull: true,
  })
  declare status: WorkoutLogStatus | null;

  /**
   * When the coach last changed this day of the client's copy: its
   * exercises, their sets or its date (migration 089). Null when never.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare coachChangedAt: Date | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @BelongsTo(() => ProgramAssignment)
  declare assignment: ProgramAssignment;

  @HasMany(() => AssignedExercise)
  declare exercises: AssignedExercise[];
}
