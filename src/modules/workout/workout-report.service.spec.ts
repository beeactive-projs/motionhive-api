import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import {
  MessageReportCategory,
  MessageReportStatus,
} from '../messaging/entities/message-report.entity';
import { NotificationService } from '../notification/notification.service';
import { SearchIndexService } from '../search/search-index.service';
import { Post } from '../post/entities/post.entity';
import { PostComment } from '../post/entities/post-comment.entity';
import { PostReaction } from '../post/entities/post-reaction.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutReport } from './entities/workout-report.entity';
import { WorkoutVisibility } from './entities/workout.enums';
import { WorkoutReportService } from './workout-report.service';

describe('WorkoutReportService', () => {
  let service: WorkoutReportService;
  const reportModel = {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAndCountAll: jest.fn(),
    update: jest.fn().mockResolvedValue([0]),
  };
  const logModel = { findOne: jest.fn(), findByPk: jest.fn() };
  const postModel = { findAll: jest.fn() };
  const commentModel = {
    update: jest.fn().mockResolvedValue([0]),
    destroy: jest.fn().mockResolvedValue(0),
  };
  const reactionModel = { destroy: jest.fn().mockResolvedValue(0) };
  const linkedPost = (fields: Record<string, unknown>) => ({
    update: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...fields,
  });
  const notificationService = {
    notify: jest.fn().mockResolvedValue(undefined),
  };
  const searchIndexService = {
    removeIfExists: jest.fn().mockResolvedValue(undefined),
  };
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = {
    transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const report = (fields: Record<string, unknown> = {}) => {
    const row = {
      id: 'r-1',
      reporterId: 'reporter',
      ownerId: 'owner',
      workoutLogId: 'wl-1',
      category: MessageReportCategory.SEXUAL,
      status: MessageReportStatus.OPEN,
      resolutionNotes: null,
      resolvedById: null,
      resolvedAt: null,
      update: jest.fn().mockResolvedValue(undefined),
      get: () => ({ ...row, workoutLog: null }),
      ...fields,
    };
    return row;
  };

  const submit = (fields: Record<string, unknown> = {}) =>
    service.submit({
      reporterId: 'reporter',
      ownerId: 'owner',
      workoutLogId: 'wl-1',
      levels: [WorkoutVisibility.Public],
      category: MessageReportCategory.SPAM,
      ...fields,
    });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WorkoutReportService,
        { provide: getModelToken(WorkoutReport), useValue: reportModel },
        { provide: getModelToken(WorkoutLog), useValue: logModel },
        { provide: getModelToken(Post), useValue: postModel },
        { provide: getModelToken(PostComment), useValue: commentModel },
        { provide: getModelToken(PostReaction), useValue: reactionModel },
        { provide: NotificationService, useValue: notificationService },
        { provide: SearchIndexService, useValue: searchIndexService },
        { provide: Sequelize, useValue: sequelize },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: logger },
      ],
    }).compile();
    service = module.get(WorkoutReportService);
  });

  describe('submit', () => {
    it('files a report on a workout the reporter can see, with plain-text notes', async () => {
      logModel.findOne.mockResolvedValueOnce({ id: 'wl-1' });
      reportModel.create.mockResolvedValueOnce({
        id: 'r-1',
        status: MessageReportStatus.OPEN,
      });

      await expect(submit({ notes: '<b>Not</b> a workout' })).resolves.toEqual({
        id: 'r-1',
        status: MessageReportStatus.OPEN,
      });

      expect(logModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'wl-1',
            userId: 'owner',
            visibility: { [Op.in]: [WorkoutVisibility.Public] },
            takenDownAt: null,
          }),
        }),
      );
      expect(reportModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: 'Not a workout', ownerId: 'owner' }),
      );
    });

    it('is a 404 for a workout the reporter cannot see, so it confirms nothing', async () => {
      logModel.findOne.mockResolvedValueOnce(null);
      await expect(submit()).rejects.toMatchObject({
        response: { messageKey: 'workout.logNotFound' },
      });
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('refuses reporting your own workout', async () => {
      await expect(submit({ reporterId: 'owner' })).rejects.toMatchObject({
        response: { messageKey: 'workout.cannotReportOwn' },
      });
      expect(logModel.findOne).not.toHaveBeenCalled();
    });

    it('turns a second open report from the same person into a 409', async () => {
      logModel.findOne.mockResolvedValueOnce({ id: 'wl-1' });
      reportModel.create.mockRejectedValueOnce(new UniqueConstraintError({}));
      await expect(submit()).rejects.toMatchObject({
        status: 409,
        response: { messageKey: 'workout.reportAlreadyOpen' },
      });
    });
  });

  describe('resolve', () => {
    const log = (fields: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'owner',
      name: 'Leg day',
      takenDownAt: null,
      update: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });

    it('takes the workout down, closes its other reports and tells the owner after commit', async () => {
      const row = report();
      const workout = log();
      reportModel.findByPk
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(row);
      logModel.findByPk.mockResolvedValueOnce(workout);
      const empty = linkedPost({ id: 'p-empty', content: '', mediaUrls: null });
      const words = linkedPost({
        id: 'p-words',
        content: 'Felt strong',
        mediaUrls: null,
      });
      const photos = linkedPost({
        id: 'p-photos',
        content: ' ',
        mediaUrls: ['https://img'],
      });
      postModel.findAll.mockResolvedValueOnce([empty, words, photos]);

      await service.resolve('admin', 'r-1', {
        status: MessageReportStatus.RESOLVED,
        takeDown: true,
      });

      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MessageReportStatus.RESOLVED,
          takenDown: true,
          resolvedById: 'admin',
        }),
        { transaction: tx },
      );
      expect(workout.update).toHaveBeenCalledWith(
        { takenDownAt: expect.any(Date), visibility: WorkoutVisibility.OnlyMe },
        { transaction: tx },
      );
      expect(reportModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: MessageReportStatus.RESOLVED }),
        expect.objectContaining({
          where: expect.objectContaining({
            workoutLogId: 'wl-1',
            id: { [Op.ne]: 'r-1' },
          }),
        }),
      );
      // Only the post that was nothing but the workout goes, as any deleted
      // post does (comments and reactions with it), and leaves search.
      expect(empty.destroy).toHaveBeenCalledWith({ transaction: tx });
      expect(commentModel.destroy).toHaveBeenCalledWith({
        where: { postId: 'p-empty' },
        transaction: tx,
      });
      expect(reactionModel.destroy).toHaveBeenCalledWith({
        where: { postId: 'p-empty' },
        transaction: tx,
      });
      expect(words.destroy).not.toHaveBeenCalled();
      expect(photos.destroy).not.toHaveBeenCalled();
      expect(searchIndexService.removeIfExists).toHaveBeenCalledWith(
        'post',
        'p-empty',
      );
      expect(searchIndexService.removeIfExists).toHaveBeenCalledTimes(1);
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner',
          message: {
            key: 'workout.workoutTakenDown',
            params: {
              workout: 'Leg day',
              reason: MessageReportCategory.SEXUAL,
            },
          },
          data: { screen: 'user/workout-log', entityId: 'wl-1' },
        }),
      );
    });

    it('does not tell the owner twice when the workout was already down', async () => {
      const row = report();
      reportModel.findByPk
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(row);
      const workout = log({ takenDownAt: new Date('2026-10-01') });
      logModel.findByPk.mockResolvedValueOnce(workout);
      postModel.findAll.mockResolvedValueOnce([]);

      await service.resolve('admin', 'r-1', {
        status: MessageReportStatus.RESOLVED,
        takeDown: true,
      });

      expect(workout.update).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('dismisses without touching the workout', async () => {
      const row = report();
      reportModel.findByPk
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce(row);

      await service.resolve('admin', 'r-1', {
        status: MessageReportStatus.DISMISSED,
      });

      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MessageReportStatus.DISMISSED,
          takenDown: false,
        }),
        { transaction: tx },
      );
      expect(logModel.findByPk).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('only takes down together with resolving', async () => {
      await expect(
        service.resolve('admin', 'r-1', {
          status: MessageReportStatus.REVIEWING,
          takeDown: true,
        }),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.takeDownNeedsResolve' },
      });
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('keeps a closed report closed', async () => {
      reportModel.findByPk.mockResolvedValueOnce(
        report({ status: MessageReportStatus.DISMISSED }),
      );
      await expect(
        service.resolve('admin', 'r-1', {
          status: MessageReportStatus.RESOLVED,
        }),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.reportTransition' },
      });
    });
  });

  describe('list', () => {
    it('shows the photo as a flag, never its Cloudinary id', async () => {
      const row = {
        get: () => ({
          id: 'r-1',
          status: MessageReportStatus.OPEN,
          workoutLog: {
            id: 'wl-1',
            name: 'Leg day',
            completedAt: null,
            shareCaption: 'Felt strong',
            visibility: WorkoutVisibility.Public,
            photoPublicId: 'workout-photos/owner/wl-1',
            takenDownAt: null,
          },
        }),
      };
      reportModel.findAndCountAll.mockResolvedValueOnce({
        rows: [row],
        count: 1,
      });

      const page = await service.list(1, 20);

      expect(page.items[0].workoutLog).toEqual(
        expect.objectContaining({ id: 'wl-1', hasPhoto: true }),
      );
      expect(JSON.stringify(page)).not.toContain('workout-photos/owner');
    });
  });
});
