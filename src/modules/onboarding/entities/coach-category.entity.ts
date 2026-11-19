import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
} from 'sequelize-typescript';
import { Category } from '../../category/entities/category.entity';

/**
 * CoachCategory
 *
 * What a coach offers, keyed by the coach's user id (session_template and
 * group point at the user too). Replaces the free-text specializations as
 * the thing Discover matches on; extra words stay in
 * instructor_profile.specializations.
 */
@Table({
  tableName: 'coach_category',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class CoachCategory extends Model {
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare userId: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare categoryId: string;

  @CreatedAt declare createdAt: Date;

  @BelongsTo(() => Category)
  declare category: Category;
}
