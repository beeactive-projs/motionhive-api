import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, UniqueConstraintError } from 'sequelize';
import { Post } from './entities/post.entity';
import {
  PostAudience,
  PostAudienceApproval,
  PostAudienceType,
} from './entities/post-audience.entity';
import { PostComment } from './entities/post-comment.entity';
import { PostReaction } from './entities/post-reaction.entity';
import { Group, MemberPostPolicy } from '../group/entities/group.entity';
import {
  GroupMember,
  GroupMemberRole,
} from '../group/entities/group-member.entity';
import { User } from '../user/entities/user.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { DeletePostDto } from './dto/delete-post.dto';
import { ModerationDecision, ModeratePostDto } from './dto/moderate-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ToggleReactionDto } from './dto/toggle-reaction.dto';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { SearchIndexService } from '../search/search-index.service';
import {
  NotificationService,
  NotificationType,
} from '../notification/notification.service';

export interface FeedItem {
  id: string;
  authorId: string;
  content: string;
  mediaUrls: string[] | null;
  createdAt: Date;
  updatedAt: Date;
  reactionCount: number;
  commentCount: number;
  myReaction: string | null;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  } | null;
  audiences?: PostAudience[];
}

@Injectable()
export class PostService {
  constructor(
    @InjectModel(Post) private readonly postModel: typeof Post,
    @InjectModel(PostAudience)
    private readonly audienceModel: typeof PostAudience,
    @InjectModel(PostComment)
    private readonly commentModel: typeof PostComment,
    @InjectModel(PostReaction)
    private readonly reactionModel: typeof PostReaction,
    @InjectModel(Group) private readonly groupModel: typeof Group,
    @InjectModel(GroupMember)
    private readonly memberModel: typeof GroupMember,
    private readonly searchIndexService: SearchIndexService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =============================================================
  // CREATE
  // =============================================================

  async createPost(authorId: string, dto: CreatePostDto): Promise<FeedItem> {
    const uniqueGroupIds = Array.from(new Set(dto.groupIds));
    if (uniqueGroupIds.length !== dto.groupIds.length) {
      throw new BadRequestException('Duplicate groupIds in request');
    }

    // Resolve groups + author memberships in one shot.
    const groups = await this.groupModel.findAll({
      where: { id: { [Op.in]: uniqueGroupIds } },
    });
    if (groups.length !== uniqueGroupIds.length) {
      throw new NotFoundException('One or more groups were not found');
    }

    const memberships = await this.memberModel.findAll({
      where: {
        groupId: { [Op.in]: uniqueGroupIds },
        userId: authorId,
        leftAt: null,
      },
    });
    const membershipByGroup = new Map(memberships.map((m) => [m.groupId, m]));

    // Per-group policy + role evaluation.
    type AudienceSpec = {
      groupId: string;
      approvalState: PostAudienceApproval;
    };
    const audienceSpecs: AudienceSpec[] = [];
    for (const group of groups) {
      const membership = membershipByGroup.get(group.id);
      if (!membership) {
        throw new ForbiddenException(
          `You are not an active member of group ${group.id}`,
        );
      }
      const isStaff =
        membership.role === GroupMemberRole.OWNER ||
        membership.role === GroupMemberRole.MODERATOR;

      if (isStaff) {
        audienceSpecs.push({
          groupId: group.id,
          approvalState: PostAudienceApproval.APPROVED,
        });
        continue;
      }

      if (group.memberPostPolicy === MemberPostPolicy.DISABLED) {
        throw new ForbiddenException(
          `Members are not allowed to post in group ${group.id}`,
        );
      }
      audienceSpecs.push({
        groupId: group.id,
        approvalState:
          group.memberPostPolicy === MemberPostPolicy.APPROVAL_REQUIRED
            ? PostAudienceApproval.PENDING
            : PostAudienceApproval.APPROVED,
      });
    }

    const sequelize = this.postModel.sequelize!;
    const tx = await sequelize.transaction();
    let createdPostId: string;
    try {
      const post = await this.postModel.create(
        {
          authorId,
          content: dto.content,
          mediaUrls: dto.mediaUrls ?? null,
        },
        { transaction: tx },
      );
      createdPostId = post.id;

      await this.audienceModel.bulkCreate(
        audienceSpecs.map((spec) => ({
          postId: post.id,
          audienceType: PostAudienceType.GROUP,
          audienceId: spec.groupId,
          approvalState: spec.approvalState,
        })),
        { transaction: tx },
      );

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    // After commit: search index + approval-flow notifications.
    // Failures here log but never roll back the user-visible write.
    await this.searchIndexService.upsertPost(createdPostId).catch((err) => {
      this.logger.error(
        `[posts] search index upsert failed for ${createdPostId}: ${(err as Error).message}`,
        'PostService',
      );
    });

    const pendingGroupIds = audienceSpecs
      .filter((s) => s.approvalState === PostAudienceApproval.PENDING)
      .map((s) => s.groupId);
    if (pendingGroupIds.length > 0) {
      await this.notifyPendingApproval(
        createdPostId,
        authorId,
        pendingGroupIds,
      );
    }

    return this.hydrateSingle(createdPostId, authorId);
  }

  // =============================================================
  // READ
  // =============================================================

  async getGroupFeed(
    userId: string,
    groupId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<FeedItem>> {
    await this.assertActiveMember(userId, groupId);
    return this.queryFeed(
      userId,
      groupId,
      PostAudienceApproval.APPROVED,
      page,
      limit,
    );
  }

  async getPendingForGroup(
    userId: string,
    groupId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<FeedItem>> {
    await this.assertGroupStaff(userId, groupId);
    return this.queryFeed(
      userId,
      groupId,
      PostAudienceApproval.PENDING,
      page,
      limit,
    );
  }

  async getComments(
    userId: string,
    postId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<PostComment>> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertCanViewPost(userId, postId);

    const offset = getOffset(page, limit);

    const { rows, count } = await this.commentModel.findAndCountAll({
      where: { postId, parentCommentId: null },
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
        },
        {
          model: PostComment,
          as: 'replies',
          required: false,
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
            },
          ],
        },
      ],
      order: [
        ['createdAt', 'ASC'],
        [{ model: PostComment, as: 'replies' }, 'createdAt', 'ASC'],
      ],
      offset,
      limit,
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  // =============================================================
  // UPDATE
  // =============================================================

  async updatePost(
    userId: string,
    postId: string,
    dto: UpdatePostDto,
  ): Promise<FeedItem> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId) {
      throw new ForbiddenException('Only the author can edit this post');
    }
    if (dto.content === undefined && dto.mediaUrls === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    const updates: Partial<Post> = {};
    if (dto.content !== undefined) updates.content = dto.content;
    if (dto.mediaUrls !== undefined) {
      updates.mediaUrls = dto.mediaUrls.length === 0 ? null : dto.mediaUrls;
    }

    await post.update(updates);

    await this.searchIndexService.upsertPost(postId).catch((err) => {
      this.logger.error(
        `[posts] search index upsert failed for ${postId}: ${(err as Error).message}`,
        'PostService',
      );
    });

    return this.hydrateSingle(postId, userId);
  }

  async moderatePost(
    userId: string,
    postId: string,
    groupId: string,
    dto: ModeratePostDto,
  ): Promise<void> {
    await this.assertGroupStaff(userId, groupId);

    const audience = await this.audienceModel.findOne({
      where: {
        postId,
        audienceType: PostAudienceType.GROUP,
        audienceId: groupId,
      },
    });
    if (!audience) {
      throw new NotFoundException('Audience entry not found for this group');
    }
    if (audience.approvalState !== PostAudienceApproval.PENDING) {
      throw new BadRequestException(
        `This audience entry is already ${audience.approvalState.toLowerCase()}`,
      );
    }

    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException('Post not found');

    const sequelize = this.postModel.sequelize!;
    const tx = await sequelize.transaction();
    try {
      if (dto.decision === ModerationDecision.APPROVED) {
        await audience.update(
          { approvalState: PostAudienceApproval.APPROVED },
          { transaction: tx },
        );
      } else {
        await audience.update(
          { approvalState: PostAudienceApproval.REJECTED },
          { transaction: tx },
        );
        await audience.destroy({ transaction: tx });
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    await this.searchIndexService.upsertPost(postId).catch(() => undefined);

    if (post.authorId !== userId) {
      await this.notificationService.notify({
        userId: post.authorId,
        type:
          dto.decision === ModerationDecision.APPROVED
            ? NotificationType.POST_APPROVED
            : NotificationType.POST_REJECTED,
        title:
          dto.decision === ModerationDecision.APPROVED
            ? 'Your post was approved'
            : 'Your post was not approved',
        body:
          dto.decision === ModerationDecision.APPROVED
            ? 'Your post is now visible to the group.'
            : 'A moderator removed your post from the group.',
        data: { screen: 'post-detail', entityId: postId },
      });
    }
  }

  // =============================================================
  // DELETE (selective)
  // =============================================================

  async deletePost(
    userId: string,
    postId: string,
    dto: DeletePostDto,
  ): Promise<{ post: 'kept' | 'deleted'; audiencesRemoved: number }> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException('Post not found');

    const allAudiences = await this.audienceModel.findAll({
      where: { postId, audienceType: PostAudienceType.GROUP },
    });
    const activeAudiences = allAudiences.filter((a) => a.deletedAt === null);
    if (activeAudiences.length === 0) {
      // Already fully deleted.
      return { post: 'deleted', audiencesRemoved: 0 };
    }

    const isAuthor = post.authorId === userId;

    // Resolve which audience rows the caller is allowed to remove.
    let targetAudiences: PostAudience[];
    if (isAuthor) {
      targetAudiences = dto.groupIds
        ? activeAudiences.filter((a) =>
            dto.groupIds!.includes(a.audienceId ?? ''),
          )
        : activeAudiences;
    } else {
      // Non-author: must be OWNER/MODERATOR of at least one audience group.
      const userMods = await this.memberModel.findAll({
        where: {
          userId,
          groupId: {
            [Op.in]: activeAudiences
              .map((a) => a.audienceId)
              .filter((id): id is string => id !== null),
          },
          role: { [Op.in]: [GroupMemberRole.OWNER, GroupMemberRole.MODERATOR] },
          leftAt: null,
        },
      });
      const moderatedGroupIds = new Set(userMods.map((m) => m.groupId));
      if (moderatedGroupIds.size === 0) {
        throw new ForbiddenException(
          'Only the author or a group moderator can delete this post',
        );
      }
      const requested = dto.groupIds
        ? new Set(dto.groupIds)
        : moderatedGroupIds;
      targetAudiences = activeAudiences.filter(
        (a) =>
          a.audienceId !== null &&
          moderatedGroupIds.has(a.audienceId) &&
          requested.has(a.audienceId),
      );
      if (targetAudiences.length === 0) {
        throw new ForbiddenException(
          'You are not a moderator of any of the targeted groups',
        );
      }
    }

    const targetIds = new Set(targetAudiences.map((a) => a.id));
    const remainingActive = activeAudiences.filter((a) => !targetIds.has(a.id));

    const sequelize = this.postModel.sequelize!;
    const tx = await sequelize.transaction();
    let postDeleted = false;
    try {
      for (const a of targetAudiences) {
        await a.destroy({ transaction: tx });
      }
      if (remainingActive.length === 0) {
        await post.destroy({ transaction: tx });
        postDeleted = true;
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    if (postDeleted) {
      await this.searchIndexService
        .removeIfExists('post', postId)
        .catch(() => undefined);
    } else {
      await this.searchIndexService.upsertPost(postId).catch(() => undefined);
    }

    return {
      post: postDeleted ? 'deleted' : 'kept',
      audiencesRemoved: targetAudiences.length,
    };
  }

  // =============================================================
  // COMMENTS
  // =============================================================

  async addComment(
    userId: string,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<PostComment> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertCanViewPost(userId, postId);

    if (dto.parentCommentId) {
      const parent = await this.commentModel.findByPk(dto.parentCommentId);
      if (!parent || parent.postId !== postId) {
        throw new BadRequestException('Parent comment not found on this post');
      }
      if (parent.parentCommentId !== null) {
        throw new BadRequestException(
          'Replies can only be added to top-level comments',
        );
      }
    }

    const comment = await this.commentModel.create({
      postId,
      parentCommentId: dto.parentCommentId ?? null,
      authorId: userId,
      content: dto.content,
    });

    if (post.authorId !== userId) {
      await this.notificationService.notify({
        userId: post.authorId,
        type: NotificationType.POST_NEW_COMMENT,
        title: 'New comment on your post',
        body: 'Someone commented on your post.',
        data: { screen: 'post-detail', entityId: postId },
      });
    }

    return this.commentModel.findByPk(comment.id, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
        },
      ],
    }) as Promise<PostComment>;
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.commentModel.findByPk(commentId);
    if (!comment) throw new NotFoundException('Comment not found');

    if (comment.authorId === userId) {
      await comment.destroy();
      return;
    }

    const audiences = await this.audienceModel.findAll({
      where: {
        postId: comment.postId,
        audienceType: PostAudienceType.GROUP,
      },
    });
    const groupIds = audiences
      .map((a) => a.audienceId)
      .filter((id): id is string => id !== null);
    if (groupIds.length === 0) {
      throw new ForbiddenException('Cannot delete this comment');
    }

    const staffMembership = await this.memberModel.findOne({
      where: {
        userId,
        groupId: { [Op.in]: groupIds },
        role: { [Op.in]: [GroupMemberRole.OWNER, GroupMemberRole.MODERATOR] },
        leftAt: null,
      },
    });
    if (!staffMembership) {
      throw new ForbiddenException('Cannot delete this comment');
    }

    await comment.destroy();
  }

  // =============================================================
  // REACTIONS
  // =============================================================

  async toggleReaction(
    userId: string,
    postId: string,
    dto: ToggleReactionDto,
  ): Promise<{ reacted: boolean; count: number }> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException('Post not found');
    await this.assertCanViewPost(userId, postId);

    const reactionType = dto.reactionType ?? 'LIKE';
    const existing = await this.reactionModel.findOne({
      where: { postId, authorId: userId },
    });

    let reacted: boolean;
    if (existing && existing.reactionType === reactionType) {
      await existing.destroy();
      reacted = false;
    } else if (existing) {
      await existing.update({ reactionType });
      reacted = true;
    } else {
      try {
        await this.reactionModel.create({
          postId,
          authorId: userId,
          reactionType,
        });
        reacted = true;
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          // Race: another concurrent request created the reaction. Treat
          // as a successful toggle-on.
          reacted = true;
        } else {
          throw err;
        }
      }
    }

    const count = await this.reactionModel.count({ where: { postId } });
    return { reacted, count };
  }

  // =============================================================
  // INTERNAL HELPERS
  // =============================================================

  private async assertActiveMember(
    userId: string,
    groupId: string,
  ): Promise<GroupMember> {
    const m = await this.memberModel.findOne({
      where: { userId, groupId, leftAt: null },
    });
    if (!m) {
      throw new ForbiddenException('You are not a member of this group');
    }
    return m;
  }

  private async assertGroupStaff(
    userId: string,
    groupId: string,
  ): Promise<GroupMember> {
    const m = await this.assertActiveMember(userId, groupId);
    if (
      m.role !== GroupMemberRole.OWNER &&
      m.role !== GroupMemberRole.MODERATOR
    ) {
      throw new ForbiddenException('Owner or moderator role required');
    }
    return m;
  }

  /**
   * Asserts the user is an active member of at least one APPROVED, non-deleted
   * audience group on the post. Used for read access (feed, comments, reactions).
   */
  private async assertCanViewPost(
    userId: string,
    postId: string,
  ): Promise<void> {
    const audiences = await this.audienceModel.findAll({
      where: {
        postId,
        audienceType: PostAudienceType.GROUP,
        approvalState: PostAudienceApproval.APPROVED,
      },
    });
    const groupIds = audiences
      .map((a) => a.audienceId)
      .filter((id): id is string => id !== null);
    if (groupIds.length === 0) {
      throw new ForbiddenException('Post is not visible to you');
    }
    const member = await this.memberModel.findOne({
      where: {
        userId,
        groupId: { [Op.in]: groupIds },
        leftAt: null,
      },
    });
    if (!member) {
      throw new ForbiddenException('Post is not visible to you');
    }
  }

  private async queryFeed(
    userId: string,
    groupId: string,
    approvalState: PostAudienceApproval,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<FeedItem>> {
    const offset = getOffset(page, limit);

    const { rows: audiences, count } = await this.audienceModel.findAndCountAll(
      {
        where: {
          audienceType: PostAudienceType.GROUP,
          audienceId: groupId,
          approvalState,
        },
        include: [
          {
            model: Post,
            required: true,
            where: { deletedAt: null },
            include: [
              {
                model: User,
                as: 'author',
                attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
              },
              // Include all live audiences so the FE can offer
              // selective delete without an extra round trip.
              {
                model: PostAudience,
                as: 'audiences',
                required: false,
              },
            ],
          },
        ],
        order: [['postedAt', 'DESC']],
        offset,
        limit,
      },
    );

    const postIds = audiences.map((a) => a.postId);
    const [reactionCounts, commentCounts, myReactions] = await Promise.all([
      this.countReactionsByPost(postIds),
      this.countCommentsByPost(postIds),
      this.fetchMyReactions(userId, postIds),
    ]);

    const items: FeedItem[] = audiences.map((a) => {
      const post = a.post;
      return {
        id: post.id,
        authorId: post.authorId,
        content: post.content,
        mediaUrls: post.mediaUrls,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        reactionCount: reactionCounts.get(post.id) ?? 0,
        commentCount: commentCounts.get(post.id) ?? 0,
        myReaction: myReactions.get(post.id) ?? null,
        author: post.author
          ? {
              id: post.author.id,
              firstName: post.author.firstName,
              lastName: post.author.lastName,
              avatarUrl: post.author.avatarUrl,
            }
          : null,
        audiences: post.audiences ?? [],
      };
    });

    return buildPaginatedResponse(items, count, page, limit);
  }

  private async hydrateSingle(
    postId: string,
    userId: string,
  ): Promise<FeedItem> {
    const post = await this.postModel.findByPk(postId, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl'],
        },
        { model: PostAudience, as: 'audiences' },
      ],
    });
    if (!post) throw new NotFoundException('Post not found');

    const [reactionCount, commentCount, myReaction] = await Promise.all([
      this.reactionModel.count({ where: { postId } }),
      this.commentModel.count({ where: { postId } }),
      this.reactionModel.findOne({ where: { postId, authorId: userId } }),
    ]);

    return {
      id: post.id,
      authorId: post.authorId,
      content: post.content,
      mediaUrls: post.mediaUrls,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      reactionCount,
      commentCount,
      myReaction: myReaction?.reactionType ?? null,
      author: post.author
        ? {
            id: post.author.id,
            firstName: post.author.firstName,
            lastName: post.author.lastName,
            avatarUrl: post.author.avatarUrl,
          }
        : null,
      audiences: post.audiences ?? [],
    };
  }

  private async countReactionsByPost(
    postIds: string[],
  ): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();
    const sequelize = this.reactionModel.sequelize!;
    const rows = (await this.reactionModel.findAll({
      attributes: [
        'postId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { postId: { [Op.in]: postIds } },
      group: ['postId'],
      raw: true,
    })) as unknown as Array<{ postId: string; count: string }>;
    return new Map(rows.map((r) => [r.postId, Number(r.count)]));
  }

  private async countCommentsByPost(
    postIds: string[],
  ): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();
    const sequelize = this.commentModel.sequelize!;
    const rows = (await this.commentModel.findAll({
      attributes: [
        'postId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      where: { postId: { [Op.in]: postIds } },
      group: ['postId'],
      raw: true,
    })) as unknown as Array<{ postId: string; count: string }>;
    return new Map(rows.map((r) => [r.postId, Number(r.count)]));
  }

  private async fetchMyReactions(
    userId: string,
    postIds: string[],
  ): Promise<Map<string, string>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.reactionModel.findAll({
      where: { authorId: userId, postId: { [Op.in]: postIds } },
    });
    return new Map(rows.map((r) => [r.postId, r.reactionType]));
  }

  private async notifyPendingApproval(
    postId: string,
    authorId: string,
    groupIds: string[],
  ): Promise<void> {
    const staff = await this.memberModel.findAll({
      where: {
        groupId: { [Op.in]: groupIds },
        role: { [Op.in]: [GroupMemberRole.OWNER, GroupMemberRole.MODERATOR] },
        leftAt: null,
      },
    });
    const staffUserIds = Array.from(
      new Set(staff.map((m) => m.userId).filter((id) => id !== authorId)),
    );
    if (staffUserIds.length === 0) return;

    await this.notificationService.notifyMany(staffUserIds, {
      type: NotificationType.POST_PENDING_APPROVAL,
      title: 'A post needs your review',
      body: 'A member has posted in a group you moderate.',
      data: { screen: 'post-pending', entityId: postId },
    });
  }
}
