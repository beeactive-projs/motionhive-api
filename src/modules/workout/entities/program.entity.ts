import { ExerciseLevel } from '../../exercise/entities/exercise.enums';
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
import type { ContentTranslations } from '../../../common/i18n';
import { User } from '../../user/entities/user.entity';
import { ProgramWorkout } from './program-workout.entity';
import { ProgramKind, ProgramSource, ProgramStatus } from './workout.enums';

/**
 * Program — the one plan model, with two kinds of author. A coach's
 * multi-week program and a solo user's single-workout routine are the
 * same tree; `source` and `isSingleWorkout` tell them apart. Migration
 * 056 collapsed the old `routine` table into this one.
 *
 * Still a private library per owner (locked decision §3 — no
 * marketplace). `kind` reserves MEAL / HABIT / HYBRID; V1 ships WORKOUT.
 *
 * Assignment is a separate flow: see ProgramAssignment + the deep-copy
 * transaction (locked decision §10, copy-on-assign). Starting a program
 * ad hoc does not require an assignment.
 */
@Table({
  tableName: 'program',
  timestamps: true,
  underscored: true,
  paranoid: true,
})
export class Program extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  /** Null only for SYSTEM starter routines. */
  @ForeignKey(() => User)
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare ownerId: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ProgramSource)),
    allowNull: false,
    defaultValue: ProgramSource.Instructor,
  })
  declare source: ProgramSource;

  /**
   * Routine-shaped: exactly one ProgramWorkout, no week/day axis. Drives
   * the simplified editor a solo user sees instead of the full builder.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isSingleWorkout: boolean;

  /** Free-text grouping, carried over from the old routine table. */
  @Column({ type: DataType.STRING(100), allowNull: true })
  declare folder: string | null;

  /**
   * Editorial difficulty, on curated content only. Shares the exercise
   * enum so a routine and the movements inside it speak the same three
   * words. Null on a user's own routines, which nobody grades.
   */
  @Column({
    type: DataType.ENUM(...Object.values(ExerciseLevel)),
    allowNull: true,
  })
  declare level: ExerciseLevel | null;

  /**
   * "Rest between sets" of a routine, or a program's default rest, in
   * seconds (0 to 600, migration 079). A set's own rest wins, then the
   * day's (`ProgramWorkout.defaultRestSeconds`), then this.
   */
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare defaultRestSeconds: number | null;

  /** Set on every successful start; powers "last done 4 days ago". */
  @Column({ type: DataType.DATE, allowNull: true })
  declare lastPerformedAt: Date | null;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare description: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(ProgramKind)),
    allowNull: false,
    defaultValue: ProgramKind.Workout,
  })
  declare kind: ProgramKind;

  @Column({
    type: DataType.ENUM(...Object.values(ProgramStatus)),
    allowNull: false,
    defaultValue: ProgramStatus.Draft,
  })
  declare status: ProgramStatus;

  /**
   * Program length in days. Author UI defaults to "Weeks" with a unit
   * toggle (locked V1 decision, mirrors Trainerize). Null = open-ended.
   */
  @Column({ type: DataType.INTEGER, allowNull: true })
  declare durationDays: number | null;

  /** Free-text UX hint only (e.g. "linear", "block periodization"). */
  @Column({ type: DataType.STRING(50), allowNull: true })
  declare periodizationModel: string | null;

  @Column({ type: DataType.STRING(500), allowNull: true })
  declare coverImageUrl: string | null;

  /** E.g. ["hypertrophy","fat_loss"]. Free shape for V1. */
  @Column({ type: DataType.JSONB, allowNull: true })
  declare goalTags: string[] | null;

  /**
   * Other languages of name, description, folder, on MotionHive's own rows only
   * (migration 063). Swapped in per reader by ContentLocaleInterceptor;
   * never accepted from a request.
   */
  @Column({ type: DataType.JSONB, allowNull: true })
  declare translations: ContentTranslations | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
  @DeletedAt declare deletedAt: Date | null;

  @BelongsTo(() => User, 'ownerId')
  declare owner: User;

  @HasMany(() => ProgramWorkout)
  declare workouts: ProgramWorkout[];
}
