import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';
import type { ContentTranslations } from '../../../common/i18n';
import { CategoryKind } from './onboarding.enums';

/**
 * Category
 *
 * MotionHive's own list of what people train (ACTIVITY) and why (GOAL),
 * seeded by migration 081. One list for a person's interests, a coach's
 * categories and a group's. Names are English, with Romanian in
 * `translations`, swapped in per reader by ContentLocaleInterceptor.
 *
 * `slug` is the stable key: ids are generated per database, so code that
 * means a particular category (tests, the apps' fallbacks) goes by slug.
 */
@Table({
  tableName: 'category',
  timestamps: true,
  underscored: true,
})
export class Category extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({ type: DataType.STRING(50), allowNull: false, unique: true })
  declare slug: string;

  @Column({
    type: DataType.ENUM(...Object.values(CategoryKind)),
    allowNull: false,
  })
  declare kind: CategoryKind;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  /** An Ionicons outline glyph name; the apps draw it as is. */
  @Column({ type: DataType.STRING(50), allowNull: false })
  declare icon: string;

  @Column({ type: DataType.SMALLINT, allowNull: false, defaultValue: 0 })
  declare displayOrder: number;

  /** Offered by coaches, never picked as a trainee's interest (nutrition). */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  declare coachesOnly: boolean;

  /** Other languages of `name`; never accepted from a request. */
  @Column({ type: DataType.JSONB, allowNull: true })
  declare translations: ContentTranslations | null;

  @CreatedAt declare createdAt: Date;
  @UpdatedAt declare updatedAt: Date;
}
