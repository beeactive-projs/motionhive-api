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
  HasMany,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Post } from './post.entity';

/**
 * PostComment Entity
 *
 * Schema supports N-level nesting via parentCommentId; the V1 service
 * enforces 1 level (matches the FB pattern) by validating that any
 * supplied parentCommentId points to a root comment.
 */
@Table({
  tableName: 'post_comment',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class PostComment extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Post)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare postId: string;

  @ForeignKey(() => PostComment)
  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
  })
  declare parentCommentId: string | null;

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare authorId: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare content: string;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date | null;

  @BelongsTo(() => Post)
  declare post: Post;

  @BelongsTo(() => User, 'authorId')
  declare author: User;

  @BelongsTo(() => PostComment, 'parentCommentId')
  declare parent: PostComment | null;

  @HasMany(() => PostComment, 'parentCommentId')
  declare replies: PostComment[];
}
