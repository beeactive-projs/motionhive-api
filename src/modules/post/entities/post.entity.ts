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
import { Group } from '../../group/entities/group.entity';
import { User } from '../../user/entities/user.entity';
import { PostComment } from './post-comment.entity';
import { PostReaction } from './post-reaction.entity';

/**
 * Approval state for a post when the group's member-post policy requires
 * moderation. Staff posts are always APPROVED on create. Member posts in
 * an APPROVAL_REQUIRED group land in PENDING until a moderator decides.
 */
export enum PostApprovalState {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
}

/**
 * Post Entity
 *
 * V1 model: each post belongs to exactly one group. Cross-posting is a
 * server-side fan-out — `POST /posts` with N groupIds creates N
 * independent posts, each owning its own comments / reactions / images.
 * Mirrors Facebook & LinkedIn semantics.
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

  @ForeignKey(() => Group)
  @Column({
    type: DataType.CHAR(36),
    allowNull: false,
  })
  declare groupId: string;

  @Column({
    type: DataType.ENUM(...Object.values(PostApprovalState)),
    allowNull: false,
    defaultValue: PostApprovalState.APPROVED,
  })
  declare approvalState: PostApprovalState;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare content: string;

  @Column({
    type: DataType.JSON,
    allowNull: true,
    comment: 'Array of Cloudinary secure_url strings owned by THIS post',
  })
  declare mediaUrls: string[] | null;

  /**
   * A finished workout shared into the group (migration 075), shown as a
   * card from its safe summary. Null for an ordinary post, or once the
   * workout is gone.
   */
  @Column({ type: DataType.CHAR(36), allowNull: true })
  declare workoutLogId: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare postedAt: Date;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @DeletedAt
  declare deletedAt: Date | null;

  @BelongsTo(() => User, 'authorId')
  declare author: User;

  @BelongsTo(() => Group, 'groupId')
  declare group: Group;

  @HasMany(() => PostComment)
  declare comments: PostComment[];

  @HasMany(() => PostReaction)
  declare reactions: PostReaction[];
}
