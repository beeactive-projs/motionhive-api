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
import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { Post, PostApprovalState } from './entities/post.entity';
import { PostComment } from './entities/post-comment.entity';
import { PostReaction } from './entities/post-reaction.entity';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { apiError } from '../../common/i18n';
import { Group, MemberPostPolicy } from '../group/entities/group.entity';
import {
  GroupMember,
  GroupMemberRole,
} from '../group/entities/group-member.entity';
import { GroupService } from '../group/group.service';
import { PostWorkout, WorkoutLogService } from '../workout/workout-log.service';
import { User, USER_SAFE_ATTRIBUTES } from '../user/entities/user.entity';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { ModerationDecision, ModeratePostDto } from './dto/moderate-post.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ToggleReactionDto } from './dto/toggle-reaction.dto';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { SearchIndexService } from '../search/search-index.service';
import { NotificationService } from '../notification/notification.service';
import {
  postPendingApproval,
  postApprovedForAuthor,
  postRejectedForAuthor,
  postNewComment,
} from './notifications';
import { DELETED_CONTENT_TOMBSTONE, destroyPostFully } from './post-deletion';

export interface FeedItem {
  id: string;
  authorId: string;
  groupId: string;
  approvalState: PostApprovalState;
  content: string;
  mediaUrls: string[] | null;
  postedAt: Date;
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
    /**
     * How the FE addresses a profile (`/@<handle>`). Nullable because an
     * account can exist without one; a name with no handle simply is not a
     * link. Comments already carried this — posts projected it away, so the
     * same author was tappable under a comment and inert above it.
     */
    handle: string | null;
  } | null;
  /**
   * Optional. Populated by the cross-group feed (`getMyFeed`) so the FE
   * can label which group a post came from. The per-group feed leaves
   * this `null` because the group is implicit in the URL.
   */
  group?: { id: string; name: string; logoUrl: string | null } | null;
  /** A shared workout as a card; null for an ordinary post or a deleted workout. */
  workout: PostWorkout | null;
}

/** Per-group spec used inside the create-post fan-out. */
interface GroupCreateSpec {
  group: Group;
  approvalState: PostApprovalState;
}

@Injectable()
export class PostService {
  constructor(
    @InjectModel(Post) private readonly postModel: typeof Post,
    @InjectModel(PostComment)
    private readonly commentModel: typeof PostComment,
    @InjectModel(PostReaction)
    private readonly reactionModel: typeof PostReaction,
    @InjectModel(Group) private readonly groupModel: typeof Group,
    @InjectModel(GroupMember)
    private readonly memberModel: typeof GroupMember,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly searchIndexService: SearchIndexService,
    private readonly notificationService: NotificationService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly groupService: GroupService,
    private readonly workoutLogService: WorkoutLogService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =====================================================================
  // CREATE — fan-out to one independent post per group
  // =====================================================================

  /**
   * Create one post per groupId in `dto.groupIds`. Each post owns its own
   * comments / reactions / image copies. Cross-posting in the FE is a
   * single API call here; we resolve every group's approval state up
   * front, then create posts one-by-one (each in its own transaction so a
   * downstream failure on post #3 doesn't roll back posts #1 and #2).
   *
   * Image handling: the FE uploads each image once via /posts/upload-image
   * (staging URL). For each created post we clone every staging asset
   * into the post's per-post Cloudinary folder. After all posts are
   * created we delete the original staging asset so it doesn't linger.
   */
  async createPost(
    authorId: string,
    dto: CreatePostDto,
  ): Promise<{ posts: FeedItem[] }> {
    const uniqueGroupIds = Array.from(new Set(dto.groupIds));
    if (uniqueGroupIds.length !== dto.groupIds.length) {
      throw new BadRequestException(apiError('post.duplicateGroups'));
    }

    if (dto.mediaUrls?.length) {
      this.cloudinaryService.assertOwnedUrls(dto.mediaUrls);
    }
    if (dto.workoutLogId) {
      await this.workoutLogService.assertShareable(dto.workoutLogId, authorId);
    }

    const specs = await this.resolveCreateSpecs(authorId, uniqueGroupIds);
    const stagingUrls = dto.mediaUrls ?? [];

    const created: Post[] = [];
    for (const spec of specs) {
      const post = await this.createSinglePost(
        authorId,
        spec,
        dto.content ?? '',
        stagingUrls,
        dto.workoutLogId ?? null,
      );
      created.push(post);
    }

    // After-commit: search index, notifications, staging cleanup.
    // None of these can roll back the posts; they're best-effort.
    await Promise.all(
      created.map((p) =>
        this.searchIndexService.upsertPost(p.id).catch((err) => {
          this.logger.error(
            `[posts] search index upsert failed for ${p.id}: ${(err as Error).message}`,
            'PostService',
          );
        }),
      ),
    );
    await this.notifyAuthorsForPending(authorId, created);
    await Promise.all(
      stagingUrls.map((url) => this.cloudinaryService.deleteByUrl(url)),
    );

    const items = await Promise.all(
      created.map((p) => this.hydrateSingle(p.id, authorId)),
    );
    return { posts: items };
  }

  /**
   * Resolve every target group's membership + post policy + role in one
   * pair of queries, then derive the per-group approval state. Throws on
   * any group the author can't post into so the entire fan-out aborts
   * before we touch the DB.
   */
  private async resolveCreateSpecs(
    authorId: string,
    groupIds: string[],
  ): Promise<GroupCreateSpec[]> {
    const groups = await this.groupModel.findAll({
      where: { id: { [Op.in]: groupIds } },
    });
    if (groups.length !== groupIds.length) {
      throw new NotFoundException(apiError('post.groupsNotFound'));
    }

    const memberships = await this.memberModel.findAll({
      where: {
        groupId: { [Op.in]: groupIds },
        userId: authorId,
        leftAt: null,
      },
    });
    const membershipByGroup = new Map(memberships.map((m) => [m.groupId, m]));

    const specs: GroupCreateSpec[] = [];
    for (const group of groups) {
      const membership = membershipByGroup.get(group.id);
      if (!membership) {
        throw new ForbiddenException(
          apiError('post.cannotPostNotMember', { group: group.name }),
        );
      }

      const isStaff =
        membership.role === GroupMemberRole.OWNER ||
        membership.role === GroupMemberRole.MODERATOR;

      if (isStaff) {
        specs.push({ group, approvalState: PostApprovalState.APPROVED });
        continue;
      }

      if (group.memberPostPolicy === MemberPostPolicy.DISABLED) {
        throw new ForbiddenException(
          apiError('post.membersCannotPost', { group: group.name }),
        );
      }

      specs.push({
        group,
        approvalState:
          group.memberPostPolicy === MemberPostPolicy.APPROVAL_REQUIRED
            ? PostApprovalState.PENDING
            : PostApprovalState.APPROVED,
      });
    }

    return specs;
  }

  /**
   * Insert one post + clone every staging asset into the post's folder.
   * Uses a transaction for the DB writes; image clones happen after
   * commit so a Cloudinary slowdown can't tie up a Postgres connection.
   * If image cloning fails partway through, the post still exists with
   * the assets that were cloned so far — the user retries by editing.
   */
  private async createSinglePost(
    authorId: string,
    spec: GroupCreateSpec,
    content: string,
    stagingUrls: string[],
    workoutLogId: string | null,
  ): Promise<Post> {
    const sequelize = this.postModel.sequelize!;
    const tx = await sequelize.transaction();
    let post: Post;
    try {
      post = await this.postModel.create(
        {
          authorId,
          groupId: spec.group.id,
          approvalState: spec.approvalState,
          content,
          mediaUrls: null,
          workoutLogId,
        },
        { transaction: tx },
      );
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    if (stagingUrls.length > 0) {
      const cloned: string[] = [];
      for (const src of stagingUrls) {
        try {
          const { url } = await this.cloudinaryService.cloneByUrl(src, {
            resource: 'posts',
            userId: authorId,
            postId: post.id,
          });
          cloned.push(url);
        } catch (err) {
          this.logger.error(
            `[posts] cloneByUrl failed for ${src} on post ${post.id}: ${(err as Error).message}`,
            'PostService',
          );
        }
      }
      if (cloned.length > 0) {
        await post.update({ mediaUrls: cloned });
      }
    }

    return post;
  }

  /** Notify staff of every group where this fan-out produced a PENDING post. */
  private async notifyAuthorsForPending(
    authorId: string,
    posts: Post[],
  ): Promise<void> {
    const pending = posts.filter(
      (p) => p.approvalState === PostApprovalState.PENDING,
    );
    if (pending.length === 0) return;

    const groupIds = pending.map((p) => p.groupId);
    const [staff, groups, author] = await Promise.all([
      this.memberModel.findAll({
        where: {
          groupId: { [Op.in]: groupIds },
          role: { [Op.in]: [GroupMemberRole.OWNER, GroupMemberRole.MODERATOR] },
          leftAt: null,
        },
      }),
      this.groupModel.findAll({
        where: { id: { [Op.in]: groupIds } },
        attributes: ['id', 'name'],
      }),
      this.userModel.findByPk(authorId, {
        attributes: ['id', 'firstName', 'lastName'],
      }),
    ]);
    const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
    const authorName =
      [author?.firstName, author?.lastName].filter(Boolean).join(' ').trim() ||
      null;

    // One notification per (post, staffUser). Deduped by post id.
    for (const post of pending) {
      const recipients = staff
        .filter((m) => m.groupId === post.groupId && m.userId !== authorId)
        .map((m) => m.userId);
      if (recipients.length === 0) continue;
      await this.notificationService.notifyMany(
        recipients,
        postPendingApproval(
          {
            groupId: post.groupId,
            groupName: groupNameById.get(post.groupId) ?? null,
            postId: post.id,
          },
          authorName,
        ),
      );
    }
  }

  // =====================================================================
  // READ
  // =====================================================================

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
      PostApprovalState.APPROVED,
      page,
      limit,
    );
  }

  /**
   * Aggregated feed across every group the user is an active member of.
   *
   * Mirrors Facebook's "groups feed" surface — APPROVED posts only,
   * sorted by `postedAt DESC`, paginated. Each item is enriched with
   * `group: { id, name, logoUrl }` so the FE can show a "posted in X"
   * badge above the author line.
   *
   * Returns an empty paginated response when the user has no
   * memberships, avoiding a wasted DB round-trip.
   */
  async getMyFeed(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<FeedItem>> {
    const groupIds = await this.groupService.findMyGroupIds(userId);
    if (groupIds.length === 0) {
      return buildPaginatedResponse([], 0, page, limit);
    }

    const offset = getOffset(page, limit);

    const { rows: posts, count } = await this.postModel.findAndCountAll({
      where: {
        groupId: { [Op.in]: groupIds },
        approvalState: PostApprovalState.APPROVED,
      },
      include: [
        {
          model: User,
          as: 'author',
          attributes: USER_SAFE_ATTRIBUTES,
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'logoUrl'],
        },
      ],
      order: [['postedAt', 'DESC']],
      offset,
      limit,
    });

    const items = await this.hydrateFeedItems(posts, userId, {
      includeGroup: true,
    });
    return buildPaginatedResponse(items, count, page, limit);
  }

  /**
   * Single-post fetch used by the photo viewer / deep-link surfaces.
   * Same visibility rules as the feed: caller must be an active member of
   * the post's group, post must be APPROVED. Returns the same FeedItem
   * shape the feeds emit, with the `group` association populated so the
   * FE can render the "Posted in X" badge.
   */
  async getPostById(userId: string, postId: string): Promise<FeedItem> {
    await this.assertCanViewPost(userId, postId);

    const post = await this.postModel.findByPk(postId, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: USER_SAFE_ATTRIBUTES,
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'logoUrl'],
        },
      ],
    });
    if (!post) throw new NotFoundException(apiError('post.notFound'));

    const [items] = await this.hydrateFeedItems([post], userId, {
      includeGroup: true,
    });
    return items;
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
      PostApprovalState.PENDING,
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
    const post = await this.assertCanViewPost(userId, postId);

    const offset = getOffset(page, limit);

    const { rows, count } = await this.commentModel.findAndCountAll({
      where: { postId: post.id, parentCommentId: null },
      include: [
        {
          model: User,
          as: 'author',
          attributes: USER_SAFE_ATTRIBUTES,
        },
        {
          model: PostComment,
          as: 'replies',
          required: false,
          include: [
            {
              model: User,
              as: 'author',
              attributes: USER_SAFE_ATTRIBUTES,
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

  // =====================================================================
  // UPDATE
  // =====================================================================

  async updatePost(
    userId: string,
    postId: string,
    dto: UpdatePostDto,
  ): Promise<FeedItem> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException(apiError('post.notFound'));
    if (post.authorId !== userId) {
      throw new ForbiddenException(apiError('post.onlyAuthorCanEdit'));
    }
    if (dto.content === undefined && dto.mediaUrls === undefined) {
      throw new BadRequestException(apiError('post.nothingToUpdate'));
    }

    if (dto.mediaUrls?.length) {
      this.cloudinaryService.assertOwnedUrls(dto.mediaUrls);
    }

    const previousMedia = post.mediaUrls ?? [];

    const updates: Partial<Post> = {};
    if (dto.content !== undefined) updates.content = dto.content;
    if (dto.mediaUrls !== undefined) {
      updates.mediaUrls = dto.mediaUrls.length === 0 ? null : dto.mediaUrls;
    }
    await post.update(updates);

    if (dto.mediaUrls !== undefined) {
      const nextSet = new Set(dto.mediaUrls);
      const orphaned = previousMedia.filter((url) => !nextSet.has(url));
      await Promise.all(
        orphaned.map((url) => this.cloudinaryService.deleteByUrl(url)),
      );
    }

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
    dto: ModeratePostDto,
  ): Promise<void> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException(apiError('post.notFound'));
    await this.assertGroupStaff(userId, post.groupId);

    if (post.approvalState !== PostApprovalState.PENDING) {
      throw new BadRequestException(
        apiError('post.alreadyReviewed', { state: post.approvalState }),
      );
    }

    if (dto.decision === ModerationDecision.APPROVED) {
      await post.update({ approvalState: PostApprovalState.APPROVED });
      await this.searchIndexService.upsertPost(postId).catch(() => undefined);
    } else {
      // REJECTED: tombstone + soft-delete + purge assets. The post becomes
      // unrecoverable from the user's view; mods can still query soft-
      // deleted rows for audit.
      const mediaToDelete = post.mediaUrls ?? [];
      const sequelize = this.postModel.sequelize!;
      const tx = await sequelize.transaction();
      try {
        await this.destroyPostFully(post, tx);
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw err;
      }
      await this.afterPostFullyDeleted(postId, post.authorId, mediaToDelete);
    }

    if (post.authorId !== userId) {
      const group = await this.groupModel.findByPk(post.groupId, {
        attributes: ['id', 'name'],
      });
      const ctx = {
        groupId: post.groupId,
        groupName: group?.name ?? null,
        postId,
      };
      const params =
        dto.decision === ModerationDecision.APPROVED
          ? postApprovedForAuthor(post.authorId, ctx)
          : postRejectedForAuthor(post.authorId, ctx);
      // notify-after-commit: REJECTED branch already destroyed the post
      // inside its own tx above; APPROVED branch already did
      // post.update + searchIndex (no enclosing tx). Either way, the
      // notify can't orphan. Do NOT hoist into a tx.
      await this.notificationService.notify(params);
    }
  }

  // =====================================================================
  // DELETE
  // =====================================================================

  async deletePost(userId: string, postId: string): Promise<{ deleted: true }> {
    // Bypass paranoid filter so we can detect "already soft-deleted" and
    // short-circuit idempotently.
    const post = await this.postModel.findOne({
      where: { id: postId },
      paranoid: false,
    });
    if (!post) throw new NotFoundException(apiError('post.notFound'));

    // Idempotent on retries.
    if (post.deletedAt !== null) {
      return { deleted: true };
    }

    // Author can delete their own; group OWNER/MODERATOR can delete any.
    if (post.authorId !== userId) {
      await this.assertGroupStaff(userId, post.groupId);
    }

    const mediaToDelete = post.mediaUrls ?? [];
    const sequelize = this.postModel.sequelize!;
    const tx = await sequelize.transaction();
    try {
      await this.destroyPostFully(post, tx);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    await this.afterPostFullyDeleted(postId, post.authorId, mediaToDelete);
    return { deleted: true };
  }

  // =====================================================================
  // COMMENTS
  // =====================================================================

  async addComment(
    userId: string,
    postId: string,
    dto: CreateCommentDto,
  ): Promise<PostComment> {
    const post = await this.assertCanViewPost(userId, postId);

    if (dto.parentCommentId) {
      const parent = await this.commentModel.findByPk(dto.parentCommentId);
      if (!parent || parent.postId !== postId) {
        throw new BadRequestException(apiError('post.replyTargetNotFound'));
      }
      if (parent.parentCommentId !== null) {
        throw new BadRequestException(apiError('post.cannotReplyToReply'));
      }
    }

    const comment = await this.commentModel.create({
      postId,
      parentCommentId: dto.parentCommentId ?? null,
      authorId: userId,
      content: dto.content,
    });

    if (post.authorId !== userId) {
      const [group, commenter] = await Promise.all([
        this.groupModel.findByPk(post.groupId, { attributes: ['id', 'name'] }),
        this.userModel.findByPk(userId, {
          attributes: ['id', 'firstName', 'lastName'],
        }),
      ]);
      const commenterName =
        [commenter?.firstName, commenter?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || null;
      await this.notificationService.notify(
        postNewComment(
          post.authorId,
          {
            groupId: post.groupId,
            groupName: group?.name ?? null,
            postId,
          },
          commenterName,
        ),
      );
    }

    return this.commentModel.findByPk(comment.id, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: USER_SAFE_ATTRIBUTES,
        },
      ],
    }) as Promise<PostComment>;
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const comment = await this.commentModel.findByPk(commentId);
    if (!comment) throw new NotFoundException(apiError('post.commentNotFound'));

    if (comment.authorId !== userId) {
      // Non-author: must be staff of the post's group.
      const post = await this.postModel.findByPk(comment.postId);
      if (!post) throw new NotFoundException(apiError('post.notFound'));
      await this.assertGroupStaff(userId, post.groupId);
    }

    // Cascade replies for top-level comments. Replies are 1-level only
    // (enforced in addComment), so a single bulk update covers it.
    const sequelize = this.commentModel.sequelize!;
    const tx = await sequelize.transaction();
    try {
      if (comment.parentCommentId === null) {
        await this.commentModel.update(
          { content: DELETED_CONTENT_TOMBSTONE },
          { where: { parentCommentId: comment.id }, transaction: tx },
        );
        await this.commentModel.destroy({
          where: { parentCommentId: comment.id },
          transaction: tx,
        });
      }
      await comment.update(
        { content: DELETED_CONTENT_TOMBSTONE },
        { transaction: tx },
      );
      await comment.destroy({ transaction: tx });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  // =====================================================================
  // REACTIONS
  // =====================================================================

  async toggleReaction(
    userId: string,
    postId: string,
    dto: ToggleReactionDto,
  ): Promise<{ reacted: boolean; count: number }> {
    await this.assertCanViewPost(userId, postId);

    const reactionType = dto.reactionType ?? 'LIKE';
    const sequelize = this.reactionModel.sequelize!;
    const tx = await sequelize.transaction();

    let reacted: boolean;
    let count: number;
    try {
      const existing = await this.reactionModel.findOne({
        where: { postId, authorId: userId },
        transaction: tx,
      });

      if (existing && existing.reactionType === reactionType) {
        await existing.destroy({ transaction: tx });
        reacted = false;
      } else if (existing) {
        await existing.update({ reactionType }, { transaction: tx });
        reacted = true;
      } else {
        try {
          await this.reactionModel.create(
            { postId, authorId: userId, reactionType },
            { transaction: tx },
          );
          reacted = true;
        } catch (err) {
          if (err instanceof UniqueConstraintError) {
            // Race: another concurrent request created the reaction.
            // Treat as a successful toggle-on.
            reacted = true;
          } else {
            throw err;
          }
        }
      }

      count = await this.reactionModel.count({
        where: { postId },
        transaction: tx,
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    return { reacted, count };
  }

  // =====================================================================
  // SHARED HELPERS
  // =====================================================================

  /** Inside-transaction cleanup when a post is soft-deleted in full. */
  private destroyPostFully(post: Post, tx: Transaction): Promise<void> {
    return destroyPostFully(
      post,
      { comment: this.commentModel, reaction: this.reactionModel },
      tx,
    );
  }

  /**
   * After-commit side effects when a post is fully deleted: drop search
   * index entry and purge the post's Cloudinary folder. Failures are
   * logged but never surfaced — the user-visible state already changed.
   */
  private async afterPostFullyDeleted(
    postId: string,
    authorId: string,
    mediaUrls: string[],
  ): Promise<void> {
    await this.searchIndexService
      .removeIfExists('post', postId)
      .catch(() => undefined);
    if (mediaUrls.length > 0) {
      // Nuke the post's folder in one shot — covers every media URL plus
      // any orphaned versions (e.g. transformations Cloudinary may have
      // generated). Falls back to per-URL delete if the folder API fails.
      const folder = this.cloudinaryService.buildPostFolder(authorId, postId);
      await this.cloudinaryService.deleteFolder(folder);
    }
  }

  private async assertActiveMember(
    userId: string,
    groupId: string,
  ): Promise<GroupMember> {
    const m = await this.memberModel.findOne({
      where: { userId, groupId, leftAt: null },
    });
    if (!m) {
      throw new ForbiddenException(apiError('post.notGroupMember'));
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
      throw new ForbiddenException(apiError('post.staffOnly'));
    }
    return m;
  }

  /**
   * Resolves the post + asserts the user can view it (active member of
   * its group, post must be APPROVED). Returns the Post for callers that
   * need it. Throws ForbiddenException on miss — never NotFoundException
   * on access denial, so we don't leak existence to non-members.
   */
  private async assertCanViewPost(
    userId: string,
    postId: string,
  ): Promise<Post> {
    const post = await this.postModel.findByPk(postId);
    if (!post) throw new NotFoundException(apiError('post.notFound'));
    if (post.approvalState !== PostApprovalState.APPROVED) {
      throw new ForbiddenException(apiError('post.notVisible'));
    }
    await this.assertActiveMember(userId, post.groupId);
    return post;
  }

  private async queryFeed(
    userId: string,
    groupId: string,
    approvalState: PostApprovalState,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<FeedItem>> {
    const offset = getOffset(page, limit);

    const { rows: posts, count } = await this.postModel.findAndCountAll({
      where: { groupId, approvalState },
      include: [
        {
          model: User,
          as: 'author',
          attributes: USER_SAFE_ATTRIBUTES,
        },
      ],
      order: [['postedAt', 'DESC']],
      offset,
      limit,
    });

    const items = await this.hydrateFeedItems(posts, userId);
    return buildPaginatedResponse(items, count, page, limit);
  }

  /**
   * Hydrate a batch of posts with reactions, comments, and the caller's
   * own reaction. Shared by the per-group and aggregated feeds.
   *
   * `includeGroup`: pass `true` when the posts were loaded with the
   * `group` association — the helper will surface it on each FeedItem.
   */
  private async hydrateFeedItems(
    posts: Post[],
    userId: string,
    options: { includeGroup?: boolean } = {},
  ): Promise<FeedItem[]> {
    const postIds = posts.map((p) => p.id);
    const [reactionCounts, commentCounts, myReactions, workouts] =
      await Promise.all([
        this.countReactionsByPost(postIds),
        this.countCommentsByPost(postIds),
        this.fetchMyReactions(userId, postIds),
        this.workoutLogService.summariesForPosts(
          posts.flatMap((p) => (p.workoutLogId ? [p.workoutLogId] : [])),
        ),
      ]);

    return posts.map((post) => ({
      id: post.id,
      authorId: post.authorId,
      groupId: post.groupId,
      approvalState: post.approvalState,
      content: post.content,
      mediaUrls: post.mediaUrls,
      postedAt: post.postedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      reactionCount: reactionCounts.get(post.id) ?? 0,
      commentCount: commentCounts.get(post.id) ?? 0,
      myReaction: myReactions.get(post.id) ?? null,
      workout: (post.workoutLogId && workouts.get(post.workoutLogId)) || null,
      author: post.author
        ? {
            id: post.author.id,
            firstName: post.author.firstName,
            lastName: post.author.lastName,
            avatarUrl: post.author.avatarUrl,
            handle: post.author.handle,
          }
        : null,
      group:
        options.includeGroup && post.group
          ? {
              id: post.group.id,
              name: post.group.name,
              logoUrl: post.group.logoUrl,
            }
          : null,
    }));
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
          attributes: USER_SAFE_ATTRIBUTES,
        },
      ],
    });
    if (!post) throw new NotFoundException(apiError('post.notFound'));

    const [reactionCount, commentCount, myReaction, workouts] =
      await Promise.all([
        this.reactionModel.count({ where: { postId } }),
        this.commentModel.count({ where: { postId } }),
        this.reactionModel.findOne({ where: { postId, authorId: userId } }),
        this.workoutLogService.summariesForPosts(
          post.workoutLogId ? [post.workoutLogId] : [],
        ),
      ]);

    return {
      id: post.id,
      authorId: post.authorId,
      groupId: post.groupId,
      approvalState: post.approvalState,
      content: post.content,
      mediaUrls: post.mediaUrls,
      postedAt: post.postedAt,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      reactionCount,
      commentCount,
      myReaction: myReaction?.reactionType ?? null,
      workout: (post.workoutLogId && workouts.get(post.workoutLogId)) || null,
      author: post.author
        ? {
            id: post.author.id,
            firstName: post.author.firstName,
            lastName: post.author.lastName,
            avatarUrl: post.author.avatarUrl,
            handle: post.author.handle,
          }
        : null,
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
}
