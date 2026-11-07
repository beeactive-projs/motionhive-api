import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  buildPaginatedResponse,
  getOffset,
} from '../../../common/dto/pagination.dto';
import { Op, type WhereOptions } from 'sequelize';
import { Post } from '../../post/entities/post.entity';
import { Review } from '../../review/entities/review.entity';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { Waitlist } from '../../waitlist/entities/waitlist.entity';
import { AdminListDto } from '../dto/admin-list.dto';
import { AdminAuditService } from './admin-audit.service';
import {
  ListWorkoutReportsDto,
  ResolveWorkoutReportDto,
} from '../../workout/dto/resolve-workout-report.dto';
import { WorkoutReportService } from '../../workout/workout-report.service';
import { WorkoutPhotoService } from '../../workout/workout-photo.service';

const AUTHOR_BRIEF = ['id', 'email', 'firstName', 'lastName'];

/**
 * Content moderation (cross-tenant). Posts and reviews can be listed and
 * soft-deleted (hidden); reported workouts are reviewed and taken down.
 * Feedback, waitlist and blog reuse their existing admin endpoints, so
 * they aren't duplicated here.
 */
@Injectable()
export class AdminContentService {
  constructor(
    @InjectModel(Post) private readonly postModel: typeof Post,
    @InjectModel(Review) private readonly reviewModel: typeof Review,
    @InjectModel(Feedback) private readonly feedbackModel: typeof Feedback,
    @InjectModel(Waitlist) private readonly waitlistModel: typeof Waitlist,
    private readonly audit: AdminAuditService,
    private readonly workoutReports: WorkoutReportService,
    private readonly workoutPhotos: WorkoutPhotoService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async listPosts(dto: AdminListDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const { rows, count } = await this.postModel.findAndCountAll({
      paranoid: !dto.includeDeleted,
      include: [{ association: 'author', attributes: AUTHOR_BRIEF }],
      limit,
      offset: getOffset(page, limit),
      order: [['createdAt', 'DESC']],
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async deletePost(adminId: string, id: string, ip: string | null) {
    const post = await this.postModel.findByPk(id);
    if (!post) throw new NotFoundException('Post not found');
    await post.destroy();
    await this.audit.record({
      adminUserId: adminId,
      action: 'content.post.delete',
      targetType: 'post',
      targetId: id,
      ip,
    });
    this.logger.log(
      `Admin ${adminId} soft-deleted post ${id}`,
      'AdminContentService',
    );
    return { id, deleted: true };
  }

  listWorkoutReports(dto: ListWorkoutReportsDto) {
    return this.workoutReports.list(dto.page ?? 1, dto.limit ?? 20, dto.status);
  }

  async resolveWorkoutReport(
    adminId: string,
    id: string,
    dto: ResolveWorkoutReportDto,
    ip: string | null,
  ) {
    const row = await this.workoutReports.resolve(adminId, id, dto);
    await this.audit.record({
      adminUserId: adminId,
      action: dto.takeDown
        ? 'content.workout.takedown'
        : 'content.workout_report.resolve',
      targetType: 'workout_report',
      targetId: id,
      meta: { status: dto.status, workoutLogId: row.workoutLogId },
      ip,
    });
    return row;
  }

  /**
   * The photo of a reported workout, for the person reviewing the report.
   * Every view is written to the audit log: it is a private photo, seen
   * only because someone reported it.
   */
  async workoutReportPhoto(
    adminId: string,
    id: string,
    ip: string | null,
  ): Promise<Buffer> {
    const workoutLogId = await this.workoutReports.reportedWorkoutId(id);
    const bytes = await this.workoutPhotos.photoForReview(workoutLogId);
    await this.audit.record({
      adminUserId: adminId,
      action: 'content.workout_photo.view',
      targetType: 'workout_log',
      targetId: workoutLogId,
      meta: { reportId: id },
      ip,
    });
    return bytes;
  }

  async listFeedback(dto: AdminListDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const where: WhereOptions<Feedback> = dto.q?.trim()
      ? ({
          [Op.or]: [
            { title: { [Op.iLike]: `%${dto.q.trim()}%` } },
            { email: { [Op.iLike]: `%${dto.q.trim()}%` } },
            { type: { [Op.iLike]: `%${dto.q.trim()}%` } },
          ],
        } as WhereOptions<Feedback>)
      : {};
    const { rows, count } = await this.feedbackModel.findAndCountAll({
      where,
      limit,
      offset: getOffset(page, limit),
      order: [['createdAt', 'DESC']],
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async listWaitlist(dto: AdminListDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const where: WhereOptions<Waitlist> = dto.q?.trim()
      ? ({
          [Op.or]: [
            { email: { [Op.iLike]: `%${dto.q.trim()}%` } },
            { name: { [Op.iLike]: `%${dto.q.trim()}%` } },
            { source: { [Op.iLike]: `%${dto.q.trim()}%` } },
          ],
        } as WhereOptions<Waitlist>)
      : {};
    const { rows, count } = await this.waitlistModel.findAndCountAll({
      where,
      limit,
      offset: getOffset(page, limit),
      order: [['createdAt', 'DESC']],
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async listReviews(dto: AdminListDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const { rows, count } = await this.reviewModel.findAndCountAll({
      paranoid: !dto.includeDeleted,
      include: [{ association: 'author', attributes: AUTHOR_BRIEF }],
      limit,
      offset: getOffset(page, limit),
      order: [['createdAt', 'DESC']],
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async deleteReview(adminId: string, id: string, ip: string | null) {
    const review = await this.reviewModel.findByPk(id);
    if (!review) throw new NotFoundException('Review not found');
    await review.destroy();
    await this.audit.record({
      adminUserId: adminId,
      action: 'content.review.delete',
      targetType: 'review',
      targetId: id,
      ip,
    });
    this.logger.log(
      `Admin ${adminId} soft-deleted review ${id}`,
      'AdminContentService',
    );
    return { id, deleted: true };
  }
}
