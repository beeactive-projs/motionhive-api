import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';

@Table({
  tableName: 'blog_post',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class BlogPost extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    unique: true,
  })
  declare slug: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare excerpt: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare content: string;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  declare category: string;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
  })
  declare coverImage: string | null;

  /**
   * Byline for posts written by someone WITHOUT a registered account
   * (guest contributors). Mutually exclusive with `authorUserId` —
   * exactly one is set per row, enforced by the
   * `blog_post_author_xor` CHECK in migration 033.
   *
   * For posts with `authorUserId`, the byline is derived from the
   * `author` relation at read time (firstName + lastName); leave
   * `guestAuthorName` NULL.
   */
  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  declare guestAuthorName: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 5,
  })
  declare readTime: number;

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  declare tags: string[] | null;

  @Column({
    type: DataType.CHAR(2),
    allowNull: false,
    defaultValue: 'en',
  })
  declare language: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isPublished: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare publishedAt: Date | null;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
    field: 'author_user_id',
  })
  declare authorUserId: string | null;

  @BelongsTo(() => User, { foreignKey: 'authorUserId', onDelete: 'SET NULL' })
  declare author?: User;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date;
}
