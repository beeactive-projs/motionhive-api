import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { Post } from './post.entity';

/**
 * PostReaction Entity
 *
 * One row per (post, user). reactionType is VARCHAR(20) so adding
 * new reaction types (LOVE, HAHA, etc.) is a data-only change —
 * no schema migration. UNIQUE(post_id, author_id) is the final guard
 * against duplicate reactions on a race.
 */
@Table({
  tableName: 'post_reaction',
  paranoid: false,
  timestamps: false,
  underscored: true,
})
export class PostReaction extends Model {
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

  @ForeignKey(() => User)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare authorId: string;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'LIKE',
  })
  declare reactionType: string;

  @CreatedAt
  declare createdAt: Date;

  @BelongsTo(() => Post)
  declare post: Post;

  @BelongsTo(() => User, 'authorId')
  declare author: User;
}
