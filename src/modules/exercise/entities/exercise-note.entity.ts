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
import { User } from '../../user/entities/user.entity';
import { Exercise } from './exercise.entity';

/** Longest personal note, in characters (the column is VARCHAR(280)). */
export const EXERCISE_NOTE_MAX_LENGTH = 280;

/**
 * A person's own note on an exercise ("seat on 4", "elbows in"), one per
 * person and exercise (migration 079). Private to its owner: the logger
 * and the finished workout show it to them, and no coach read carries it.
 * Goes with the person and with the exercise (ON DELETE CASCADE).
 */
@Table({
  tableName: 'exercise_note',
  timestamps: true,
  underscored: true,
})
export class ExerciseNote extends Model {
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

  @Column({ type: DataType.STRING(EXERCISE_NOTE_MAX_LENGTH), allowNull: false })
  declare note: string;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;

  @BelongsTo(() => User, 'userId')
  declare user: User;

  @BelongsTo(() => Exercise, 'exerciseId')
  declare exercise: Exercise;
}
