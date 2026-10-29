import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AuthModule } from '../auth/auth.module';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';
import { RoleModule } from '../role/role.module';
import { PaymentModule } from '../payment/payment.module';
import { WorkoutModule } from '../workout/workout.module';
// NOTE: JobsService is provided by the @Global() JobsModule (registered
// once in AppModule) — inject it directly; do NOT re-import JobsModule
// here or its workers would double-register.
import { AdminImpersonationLog } from './entities/admin-impersonation-log.entity';
import { AdminActionLog } from './entities/admin-action-log.entity';
// Models read by the admin services (cross-tenant queries + db browser).
import { User } from '../user/entities/user.entity';
import { Post } from '../post/entities/post.entity';
import { Review } from '../review/entities/review.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import { WorkoutLog } from '../workout/entities/workout-log.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import { Message } from '../messaging/entities/message.entity';
import { ProgramAssignment } from '../workout/entities/program-assignment.entity';
import { Program } from '../workout/entities/program.entity';
import { Role } from '../role/entities/role.entity';
import { UserRole } from '../role/entities/user-role.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { Group } from '../group/entities/group.entity';
import { SessionInstance } from '../session/entities/session-instance.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { StripeAccount } from '../payment/entities/stripe-account.entity';
import { StripeCustomer } from '../payment/entities/stripe-customer.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { Dispute } from '../payment/entities/dispute.entity';
import { WebhookEvent } from '../payment/entities/webhook-event.entity';
import { MessageReport } from '../messaging/entities/message-report.entity';
import { WorkoutReport } from '../workout/entities/workout-report.entity';
import { Notification } from '../notification/entities/notification.entity';
import { Venue } from '../venue/entities/venue.entity';
import { BlogPost } from '../blog/entities/blog-post.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { Waitlist } from '../waitlist/entities/waitlist.entity';
import { Invoice } from '../payment/entities/invoice.entity';
import { Payment } from '../payment/entities/payment.entity';
// Controllers
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminImpersonationController } from './controllers/admin-impersonation.controller';
import { AdminDbController } from './controllers/admin-db.controller';
import { AdminOverviewController } from './controllers/admin-overview.controller';
import { AdminJobsController } from './controllers/admin-jobs.controller';
import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { AdminContentController } from './controllers/admin-content.controller';
import { AdminDomainController } from './controllers/admin-domain.controller';
import { AdminAuditController } from './controllers/admin-audit.controller';
// Services
import { AdminUsersService } from './services/admin-users.service';
import { AdminImpersonationService } from './services/admin-impersonation.service';
import { AdminDbService } from './services/admin-db.service';
import { AdminOverviewService } from './services/admin-overview.service';
import { AdminJobsService } from './services/admin-jobs.service';
import { AdminPaymentsService } from './services/admin-payments.service';
import { AdminContentService } from './services/admin-content.service';
import { AdminDomainService } from './services/admin-domain.service';
import { AdminAuditService } from './services/admin-audit.service';

/**
 * Admin module — a separate operator surface (consumed by the `admin`
 * Angular app). Purely additive: it only READS existing tables (plus its
 * own append-only impersonation audit log) and reuses RoleService /
 * AuthService / AccountDeletionService. No existing module is modified.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      AdminImpersonationLog,
      AdminActionLog,
      User,
      Role,
      UserRole,
      InstructorProfile,
      Group,
      SessionInstance,
      InstructorClient,
      StripeAccount,
      StripeCustomer,
      RefreshToken,
      Subscription,
      Dispute,
      WebhookEvent,
      MessageReport,
      WorkoutReport,
      Notification,
      Venue,
      BlogPost,
      Feedback,
      Waitlist,
      Invoice,
      Payment,
      Post,
      Review,
      Exercise,
      WorkoutLog,
      SessionParticipant,
      Message,
      ProgramAssignment,
      Program,
    ]),
    RoleModule,
    AuthModule,
    PaymentModule,
    AccountDeletionModule,
    // Workout reports: the queue, takedowns and the reported photo.
    WorkoutModule,
  ],
  controllers: [
    AdminUsersController,
    AdminImpersonationController,
    AdminDbController,
    AdminOverviewController,
    AdminJobsController,
    AdminPaymentsController,
    AdminContentController,
    AdminDomainController,
    AdminAuditController,
  ],
  providers: [
    AdminUsersService,
    AdminImpersonationService,
    AdminDbService,
    AdminOverviewService,
    AdminJobsService,
    AdminPaymentsService,
    AdminContentService,
    AdminDomainService,
    AdminAuditService,
  ],
})
export class AdminModule {}
