import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UniqueConstraintError, ValidationErrorItem } from 'sequelize';

import { PostService } from './post.service';
import { Post, PostApprovalState } from './entities/post.entity';
import { PostComment } from './entities/post-comment.entity';
import { PostReaction } from './entities/post-reaction.entity';
import { Group, MemberPostPolicy } from '../group/entities/group.entity';
import {
  GroupMember,
  GroupMemberRole,
} from '../group/entities/group-member.entity';
import { User } from '../user/entities/user.entity';
import { ModerationDecision } from './dto/moderate-post.dto';
import { SearchIndexService } from '../search/search-index.service';
import { NotificationService } from '../notification/notification.service';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { GroupService } from '../group/group.service';
import { WorkoutLogService } from '../workout/workout-log.service';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

interface PostModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  findByPk: jest.Mock;
  findOne: jest.Mock;
  findAll: jest.Mock;
  findAndCountAll: jest.Mock;
}

interface CommentModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  findAll: jest.Mock;
  findByPk: jest.Mock;
  findAndCountAll: jest.Mock;
  count: jest.Mock;
  update: jest.Mock;
  destroy: jest.Mock;
}

interface ReactionModelMock {
  sequelize: { transaction: jest.Mock };
  create: jest.Mock;
  findAll: jest.Mock;
  findOne: jest.Mock;
  count: jest.Mock;
  destroy: jest.Mock;
}

interface GroupModelMock {
  sequelize: { transaction: jest.Mock };
  findAll: jest.Mock;
  findByPk: jest.Mock;
}

interface MemberModelMock {
  sequelize: { transaction: jest.Mock };
  findOne: jest.Mock;
  findAll: jest.Mock;
}

interface UserModelMock {
  findByPk: jest.Mock;
}

describe('PostService', () => {
  let service: PostService;
  let postModel: PostModelMock;
  let commentModel: CommentModelMock;
  let reactionModel: ReactionModelMock;
  let groupModel: GroupModelMock;
  let memberModel: MemberModelMock;
  let userModel: UserModelMock;
  let searchIndex: { upsertPost: jest.Mock; removeIfExists: jest.Mock };
  let notificationService: { notify: jest.Mock; notifyMany: jest.Mock };
  let cloudinaryService: {
    isOwnedUrl: jest.Mock;
    assertOwnedUrls: jest.Mock;
    extractPublicId: jest.Mock;
    deleteByUrl: jest.Mock;
    cloneByUrl: jest.Mock;
    buildPostFolder: jest.Mock;
    deleteFolder: jest.Mock;
  };
  let groupService: { findMyGroupIds: jest.Mock };
  // Ordinary posts carry no workout; the cases that do set it up themselves.
  const workoutLogService = {
    summariesForPosts: jest.fn().mockResolvedValue(new Map()),
    assertShareable: jest.fn().mockResolvedValue(undefined),
  };

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
      findOne: jest.fn(),
      findAll: jest.fn(),
      findAndCountAll: jest.fn(),
    };
    commentModel = {
      sequelize,
      create: jest.fn(),
      findAll: jest.fn(),
      findByPk: jest.fn(),
      findAndCountAll: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue([0]),
      destroy: jest.fn().mockResolvedValue(0),
    };
    reactionModel = {
      sequelize,
      create: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      destroy: jest.fn().mockResolvedValue(0),
    };
    groupModel = {
      sequelize,
      findAll: jest.fn().mockResolvedValue([]),
      findByPk: jest.fn().mockResolvedValue({ id: 'g1', name: 'Test group' }),
    };
    memberModel = { sequelize, findOne: jest.fn(), findAll: jest.fn() };
    userModel = {
      findByPk: jest
        .fn()
        .mockResolvedValue({ id: 'u', firstName: 'Test', lastName: 'User' }),
    };
    searchIndex = {
      upsertPost: jest.fn().mockResolvedValue(undefined),
      removeIfExists: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = {
      notify: jest.fn().mockResolvedValue(undefined),
      notifyMany: jest.fn().mockResolvedValue(undefined),
    };
    cloudinaryService = {
      isOwnedUrl: jest.fn().mockReturnValue(true),
      assertOwnedUrls: jest.fn(),
      extractPublicId: jest.fn().mockReturnValue('mock-id'),
      deleteByUrl: jest.fn().mockResolvedValue(undefined),
      cloneByUrl: jest
        .fn()
        .mockImplementation((src: string) =>
          Promise.resolve({ url: `${src}#cloned`, publicId: 'cloned-id' }),
        ),
      buildPostFolder: jest
        .fn()
        .mockImplementation(
          (uid: string, pid: string) =>
            `motionhive/development/posts/${uid}/${pid}`,
        ),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
    };
    groupService = {
      findMyGroupIds: jest.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        PostService,
        { provide: getModelToken(Post), useValue: postModel },
        { provide: getModelToken(PostComment), useValue: commentModel },
        { provide: getModelToken(PostReaction), useValue: reactionModel },
        { provide: getModelToken(Group), useValue: groupModel },
        { provide: getModelToken(GroupMember), useValue: memberModel },
        { provide: getModelToken(User), useValue: userModel },
        { provide: SearchIndexService, useValue: searchIndex },
        { provide: NotificationService, useValue: notificationService },
        { provide: CloudinaryService, useValue: cloudinaryService },
        { provide: GroupService, useValue: groupService },
        { provide: WorkoutLogService, useValue: workoutLogService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(PostService);
  });

  // ─────────────── createPost ───────────────

  describe('createPost (fan-out)', () => {
    const authorId = 'user-1';

    function mockHydrate(postId: string, groupId: string) {
      postModel.findByPk.mockResolvedValueOnce({
        id: postId,
        authorId,
        groupId,
        approvalState: PostApprovalState.APPROVED,
        content: 'hi',
        mediaUrls: null,
        postedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        author: null,
      });
    }

    it('fans out to N independent posts when posting to N groups', async () => {
      const dto = { content: 'hello', groupIds: ['g1', 'g2', 'g3'] };
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
        { id: 'g2', memberPostPolicy: MemberPostPolicy.OPEN },
        { id: 'g3', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.OWNER },
        { groupId: 'g2', userId: authorId, role: GroupMemberRole.OWNER },
        { groupId: 'g3', userId: authorId, role: GroupMemberRole.OWNER },
      ]);
      let i = 1;
      postModel.create.mockImplementation(() => {
        const n = i++;
        return Promise.resolve({
          id: `post-${n}`,
          groupId: `g${n}`,
          approvalState: PostApprovalState.APPROVED,
          update: jest.fn().mockResolvedValue(undefined),
        });
      });
      mockHydrate('post-1', 'g1');
      mockHydrate('post-2', 'g2');
      mockHydrate('post-3', 'g3');

      const result = await service.createPost(authorId, dto);

      expect(postModel.create).toHaveBeenCalledTimes(3);
      expect(result.posts).toHaveLength(3);
    });

    it('shares a finished workout into the group as a card', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.MEMBER },
      ]);
      postModel.create.mockResolvedValue({
        id: 'post-1',
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
        update: jest.fn().mockResolvedValue(undefined),
      });
      postModel.findByPk.mockResolvedValueOnce({
        id: 'post-1',
        authorId,
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
        content: '',
        mediaUrls: null,
        workoutLogId: 'wl-1',
        postedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        author: null,
      });
      const card = {
        id: 'wl-1',
        name: 'Leg day',
        completedAt: new Date(),
        durationSeconds: 3134,
        setsCompleted: 18,
        recordCount: 1,
        shareCaption: null,
        onProfile: false,
      };
      workoutLogService.summariesForPosts.mockResolvedValueOnce(
        new Map([['wl-1', card]]),
      );

      // No words needed: the card says enough.
      const result = await service.createPost(authorId, {
        content: '',
        groupIds: ['g1'],
        workoutLogId: 'wl-1',
      });

      expect(workoutLogService.assertShareable).toHaveBeenCalledWith(
        'wl-1',
        authorId,
      );
      expect(postModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ workoutLogId: 'wl-1', content: '' }),
        expect.anything(),
      );
      expect(result.posts[0].workout).toEqual(card);
    });

    it("refuses someone else's workout before any post is made", async () => {
      workoutLogService.assertShareable.mockRejectedValueOnce(
        new NotFoundException(),
      );
      await expect(
        service.createPost(authorId, {
          content: 'look',
          groupIds: ['g1'],
          workoutLogId: 'wl-theirs',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(postModel.create).not.toHaveBeenCalled();
    });

    it('staff post is APPROVED even when policy=DISABLED', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.DISABLED },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.OWNER },
      ]);
      postModel.create.mockResolvedValue({
        id: 'post-1',
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
        update: jest.fn().mockResolvedValue(undefined),
      });
      mockHydrate('post-1', 'g1');

      await service.createPost(authorId, { content: 'x', groupIds: ['g1'] });

      expect(postModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'g1',
          approvalState: PostApprovalState.APPROVED,
        }),
        expect.anything(),
      );
    });

    it('member post in APPROVAL_REQUIRED group lands in PENDING and notifies staff', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.APPROVAL_REQUIRED },
      ]);
      memberModel.findAll
        // resolveCreateSpecs membership lookup
        .mockResolvedValueOnce([
          { groupId: 'g1', userId: authorId, role: GroupMemberRole.MEMBER },
        ])
        // notifyAuthorsForPending staff lookup
        .mockResolvedValueOnce([
          { groupId: 'g1', userId: 'owner-1', role: GroupMemberRole.OWNER },
        ]);
      postModel.create.mockResolvedValue({
        id: 'post-1',
        groupId: 'g1',
        approvalState: PostApprovalState.PENDING,
        update: jest.fn().mockResolvedValue(undefined),
      });
      mockHydrate('post-1', 'g1');

      await service.createPost(authorId, { content: 'x', groupIds: ['g1'] });

      expect(notificationService.notifyMany).toHaveBeenCalledWith(
        ['owner-1'],
        expect.objectContaining({ type: 'POST_PENDING_APPROVAL' }),
      );
    });

    it('rejects MEMBER posting in a DISABLED group BEFORE creating any post', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
        { id: 'g2', memberPostPolicy: MemberPostPolicy.DISABLED },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.MEMBER },
        { groupId: 'g2', userId: authorId, role: GroupMemberRole.MEMBER },
      ]);

      await expect(
        service.createPost(authorId, {
          content: 'x',
          groupIds: ['g1', 'g2'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(postModel.create).not.toHaveBeenCalled();
    });

    it('rejects when caller is not a member of any target group', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([]);

      await expect(
        service.createPost(authorId, { content: 'x', groupIds: ['g1'] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate groupIds', async () => {
      await expect(
        service.createPost(authorId, { content: 'x', groupIds: ['g1', 'g1'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects mediaUrls that fail Cloudinary whitelist before any DB read', async () => {
      cloudinaryService.assertOwnedUrls.mockImplementationOnce(() => {
        throw new BadRequestException('mediaUrls must be Cloudinary URLs');
      });

      await expect(
        service.createPost(authorId, {
          content: 'x',
          groupIds: ['g1'],
          mediaUrls: ['https://evil.example.com/a.png'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(groupModel.findAll).not.toHaveBeenCalled();
    });

    it('clones each staging image into the per-post folder, then deletes staging', async () => {
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.OWNER },
      ]);
      const updateSpy = jest.fn().mockResolvedValue(undefined);
      postModel.create.mockResolvedValue({
        id: 'post-1',
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
        update: updateSpy,
      });
      mockHydrate('post-1', 'g1');

      await service.createPost(authorId, {
        content: 'x',
        groupIds: ['g1'],
        mediaUrls: ['https://res.cloudinary.com/c/image/upload/staging.png'],
      });

      expect(cloudinaryService.cloneByUrl).toHaveBeenCalledWith(
        'https://res.cloudinary.com/c/image/upload/staging.png',
        expect.objectContaining({
          resource: 'posts',
          userId: authorId,
          postId: 'post-1',
        }),
      );
      expect(updateSpy).toHaveBeenCalledWith({
        mediaUrls: [
          'https://res.cloudinary.com/c/image/upload/staging.png#cloned',
        ],
      });
      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith(
        'https://res.cloudinary.com/c/image/upload/staging.png',
      );
    });
  });

  // ─────────────── updatePost ───────────────

  describe('author projection', () => {
    // Posts hand-pick the author fields rather than passing the row through,
    // and `handle` was left out — so the same person was a tappable profile
    // link under a comment and inert above it.
    it('carries the author handle, the way comments already do', async () => {
      const authorId = 'user-1';
      groupModel.findAll.mockResolvedValue([
        { id: 'g1', memberPostPolicy: MemberPostPolicy.OPEN },
      ]);
      memberModel.findAll.mockResolvedValue([
        { groupId: 'g1', userId: authorId, role: GroupMemberRole.OWNER },
      ]);
      postModel.create.mockResolvedValue({ id: 'p1' });
      postModel.findByPk.mockResolvedValueOnce({
        id: 'p1',
        authorId,
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
        content: 'hi',
        mediaUrls: null,
        postedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        author: {
          id: authorId,
          firstName: 'Anna',
          lastName: 'Popescu',
          avatarUrl: null,
          handle: 'annapopescu',
        },
      });

      const result = await service.createPost(authorId, {
        content: 'hi',
        groupIds: ['g1'],
      });

      expect(result.posts[0].author?.handle).toBe('annapopescu');
    });
  });

  describe('updatePost', () => {
    const authorId = 'user-1';
    const postId = 'post-1';

    it('purges only orphaned URLs on edit', async () => {
      const post = {
        id: postId,
        authorId,
        mediaUrls: [
          'https://res.cloudinary.com/c/image/upload/v1/a.png',
          'https://res.cloudinary.com/c/image/upload/v1/b.png',
        ],
        update: jest.fn().mockResolvedValue(undefined),
      };
      postModel.findByPk.mockResolvedValue(post);

      await service.updatePost(authorId, postId, {
        mediaUrls: ['https://res.cloudinary.com/c/image/upload/v1/b.png'],
      });

      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledTimes(1);
      expect(cloudinaryService.deleteByUrl).toHaveBeenCalledWith(
        'https://res.cloudinary.com/c/image/upload/v1/a.png',
      );
    });

    it('rejects edits from non-author', async () => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        authorId: 'other',
      });
      await expect(
        service.updatePost(authorId, postId, { content: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─────────────── deletePost ───────────────

  describe('deletePost', () => {
    const authorId = 'user-1';
    const postId = 'post-1';

    function makeAlivePost(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: postId,
        authorId,
        groupId: 'g1',
        deletedAt: null,
        mediaUrls: ['https://res.cloudinary.com/c/image/upload/v1/a.png'],
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('idempotent on already-soft-deleted post', async () => {
      postModel.findOne.mockResolvedValue({
        ...makeAlivePost(),
        deletedAt: new Date(),
      });

      const result = await service.deletePost(authorId, postId);

      expect(result).toEqual({ deleted: true });
      expect(cloudinaryService.deleteFolder).not.toHaveBeenCalled();
    });

    it('author can delete own post — tombstones, cascades, purges Cloudinary folder', async () => {
      const post = makeAlivePost();
      postModel.findOne.mockResolvedValue(post);

      await service.deletePost(authorId, postId);

      expect(commentModel.update).toHaveBeenCalledWith(
        { content: '[deleted]' },
        expect.objectContaining({ where: { postId } }),
      );
      expect(commentModel.destroy).toHaveBeenCalled();
      expect(reactionModel.destroy).toHaveBeenCalled();
      expect(post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '[deleted]',
          mediaUrls: null,
        }),
        expect.anything(),
      );
      expect(post.destroy).toHaveBeenCalled();
      expect(cloudinaryService.deleteFolder).toHaveBeenCalledWith(
        `motionhive/development/posts/${authorId}/${postId}`,
      );
    });

    it('non-author non-staff is rejected', async () => {
      postModel.findOne.mockResolvedValue(makeAlivePost({ authorId: 'other' }));
      memberModel.findOne.mockResolvedValue(null);

      await expect(service.deletePost(authorId, postId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('group moderator can delete any post in their group', async () => {
      const post = makeAlivePost({ authorId: 'other' });
      postModel.findOne.mockResolvedValue(post);
      memberModel.findOne.mockResolvedValue({
        userId: authorId,
        groupId: 'g1',
        role: GroupMemberRole.MODERATOR,
        leftAt: null,
      });

      await service.deletePost(authorId, postId);

      expect(post.destroy).toHaveBeenCalled();
    });
  });

  // ─────────────── moderatePost ───────────────

  describe('moderatePost', () => {
    const userId = 'mod-1';
    const postId = 'post-1';

    it('approving flips state to APPROVED and notifies author', async () => {
      const post = {
        id: postId,
        authorId: 'author-1',
        groupId: 'g1',
        approvalState: PostApprovalState.PENDING,
        update: jest.fn().mockResolvedValue(undefined),
      };
      postModel.findByPk.mockResolvedValue(post);
      memberModel.findOne.mockResolvedValue({
        userId,
        groupId: 'g1',
        role: GroupMemberRole.OWNER,
        leftAt: null,
      });

      await service.moderatePost(userId, postId, {
        decision: ModerationDecision.APPROVED,
      });

      expect(post.update).toHaveBeenCalledWith({
        approvalState: PostApprovalState.APPROVED,
      });
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'author-1',
          type: 'POST_APPROVED',
        }),
      );
    });

    it('rejecting destroys the post and purges its assets', async () => {
      const post = {
        id: postId,
        authorId: 'author-1',
        groupId: 'g1',
        approvalState: PostApprovalState.PENDING,
        mediaUrls: ['https://res.cloudinary.com/c/image/upload/v1/a.png'],
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      postModel.findByPk.mockResolvedValue(post);
      memberModel.findOne.mockResolvedValue({
        userId,
        groupId: 'g1',
        role: GroupMemberRole.OWNER,
        leftAt: null,
      });

      await service.moderatePost(userId, postId, {
        decision: ModerationDecision.REJECTED,
      });

      expect(post.destroy).toHaveBeenCalled();
      expect(cloudinaryService.deleteFolder).toHaveBeenCalled();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'POST_REJECTED' }),
      );
    });

    it('rejects when post is already approved', async () => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
      });
      memberModel.findOne.mockResolvedValue({
        userId,
        groupId: 'g1',
        role: GroupMemberRole.OWNER,
        leftAt: null,
      });

      await expect(
        service.moderatePost(userId, postId, {
          decision: ModerationDecision.APPROVED,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────── addComment ───────────────

  describe('addComment', () => {
    const userId = 'user-1';
    const postId = 'post-1';

    beforeEach(() => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        authorId: 'author-2',
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
      });
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

    it('allows a top-level comment and notifies the post author', async () => {
      await service.addComment(userId, postId, { content: 'hello' });
      expect(commentModel.create).toHaveBeenCalled();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'POST_NEW_COMMENT',
          userId: 'author-2',
        }),
      );
    });

    it('rejects a reply to a reply', async () => {
      commentModel.findByPk.mockResolvedValueOnce({
        id: 'reply-1',
        postId,
        parentCommentId: 'parent-1',
      });
      await expect(
        service.addComment(userId, postId, {
          content: 'too deep',
          parentCommentId: 'reply-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a parent comment from a different post', async () => {
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

    it('rejects when post is not APPROVED', async () => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        groupId: 'g1',
        approvalState: PostApprovalState.PENDING,
      });
      await expect(
        service.addComment(userId, postId, { content: 'x' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does NOT notify when commenter is the post author', async () => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        authorId: userId,
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
      });
      await service.addComment(userId, postId, { content: 'self' });
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  // ─────────────── deleteComment ───────────────

  describe('deleteComment', () => {
    const userId = 'user-1';
    const commentId = 'c-top';
    const postId = 'post-1';

    it('tombstones + cascades replies for top-level author delete', async () => {
      const comment = {
        id: commentId,
        postId,
        authorId: userId,
        parentCommentId: null,
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      commentModel.findByPk.mockResolvedValue(comment);

      await service.deleteComment(userId, commentId);

      expect(commentModel.update).toHaveBeenCalledWith(
        { content: '[deleted]' },
        expect.objectContaining({
          where: { parentCommentId: commentId },
        }),
      );
      expect(commentModel.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { parentCommentId: commentId },
        }),
      );
      expect(comment.update).toHaveBeenCalled();
      expect(comment.destroy).toHaveBeenCalled();
    });

    it('does NOT cascade replies when deleting a reply', async () => {
      const reply = {
        id: 'reply-1',
        postId,
        authorId: userId,
        parentCommentId: commentId,
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      commentModel.findByPk.mockResolvedValue(reply);

      await service.deleteComment(userId, 'reply-1');

      expect(commentModel.update).not.toHaveBeenCalled();
      expect(commentModel.destroy).not.toHaveBeenCalled();
      expect(reply.destroy).toHaveBeenCalled();
    });

    it('rejects non-author non-staff', async () => {
      commentModel.findByPk.mockResolvedValue({
        id: commentId,
        postId,
        authorId: 'other-user',
        parentCommentId: null,
      });
      postModel.findByPk.mockResolvedValue({
        id: postId,
        groupId: 'g1',
      });
      memberModel.findOne.mockResolvedValue(null);

      await expect(service.deleteComment(userId, commentId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows staff non-author to delete', async () => {
      const comment = {
        id: commentId,
        postId,
        authorId: 'other-user',
        parentCommentId: null,
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      commentModel.findByPk.mockResolvedValue(comment);
      postModel.findByPk.mockResolvedValue({ id: postId, groupId: 'g1' });
      memberModel.findOne.mockResolvedValue({
        userId,
        groupId: 'g1',
        role: GroupMemberRole.MODERATOR,
        leftAt: null,
      });

      await service.deleteComment(userId, commentId);

      expect(comment.destroy).toHaveBeenCalled();
    });
  });

  // ─────────────── toggleReaction ───────────────

  describe('toggleReaction', () => {
    const userId = 'user-1';
    const postId = 'post-1';

    beforeEach(() => {
      postModel.findByPk.mockResolvedValue({
        id: postId,
        groupId: 'g1',
        approvalState: PostApprovalState.APPROVED,
      });
      memberModel.findOne.mockResolvedValue({ userId, groupId: 'g1' });
    });

    it('adds a reaction when none exists', async () => {
      reactionModel.findOne.mockResolvedValue(null);
      reactionModel.count.mockResolvedValue(1);
      const result = await service.toggleReaction(userId, postId, {});
      expect(reactionModel.create).toHaveBeenCalled();
      expect(result).toEqual({ reacted: true, count: 1 });
    });

    it('removes a reaction on toggle-off', async () => {
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

    it('treats UniqueConstraintError as idempotent toggle-on', async () => {
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
