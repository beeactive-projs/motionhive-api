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
import { AssignedSet } from './assigned-set.entity';
import { PrescribedSet } from './prescribed-set.entity';
import { LoggedExercise } from './logged-exercise.entity';
import { ExerciseSetType, RestSource } from './workout.enums';

/**
 * One actually-performed set. All actual values are nullable —
 * `is_completed = true` with no values is valid (locked decision §11,
 * mark-complete only). Snapshots of the planned values live on the
 * assigned_set; we don't duplicate them here.
 */
@Table({
  tableName: 'logged_set',
  timestamps: true,
  underscored: true,
})
export class LoggedSet extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => LoggedExercise)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare loggedExerciseId: string;

  @ForeignKey(() => AssignedSet)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare assignedSetId: string | null;

  /** Parity with `assignedSetId`, for routine-started sessions. */
  @ForeignKey(() => PrescribedSet)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare prescribedSetId: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare orderIndex: number;

  @Column({
    type: DataType.ENUM(...Object.values(ExerciseSetType)),
    allowNull: false,
    defaultValue: ExerciseSetType.Normal,
  })
  declare setType: ExerciseSetType;

  // ── Actuals (all nullable) ───────────────────────────────────────

  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare reps: number | null;

  @Column({
    type: DataType.DECIMAL(6, 2),
    allowNull: true,
    get(this: LoggedSet): number | null {
      const raw = this.getDataValue('weightKg') as unknown as string | null;
      return raw == null ? null : Number(raw);
    },
  })
  declare weightKg: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare durationSeconds: number | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare distanceMeters: number | null;

  @Column({
    type: DataType.DECIMAL(3, 1),
    allowNull: true,
    get(this: LoggedSet): number | null {
      const raw = this.getDataValue('rpe') as unknown as string | null;
      return raw == null ? null : Number(raw);
    },
  })
  declare rpe: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare rir: number | null;

  /**
   * The rest actually taken after this set, in seconds. Since migration
   * 079 the logger writes what happened, with `restSource` saying how it
   * was measured; on older rows (`restSource` null) it was the planned
   * rest. The planned rest is worked out on read (`plannedRestSeconds`).
   */
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare restAfterSeconds: number | null;

  /** How `restAfterSeconds` was measured; see `RestSource`. */
  @Column({
    type: DataType.ENUM(...Object.values(RestSource)),
    allowNull: true,
  })
  declare restSource: RestSource | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare isCompleted: boolean;

  @Column({ type: DataType.DATE, allowNull: true })
  declare completedAt: Date | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @BelongsTo(() => LoggedExercise)
  declare exercise: LoggedExercise;

  @BelongsTo(() => AssignedSet, 'assignedSetId')
  declare assignedSet: AssignedSet | null;

  /** The routine's set this one was started from; its targets and rest. */
  @BelongsTo(() => PrescribedSet, 'prescribedSetId')
  declare prescribedSet: PrescribedSet | null;
}
