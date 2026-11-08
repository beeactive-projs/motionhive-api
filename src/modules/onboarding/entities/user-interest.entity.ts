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
 * UserInterest
 *
 * A person's interests: what they like to train and why. Picked in the
 * welcome flow (INTERESTS step) and later from Account. Coaches-only
 * categories are never stored here (service rule).
 */
@Table({
  tableName: 'user_interest',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class UserInterest extends Model {
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare userId: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare categoryId: string;

  @CreatedAt declare createdAt: Date;

  @BelongsTo(() => Category)
  declare category: Category;
}
