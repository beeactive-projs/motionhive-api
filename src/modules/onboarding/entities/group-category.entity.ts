import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  CreatedAt,
} from 'sequelize-typescript';
import { Category } from './category.entity';

/**
 * GroupCategory
 *
 * What a group trains. Backfilled from group names and tags by migration
 * 081; Discover matches groups on it.
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
