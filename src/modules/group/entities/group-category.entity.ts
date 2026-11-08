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
 * GroupCategory
 *
 * What a group trains: activities from the category list, set by the
 * group's owner when they create or edit it (`categoryIds`). Backfilled
 * from group names and tags by migration 081; Discover matches groups on it.
 */
@Table({
  tableName: 'group_category',
  timestamps: true,
  updatedAt: false,
  underscored: true,
})
export class GroupCategory extends Model {
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare groupId: string;

  @ForeignKey(() => Category)
  @Column({ type: DataType.CHAR(36), primaryKey: true })
  declare categoryId: string;

  @CreatedAt declare createdAt: Date;

  @BelongsTo(() => Category)
  declare category: Category;
}
