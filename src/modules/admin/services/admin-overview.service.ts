import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { User } from '../../user/entities/user.entity';
import { InstructorProfile } from '../../profile/entities/instructor-profile.entity';
import { Group } from '../../group/entities/group.entity';
import { SessionInstance } from '../../session/entities/session-instance.entity';
import { SessionInstanceStatus } from '../../session/entities/session.enums';
import {
  Subscription,
  SubscriptionStatus,
} from '../../payment/entities/subscription.entity';
import { Dispute } from '../../payment/entities/dispute.entity';
import {
  WebhookEvent,
  WebhookEventStatus,
} from '../../payment/entities/webhook-event.entity';
import {
  MessageReport,
  MessageReportStatus,
} from '../../messaging/entities/message-report.entity';
import { WorkoutReport } from '../../workout/entities/workout-report.entity';
import { Post } from '../../post/entities/post.entity';
import { Review } from '../../review/entities/review.entity';
import { Invoice } from '../../payment/entities/invoice.entity';
import { USER_SAFE_ATTRIBUTES } from '../../user/entities/user.entity';

/** Stripe dispute statuses that count as "needs attention". */
const OPEN_DISPUTE_STATUSES = [
  'warning_needs_response',
  'needs_response',
  'under_review',
  'warning_under_review',
];

/**
 * Platform-wide counts for the admin dashboard. Purely additive — does
 * NOT touch the in-use analytics platform-stats endpoint.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(InstructorProfile)
    private readonly instructorProfileModel: typeof InstructorProfile,
    @InjectModel(Group) private readonly groupModel: typeof Group,
    @InjectModel(SessionInstance)
    private readonly sessionInstanceModel: typeof SessionInstance,
    @InjectModel(Subscription)
    private readonly subscriptionModel: typeof Subscription,
    @InjectModel(Dispute) private readonly disputeModel: typeof Dispute,
    @InjectModel(WebhookEvent)
    private readonly webhookEventModel: typeof WebhookEvent,
    @InjectModel(MessageReport)
    private readonly messageReportModel: typeof MessageReport,
    @InjectModel(WorkoutReport)
    private readonly workoutReportModel: typeof WorkoutReport,
    @InjectModel(Post) private readonly postModel: typeof Post,
    @InjectModel(Review) private readonly reviewModel: typeof Review,
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
  ) {}

  async getOverview() {
    const [
      usersTotal,
      usersActive,
      usersDeleted,
      instructors,
      groups,
      sessionsTotal,
      sessionsCompleted,
      activeSubscriptions,
      openDisputes,
      failedWebhooks,
      openMessageReports,
      openWorkoutReports,
    ] = await Promise.all([
      this.userModel.count(),
      this.userModel.count({ where: { isActive: true } }),
      this.userModel.count({
        paranoid: false,
        where: { deletedAt: { [Op.ne]: null } },
      }),
      this.instructorProfileModel.count(),
      this.groupModel.count(),
      this.sessionInstanceModel.count(),
      this.sessionInstanceModel.count({
        where: { status: SessionInstanceStatus.Completed },
      }),
      this.subscriptionModel.count({
        where: {
          status: {
            [Op.in]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
          },
        },
      }),
      this.disputeModel.count({
        where: { status: { [Op.in]: OPEN_DISPUTE_STATUSES } },
      }),
      this.webhookEventModel.count({
        where: { status: WebhookEventStatus.FAILED },
      }),
      this.messageReportModel.count({
        where: {
          status: {
            [Op.in]: [MessageReportStatus.OPEN, MessageReportStatus.REVIEWING],
          },
        },
      }),
      this.workoutReportModel.count({
        where: {
          status: {
            [Op.in]: [MessageReportStatus.OPEN, MessageReportStatus.REVIEWING],
          },
        },
      }),
    ]);

    return {
      users: { total: usersTotal, active: usersActive, deleted: usersDeleted },
      instructors,
      groups,
      sessions: { total: sessionsTotal, completed: sessionsCompleted },
      payments: {
        activeSubscriptions,
        openDisputes,
        failedWebhooks,
      },
      moderation: { openMessageReports, openWorkoutReports },
    };
  }

  /**
   * Engagement insights for the dashboard. All queries are cheap COUNTs
   * over `created_at` / `last_login_at` ranges plus one tiny recent-list,
   * run in parallel — no joins, no scans of wide rows. (For very large
   * tables, back these `created_at` filters with an index; see the
   * future-work notes.)
   */
  async getInsights() {
    const now = Date.now();
    const since = (ms: number) => ({ [Op.gt]: new Date(now - ms) });
    const DAY = 86_400_000;
    const d1 = since(DAY);
    const d7 = since(7 * DAY);
    const d30 = since(30 * DAY);

    const createdWithin = (range: object) => ({ where: { createdAt: range } });

    const [
      signups1,
      signups7,
      signups30,
      active1,
      active7,
      recentSignups,
      newSessions7,
      newGroups7,
      newPosts7,
      newReviews7,
      newSubs7,
      newInvoices7,
    ] = await Promise.all([
      this.userModel.count(createdWithin(d1)),
      this.userModel.count(createdWithin(d7)),
      this.userModel.count(createdWithin(d30)),
      this.userModel.count({ where: { lastLoginAt: d1 } }),
      this.userModel.count({ where: { lastLoginAt: d7 } }),
      this.userModel.findAll({
        attributes: USER_SAFE_ATTRIBUTES,
        order: [['createdAt', 'DESC']],
        limit: 5,
      }),
      this.sessionInstanceModel.count(createdWithin(d7)),
      this.groupModel.count(createdWithin(d7)),
      this.postModel.count(createdWithin(d7)),
      this.reviewModel.count(createdWithin(d7)),
      this.subscriptionModel.count(createdWithin(d7)),
      this.invoiceModel.count(createdWithin(d7)),
    ]);

    return {
      signups: { last24h: signups1, last7d: signups7, last30d: signups30 },
      // `active` = users whose last login falls in the window (proxy for
      // logins; we don't yet store a per-login event — see future work).
      activeUsers: { last24h: active1, last7d: active7 },
      recentSignups: recentSignups.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        createdAt: u.createdAt,
      })),
      // Records created in the last 7d, by domain — "what's being used".
      activity7d: {
        sessions: newSessions7,
        groups: newGroups7,
        posts: newPosts7,
        reviews: newReviews7,
        subscriptions: newSubs7,
        invoices: newInvoices7,
      },
    };
  }
}
