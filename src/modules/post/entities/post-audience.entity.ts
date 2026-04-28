import {
  Table,
  Column,
  Model,
  DataType,
  DeletedAt,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Post } from './post.entity';

/**
 * Polymorphic audience junction. V1 only stores GROUP rows.
 * V2 will widen to FOLLOWERS, V3 to PUBLIC. Adding a value is
 * a `ALTER TYPE post_audience_type ADD VALUE` migration — no
 * table changes here.
 */
export enum PostAudienceType {
  GROUP = 'GROUP',
}

export enum PostAudienceApproval {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
}

/**
 * PostAudience Entity
 *
 * Paranoid: per-audience selective delete is a product feature
 * (delete from group A but keep in group B). When the last active
 * audience for a post is removed, the parent post is also soft-deleted.
 */
@Table({
  tableName: 'post_audience',
  paranoid: true,
  timestamps: false,
  underscored: true,
})
export class PostAudience extends Model {
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

  @Column({
    type: DataType.ENUM(...Object.values(PostAudienceType)),
    allowNull: false,
  })
  declare audienceType: PostAudienceType;

  @Column({
    type: DataType.CHAR(36),
    allowNull: true,
    comment:
      'group.id when audienceType=GROUP; NULL for FOLLOWERS/PUBLIC (V2/V3)',
  })
  declare audienceId: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(PostAudienceApproval)),
    allowNull: false,
    defaultValue: PostAudienceApproval.APPROVED,
  })
  declare approvalState: PostAudienceApproval;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare postedAt: Date;

  @DeletedAt
  declare deletedAt: Date | null;

  @BelongsTo(() => Post)
  declare post: Post;
}
