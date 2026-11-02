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
import type { ContentTranslations } from '../../../common/i18n';
import { ExerciseBlock } from './exercise-block.entity';
import { PrescribedExercise } from './prescribed-exercise.entity';
import { Program } from './program.entity';

/**
 * One "day" within a program. The (week_index, day_index) pair
 * uniquely positions the workout in the program calendar; UNIQUE
 * partial index in migration 047 enforces this. `sequence_number` is
 * a 0-based linear position across the whole program (used to compute
 * `assigned_workout.scheduled_date = assignment.start_date + day`).
 */
@Table({
  tableName: 'program_workout',
  timestamps: true,
  underscored: true,
})
export class ProgramWorkout extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Program)
  @Column({ type: DataType.CHAR(36), allowNull: false })
  declare programId: string;

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

  /** Free-text periodization marker — 'deload', 'accumulation', etc. */
  @Column({ type: DataType.STRING(50), allowNull: true })
  declare phase: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  declare estimatedDurationMinutes: number | null;

  /**
   * A coach's rest for this day, in seconds (0 to 600, migration 079).
   * Between a set's own rest and the program's default.
   */
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare defaultRestSeconds: number | null;

  /**
   * Other languages of name, notes, on MotionHive's own rows only
   * (migration 063). Swapped in per reader by ContentLocaleInterceptor;
   * never accepted from a request.
   */
  @Column({ type: DataType.JSONB, allowNull: true })
  declare translations: ContentTranslations | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @BelongsTo(() => Program)
  declare program: Program;

  @HasMany(() => ExerciseBlock)
  declare blocks: ExerciseBlock[];

  @HasMany(() => PrescribedExercise)
  declare exercises: PrescribedExercise[];
}
