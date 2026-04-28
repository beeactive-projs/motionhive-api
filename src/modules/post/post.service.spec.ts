import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UniqueConstraintError, ValidationErrorItem } from 'sequelize';

import { PostService } from './post.service';
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
import { SearchIndexService } from '../search/search-index.service';
import { NotificationService } from '../notification/notification.service';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

// Common shape for the Sequelize-model mocks below. Each test only
// uses a subset of these but typing them up-front kills the
// "unsafe any" lint cascade.
interface PostModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  findByPk: jest.Mock;
  findAll: jest.Mock;
}

interface AudienceModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  bulkCreate: jest.Mock;
  findAll: jest.Mock;
  findOne: jest.Mock;
}

interface CommentModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  findAll: jest.Mock;
  findByPk: jest.Mock;
  findAndCountAll: jest.Mock;
  count: jest.Mock;
}

interface ReactionModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  findAll: jest.Mock;
  findOne: jest.Mock;
  count: jest.Mock;
}

interface GroupModelMock {
  sequelize: { transaction: jest.Mock };
  findAll: jest.Mock;
}

interface MemberModelMock {
  sequelize: { transaction: jest.Mock };
  findOne: jest.Mock;
  findAll: jest.Mock;
}

// PostService — focused tests on the load-bearing paths:
//   - createPost across the three group policies + non-member rejection
//   - deletePost selective behavior (last-audience triggers post deletion)
//   - addComment parent-depth validation
//   - toggleReaction add/remove/race-idempotency
// Not exhaustive; the goal is to catch policy-level regressions.

describe('PostService', () => {
  let service: PostService;
  let postModel: PostModelMock;
  let audienceModel: AudienceModelMock;
  let commentModel: CommentModelMock;
  let reactionModel: ReactionModelMock;
  let groupModel: GroupModelMock;
  let memberModel: MemberModelMock;
  let searchIndex: { upsertPost: jest.Mock; removeIfExists: jest.Mock };
  let notificationService: { notify: jest.Mock; notifyMany: jest.Mock };

  const tx = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const sequelize = { transaction: jest.fn().mockResolvedValue(tx) };

  beforeEach(async () => {
    tx.commit.mockClear();
    tx.rollback.mockClear();
    sequelize.transaction.mockClear();

    postModel = {
      sequelize,
      create: jest.fn(),
      findByPk: jest.fn(),
      findAll: jest.fn(),
    };
    audienceModel = {
      sequelize,
      create: jest.fn(),
      bulkCreate: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
    };
    commentModel = {
      sequelize,
      create: jest.fn(),
      findAll: jest.fn(),
      findByPk: jest.fn(),
      findAndCountAll: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    reactionModel = {
      sequelize,
      create: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    groupModel = {
      sequelize,
      findAll: jest.fn(),
    };
    memberModel = {
      sequelize,
      findOne: jest.fn(),
      findAll: jest.fn(),
    };
    searchIndex = {
      upsertPost: jest.fn().mockResolvedValue(undefined),
      removeIfExists: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = {
      notify: jest.fn().mockResolvedValue(undefined),
      notifyMany: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        PostService,
        { provide: getModelToken(Post), useValue: postModel },
        { provide: getModelToken(PostAudience), useValue: audienceModel },
        { provide: getModelToken(PostComment), useValue: commentModel },
        { provide: getModelToken(PostReaction), useValue: reactionModel },
        { provide: getModelToken(Group), useValue: groupModel },
        { provide: getModelToken(GroupMember), useValue: memberModel },
        { provide: SearchIndexService, useValue: searchIndex },
        { provide: NotificationService, useValue: notificationService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(PostService);
  });

  // ─────────────── createPost ───────────────

  describe('createPost', () => {
    const authorId = 'user-1';
    const baseDto = { content: 'hi', groupIds: ['g1'] };

    function mockHydrate(postId: string) {
      // hydrateSingle hits findByPk(post) + counts. Provide enough stubs.
      postModel.findByPk.mockResolvedValue({
        id: postId,
        authorId,
        content: 'hi',
        mediaUrls: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        author: null,
        audiences: [],
      });
      reactionModel.count.mockResolvedValue(0);
      commentModel.count.mockResolvedValue(0);
      reactionModel.findOne.mockResolvedValue(null);
    }

    it('creates a post APPROVED when caller is OWNER even if policy=DISABLED', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.DISABLED },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.OWNER },
      ]);
      postModel.create.mockResolvedValue({ id: 'post-1' });
      mockHydrate('post-1');

      await service.createPost(authorId, baseDto);

      expect(audienceModel.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            audienceId: 'g1',
            approvalState: PostAudienceApproval.APPROVED,
          }),
        ],
        expect.anything(),
      );
      expect(notificationService.notifyMany).not.toHaveBeenCalled();
    });

    it('creates a post APPROVED when policy=OPEN and caller is MEMBER', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.MEMBER },
      ]);
      postModel.create.mockResolvedValue({ id: 'post-1' });
      mockHydrate('post-1');

      await service.createPost(authorId, baseDto);

      expect(audienceModel.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            approvalState: PostAudienceApproval.APPROVED,
          }),
        ],
        expect.anything(),
      );
    });

    it('creates a post PENDING when policy=APPROVAL_REQUIRED and caller is MEMBER', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.APPROVAL_REQUIRED },
      ]);
      memberModel.findAll
        .mockResolvedValueOnce([
          { groupId: 'g1', userId: authorId, role: GroupMemberRole.MEMBER },
        ])
        // Second call: notifyPendingApproval looks up the staff to notify.
        .mockResolvedValueOnce([
          { groupId: 'g1', userId: 'owner-1', role: GroupMemberRole.OWNER },
        ]);
      postModel.create.mockResolvedValue({ id: 'post-1' });
      mockHydrate('post-1');

      await service.createPost(authorId, baseDto);

      expect(audienceModel.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            approvalState: PostAudienceApproval.PENDING,
          }),
        ],
        expect.anything(),
      );
      expect(notificationService.notifyMany).toHaveBeenCalledWith(
        ['owner-1'],
        expect.objectContaining({
          type: 'POST_PENDING_APPROVAL',
        }),
      );
    });

    it('rejects MEMBER posting in a DISABLED group', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.DISABLED },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.MEMBER },
      ]);

      await expect(service.createPost(authorId, baseDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(postModel.create).not.toHaveBeenCalled();
    });

    it('rejects when caller is not a member of a target group', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([]); // no membership

      await expect(service.createPost(authorId, baseDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects duplicate groupIds', async () => {
      await expect(
        service.createPost(authorId, { content: 'x', groupIds: ['g1', 'g1'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────── deletePost — selective ───────────────

  describe('deletePost', () => {
    const authorId = 'user-1';
    const postId = 'post-1';

    function makeAudience(audienceId: string, deletedAt: Date | null = null) {
      return {
        id: `aud-${audienceId}`,
        postId,
        audienceType: PostAudienceType.GROUP,
        audienceId,
        deletedAt,
        destroy: jest.fn().mockResolvedValue(undefined),
      };
    }

    it('selective delete keeps the post when other audiences remain', async () => {
      const post = {
        id: postId,
        authorId,
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      const audA = makeAudience('g1');
      const audB = makeAudience('g2');
      postModel.findByPk.mockResolvedValue(post);
      audienceModel.findAll.mockResolvedValue([audA, audB]);

      const result = await service.deletePost(authorId, postId, {
        groupIds: ['g1'],
      });

      expect(audA.destroy).toHaveBeenCalled();
      expect(audB.destroy).not.toHaveBeenCalled();
      expect(post.destroy).not.toHaveBeenCalled();
      expect(searchIndex.upsertPost).toHaveBeenCalledWith(postId);
      expect(searchIndex.removeIfExists).not.toHaveBeenCalled();
      expect(result).toEqual({ post: 'kept', audiencesRemoved: 1 });
    });

    it('full delete (no groupIds) removes everything and soft-deletes the post', async () => {
      const post = {
        id: postId,
        authorId,
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      const audA = makeAudience('g1');
      const audB = makeAudience('g2');
      postModel.findByPk.mockResolvedValue(post);
      audienceModel.findAll.mockResolvedValue([audA, audB]);

      const result = await service.deletePost(authorId, postId, {});

      expect(audA.destroy).toHaveBeenCalled();
      expect(audB.destroy).toHaveBeenCalled();
      expect(post.destroy).toHaveBeenCalled();
      expect(searchIndex.removeIfExists).toHaveBeenCalledWith('post', postId);
      expect(result).toEqual({ post: 'deleted', audiencesRemoved: 2 });
    });

    it('removing the LAST audience auto-deletes the post', async () => {
      const post = {
        id: postId,
        authorId,
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      const audA = makeAudience('g1');
      postModel.findByPk.mockResolvedValue(post);
      audienceModel.findAll.mockResolvedValue([audA]);

      const result = await service.deletePost(authorId, postId, {
        groupIds: ['g1'],
      });

      expect(audA.destroy).toHaveBeenCalled();
      expect(post.destroy).toHaveBeenCalled();
      expect(result.post).toBe('deleted');
    });

    it('non-author non-moderator is rejected', async () => {
      const post = { id: postId, authorId: 'somebody-else' };
      postModel.findByPk.mockResolvedValue(post);
      audienceModel.findAll.mockResolvedValue([makeAudience('g1')]);
      memberModel.findAll.mockResolvedValue([]); // not a moderator anywhere

      await expect(service.deletePost(authorId, postId, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('moderator can delete from groups they moderate', async () => {
      const post = {
        id: postId,
        authorId: 'somebody-else',
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      const audA = makeAudience('g1');
      const audB = makeAudience('g2');
      postModel.findByPk.mockResolvedValue(post);
      audienceModel.findAll.mockResolvedValue([audA, audB]);
      // caller moderates g1 only
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.MODERATOR },
      ]);

      const result = await service.deletePost(authorId, postId, {});

      expect(audA.destroy).toHaveBeenCalled();
      expect(audB.destroy).not.toHaveBeenCalled();
      // Post survives because g2 still has it.
      expect(post.destroy).not.toHaveBeenCalled();
      expect(result).toEqual({ post: 'kept', audiencesRemoved: 1 });
    });
  });

  // ─────────────── addComment depth validation ───────────────

  describe('addComment', () => {
    const userId = 'user-1';
    const postId = 'post-1';

    beforeEach(() => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        authorId: 'author-2',
      });
      // assertCanViewPost: at least one APPROVED audience + active membership
      audienceModel.findAll.mockResolvedValue([
        {
          postId,
          audienceType: PostAudienceType.GROUP,
          audienceId: 'g1',
          approvalState: PostAudienceApproval.APPROVED,
        },
      ]);
      memberModel.findOne.mockResolvedValue({
        userId,
        groupId: 'g1',
        leftAt: null,
      });
      commentModel.create.mockResolvedValue({ id: 'c1' });
      commentModel.findByPk.mockResolvedValue({
        id: 'c1',
        author: { id: userId, firstName: 'A', lastName: 'B', avatarUrl: null },
      });
    });

    it('allows a top-level comment', async () => {
      await service.addComment(userId, postId, { content: 'hello' });
      expect(commentModel.create).toHaveBeenCalled();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'POST_NEW_COMMENT',
          userId: 'author-2',
        }),
      );
    });

    it('allows a 1-level reply', async () => {
      commentModel.findByPk
        .mockResolvedValueOnce({
          id: 'parent-1',
          postId,
          parentCommentId: null,
        })
        .mockResolvedValueOnce({
          id: 'c1',
          author: null,
        });
      await service.addComment(userId, postId, {
        content: 'reply',
        parentCommentId: 'parent-1',
      });
      expect(commentModel.create).toHaveBeenCalled();
    });

    it('rejects a reply to a reply (parent has its own parent)', async () => {
      commentModel.findByPk.mockResolvedValueOnce({
        id: 'reply-1',
        postId,
        parentCommentId: 'parent-1', // ← this is the depth-2 case
      });
      await expect(
        service.addComment(userId, postId, {
          content: 'too deep',
          parentCommentId: 'reply-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a reply pointing to a different post', async () => {
      commentModel.findByPk.mockResolvedValueOnce({
        id: 'parent-x',
        postId: 'other-post',
        parentCommentId: null,
      });
      await expect(
        service.addComment(userId, postId, {
          content: 'wrong post',
          parentCommentId: 'parent-x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does NOT notify when commenter is the post author', async () => {
      postModel.findByPk.mockResolvedValue({ id: postId, authorId: userId });
      await service.addComment(userId, postId, { content: 'self' });
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  // ─────────────── toggleReaction ───────────────

  describe('toggleReaction', () => {
    const userId = 'user-1';
    const postId = 'post-1';

    beforeEach(() => {
      postModel.findByPk.mockResolvedValue({ id: postId, authorId: 'a' });
      audienceModel.findAll.mockResolvedValue([
        {
          postId,
          audienceType: PostAudienceType.GROUP,
          audienceId: 'g1',
          approvalState: PostAudienceApproval.APPROVED,
        },
      ]);
      memberModel.findOne.mockResolvedValue({ userId, groupId: 'g1' });
    });

    it('adds a reaction when none exists', async () => {
      reactionModel.findOne.mockResolvedValue(null);
      reactionModel.count.mockResolvedValue(1);
      const result = await service.toggleReaction(userId, postId, {});
      expect(reactionModel.create).toHaveBeenCalled();
      expect(result).toEqual({ reacted: true, count: 1 });
    });

    it('removes a reaction when one already exists with the same type', async () => {
      const existing = {
        reactionType: 'LIKE',
        destroy: jest.fn().mockResolvedValue(undefined),
        update: jest.fn(),
      };
      reactionModel.findOne.mockResolvedValue(existing);
      reactionModel.count.mockResolvedValue(0);
      const result = await service.toggleReaction(userId, postId, {});
      expect(existing.destroy).toHaveBeenCalled();
      expect(result).toEqual({ reacted: false, count: 0 });
    });

    it('treats a unique-constraint race as idempotent toggle-on', async () => {
      reactionModel.findOne.mockResolvedValue(null);
      reactionModel.create.mockRejectedValueOnce(
        new UniqueConstraintError({
          errors: [] as ValidationErrorItem[],
          message: 'race',
        }),
      );
      reactionModel.count.mockResolvedValue(1);
      const result = await service.toggleReaction(userId, postId, {});
      expect(result).toEqual({ reacted: true, count: 1 });
    });
  });
});
