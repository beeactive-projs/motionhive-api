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
import { Exercise } from '../../exercise/entities/exercise.entity';
import { AssignedSet } from './assigned-set.entity';
import { AssignedWorkout } from './assigned-workout.entity';
import { PrescribedExercise } from './prescribed-exercise.entity';

/**
 * One exercise slot inside an assigned workout — the client's
 * authoritative copy of a `prescribed_exercise` (locked decision §10,
 * copy-on-assign). Per-client swaps and notes live here without
 * touching the master program.
 *
 * `is_modified_from_master` is set when the coach changes, replaces or
 * adds this exercise in the client's copy (`AssignmentCopyService`), and
 * cleared by "Back to the program's values". An added exercise has no
 * `master_exercise_id`; a replaced one has a different `exercise_id` from
 * the program row it links to.
 */
@Table({
  tableName: 'assigned_exercise',
  timestamps: true,
  underscored: true,
})
export class AssignedExercise extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => AssignedWorkout)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare assignedWorkoutId: string;

  @ForeignKey(() => Exercise)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare exerciseId: string;

  @ForeignKey(() => PrescribedExercise)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare masterExerciseId: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare supersetGroupId: number | null;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare orderIndex: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  @ForeignKey(() => Exercise)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare alternateExerciseId: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare isModifiedFromMaster: boolean;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @BelongsTo(() => AssignedWorkout)
  declare workout: AssignedWorkout;

  @BelongsTo(() => Exercise, 'exerciseId')
  declare exercise: Exercise;

  @BelongsTo(() => Exercise, 'alternateExerciseId')
  declare alternateExercise: Exercise | null;

  @HasMany(() => AssignedSet)
  declare sets: AssignedSet[];
}
