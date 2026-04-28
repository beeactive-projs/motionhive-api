import {
  Table,
  Column,
  Model,
  DataType,
  CreatedAt,
  UpdatedAt,
  DeletedAt,
  HasMany,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { User } from '../../user/entities/user.entity';
import { PostAudience } from './post-audience.entity';
import { PostComment } from './post-comment.entity';
import { PostReaction } from './post-reaction.entity';

/**
 * Post Entity
 *
 * Author-owned post. V1 ships with group audiences only; V2/V3 add
 * personal/follower and public audiences via post_audience without
 * touching this table.
 *
 * Engagement (comments, reactions) FKs to the post itself — shared
 * across all audiences. See PAYMENT-FLOWS-style decision log in
 * the posts feature memory file for the rationale.
 */
@Table({
  tableName: 'post',
  paranoid: true,
  timestamps: true,
  underscored: true,
})
export class Post extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

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

  @Column({
    type: DataType.JSON,
    allowNull: true,
    comment: 'Array of Cloudinary secure_url strings',
  })
  declare mediaUrls: string[] | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date | null;

  @BelongsTo(() => User, 'authorId')
  declare author: User;

  @HasMany(() => PostAudience)
  declare audiences: PostAudience[];

  @HasMany(() => PostComment)
  declare comments: PostComment[];

  @HasMany(() => PostReaction)
  declare reactions: PostReaction[];
}
