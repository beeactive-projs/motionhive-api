import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import {
  buildPaginatedResponse,
  getOffset,
  type PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { apiError } from '../../common/i18n';
import { stripHtml } from '../../common/utils/text.utils';
import {
  MessageReportCategory,
  MessageReportStatus,
} from '../messaging/entities/message-report.entity';
import { NotificationService } from '../notification/notification.service';
import { SearchIndexService } from '../search/search-index.service';
import { Post } from '../post/entities/post.entity';
import { PostComment } from '../post/entities/post-comment.entity';
import { PostReaction } from '../post/entities/post-reaction.entity';
import { destroyPostFully } from '../post/post-deletion';
import { USER_SAFE_ATTRIBUTES, User } from '../user/entities/user.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutReport } from './entities/workout-report.entity';
import { profileVisibleWhere } from './profile-visibility';
import { WorkoutVisibility } from './entities/workout.enums';
import { workoutTakenDownForOwner } from './notifications';

const STILL_OPEN = [MessageReportStatus.OPEN, MessageReportStatus.REVIEWING];

/** Where a report may go next; a closed report stays closed. */
const NEXT_STATUS: Record<MessageReportStatus, readonly MessageReportStatus[]> =
  {
    [MessageReportStatus.OPEN]: [
      MessageReportStatus.REVIEWING,
      MessageReportStatus.RESOLVED,
      MessageReportStatus.DISMISSED,
    ],
    [MessageReportStatus.REVIEWING]: [
      MessageReportStatus.RESOLVED,
      MessageReportStatus.DISMISSED,
    ],
    [MessageReportStatus.RESOLVED]: [],
    [MessageReportStatus.DISMISSED]: [],
  };

/** What staff see of a reported workout: what the public saw, and no more. */
const REPORTED_WORKOUT_ATTRIBUTES = [
  'id',
  'name',
  'completedAt',
  'shareCaption',
  'visibility',
  'photoPublicId',
  'takenDownAt',
];

export interface ReportWorkoutInput {
  reporterId: string;
  ownerId: string;
  workoutLogId: string;
  /** The levels the reporter may see on the owner's profile. */
  levels: readonly WorkoutVisibility[];
  category: MessageReportCategory;
  notes?: string;
}

/** The reported workout as staff see it: what the public saw, the photo as a flag. */
export interface ReportedWorkout {
  id: string;
  name: string;
  completedAt: Date | null;
  shareCaption: string | null;
  visibility: WorkoutVisibility;
  hasPhoto: boolean;
  takenDownAt: Date | null;
}

/** A report as the admin queue lists it. */
export type WorkoutReportRow = Pick<
  WorkoutReport,
  | 'id'
  | 'reporterId'
  | 'ownerId'
  | 'workoutLogId'
  | 'category'
  | 'notes'
  | 'status'
  | 'takenDown'
  | 'resolvedById'
  | 'resolvedAt'
  | 'resolutionNotes'
  | 'createdAt'
  | 'reporter'
  | 'owner'
> & { workoutLog: ReportedWorkout | null };

/**
 * Reports about workouts people show on their profiles, and taking one
 * down. A person reports what they can see; staff resolve or dismiss, and
 * a takedown removes the workout from public view for good while the
 * owner keeps it in their history.
 */
@Injectable()
export class WorkoutReportService {
  constructor(
    @InjectModel(WorkoutReport)
    private readonly reportModel: typeof WorkoutReport,
    @InjectModel(WorkoutLog) private readonly logModel: typeof WorkoutLog,
    @InjectModel(Post) private readonly postModel: typeof Post,
    @InjectModel(PostComment)
    private readonly commentModel: typeof PostComment,
    @InjectModel(PostReaction)
    private readonly reactionModel: typeof PostReaction,
    private readonly notificationService: NotificationService,
    private readonly searchIndexService: SearchIndexService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * File a report. The workout must be one the reporter can see on that
   * profile; anything else is a 404, so a report never confirms that a
   * hidden workout exists. A second open report from the same person is
   * a 409.
   */
  async submit(
    input: ReportWorkoutInput,
  ): Promise<{ id: string; status: MessageReportStatus }> {
    if (input.reporterId === input.ownerId) {
      throw new BadRequestException(apiError('workout.cannotReportOwn'));
    }
    const log = await this.logModel.findOne({
      where: {
        id: input.workoutLogId,
        ...profileVisibleWhere(input.ownerId, input.levels),
      },
      attributes: ['id'],
    });
    if (!log) throw new NotFoundException(apiError('workout.logNotFound'));

    const notes = input.notes ? stripHtml(input.notes, 1000) : '';
    try {
      const report = await this.reportModel.create({
        reporterId: input.reporterId,
        ownerId: input.ownerId,
        workoutLogId: log.id,
        category: input.category,
        notes: notes || null,
        status: MessageReportStatus.OPEN,
      });
      this.logger.log(
        `Workout report ${report.id} by ${input.reporterId} on ${log.id} (${input.category})`,
        'WorkoutReportService',
      );
      return { id: report.id, status: report.status };
    } catch (err) {
      // uk_workout_report_open: one open report per reporter and workout.
      if (err instanceof UniqueConstraintError) {
        throw new ConflictException(apiError('workout.reportAlreadyOpen'));
      }
      throw err;
    }
  }

  /** The queue: open and in-review reports first, newest first. */
  async list(
    page: number,
    limit: number,
    status?: MessageReportStatus,
  ): Promise<PaginatedResponse<WorkoutReportRow>> {
    const { rows, count } = await this.reportModel.findAndCountAll({
      where: status ? { status } : {},
      include: [
        { model: User, as: 'reporter', attributes: USER_SAFE_ATTRIBUTES },
        { model: User, as: 'owner', attributes: USER_SAFE_ATTRIBUTES },
        {
          model: WorkoutLog,
          as: 'workoutLog',
          attributes: REPORTED_WORKOUT_ATTRIBUTES,
        },
      ],
      order: [
        [
          Sequelize.literal(
            `CASE WHEN "WorkoutReport"."status" IN ('OPEN', 'REVIEWING') THEN 0 ELSE 1 END`,
          ),
          'ASC',
        ],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset: getOffset(page, limit),
      distinct: true,
    });
    return buildPaginatedResponse(rows.map(reportRow), count, page, limit);
  }

  /** The reported workout's id, for staff reading its photo. 404 if none. */
  async reportedWorkoutId(reportId: string): Promise<string> {
    const report = await this.reportModel.findByPk(reportId, {
      attributes: ['id', 'workoutLogId'],
    });
    if (!report)
      throw new NotFoundException(apiError('workout.reportNotFound'));
    return report.workoutLogId;
  }

  /**
   * Move a report on. With `takeDown`, in one transaction: the workout
   * drops to Only me and is stamped taken down, every other open report on
   * it closes with this one, and a group post that was nothing but this
   * workout goes (a post with words keeps them, without the card). The
   * owner is told why once it has committed.
   */
  async resolve(
    adminId: string,
    reportId: string,
    next: {
      status: MessageReportStatus;
      takeDown?: boolean;
      resolutionNotes?: string;
    },
  ): Promise<WorkoutReportRow> {
    const takeDown = next.takeDown === true;
    if (takeDown && next.status !== MessageReportStatus.RESOLVED) {
      throw new BadRequestException(apiError('workout.takeDownNeedsResolve'));
    }

    const outcome = await this.sequelize.transaction(async (tx) => {
      const report = await this.reportModel.findByPk(reportId, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!report)
        throw new NotFoundException(apiError('workout.reportNotFound'));
      if (!NEXT_STATUS[report.status].includes(next.status)) {
        throw new BadRequestException(apiError('workout.reportTransition'));
      }

      const closes =
        next.status === MessageReportStatus.RESOLVED ||
        next.status === MessageReportStatus.DISMISSED;
      const closing = {
        status: next.status,
        resolutionNotes: next.resolutionNotes ?? report.resolutionNotes,
        resolvedById: closes ? adminId : report.resolvedById,
        resolvedAt: closes ? new Date() : report.resolvedAt,
      };
      await report.update(
        { ...closing, takenDown: takeDown },
        { transaction: tx },
      );

      if (!takeDown)
        return { report, removedPostIds: [] as string[], takenDown: null };

      const log = await this.logModel.findByPk(report.workoutLogId, {
        attributes: ['id', 'userId', 'name', 'takenDownAt'],
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!log) throw new NotFoundException(apiError('workout.logNotFound'));
      const firstTakedown = !log.takenDownAt;
      if (firstTakedown) {
        await log.update(
          { takenDownAt: new Date(), visibility: WorkoutVisibility.OnlyMe },
          { transaction: tx },
        );
      }
      await this.reportModel.update(closing, {
        where: {
          workoutLogId: log.id,
          id: { [Op.ne]: report.id },
          status: { [Op.in]: STILL_OPEN },
        },
        transaction: tx,
      });
      const linked = await this.postModel.findAll({
        where: { workoutLogId: log.id },
        attributes: ['id', 'content', 'mediaUrls'],
        transaction: tx,
      });
      // Deleted as any post is, comments and reactions with it.
      const onlyTheWorkout = linked.filter(
        (post) => !post.content.trim() && !post.mediaUrls?.length,
      );
      for (const post of onlyTheWorkout) {
        await destroyPostFully(
          post,
          { comment: this.commentModel, reaction: this.reactionModel },
          tx,
        );
      }
      return {
        report,
        removedPostIds: onlyTheWorkout.map((post) => post.id),
        takenDown: firstTakedown
          ? { ownerId: log.userId, workoutLogId: log.id, workoutName: log.name }
          : null,
      };
    });

    // The posts that went with it leave search too, as a deleted post
    // does (PostService.afterPostFullyDeleted). Text only, so no media.
    for (const postId of outcome.removedPostIds ?? []) {
      await this.searchIndexService
        .removeIfExists('post', postId)
        .catch(() => undefined);
    }

    this.logger.log(
      `Workout report ${reportId} → ${next.status}${takeDown ? ' (taken down)' : ''} by ${adminId}`,
      'WorkoutReportService',
    );

    // notify-after-commit — notify() opens its own transaction.
    if (outcome.takenDown) {
      try {
        await this.notificationService.notify(
          workoutTakenDownForOwner({
            ...outcome.takenDown,
            category: outcome.report.category,
          }),
        );
      } catch (err) {
        this.logger.warn(
          `Failed to tell the owner about takedown of ${outcome.takenDown.workoutLogId}: ${(err as Error).message}`,
          'WorkoutReportService',
        );
      }
    }

    return this._row(outcome.report.id);
  }

  private async _row(id: string): Promise<WorkoutReportRow> {
    const report = await this.reportModel.findByPk(id, {
      include: [
        { model: User, as: 'reporter', attributes: USER_SAFE_ATTRIBUTES },
        { model: User, as: 'owner', attributes: USER_SAFE_ATTRIBUTES },
        {
          model: WorkoutLog,
          as: 'workoutLog',
          attributes: REPORTED_WORKOUT_ATTRIBUTES,
        },
      ],
    });
    if (!report)
      throw new NotFoundException(apiError('workout.reportNotFound'));
    return reportRow(report);
  }
}

/** A report with its workout as staff see it: the photo as a flag, never its id. */
function reportRow(report: WorkoutReport): WorkoutReportRow {
  const { workoutLog: log, ...plain } = report.get({
    plain: true,
  }) as WorkoutReport;
  return {
    ...plain,
    workoutLog: log
      ? {
          id: log.id,
          name: log.name,
          completedAt: log.completedAt,
          shareCaption: log.shareCaption,
          visibility: log.visibility,
          hasPhoto: !!log.photoPublicId,
          takenDownAt: log.takenDownAt,
        }
      : null,
  };
}
