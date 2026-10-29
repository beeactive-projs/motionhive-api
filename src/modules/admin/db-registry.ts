import type { Model, ModelStatic } from 'sequelize';
import { User } from '../user/entities/user.entity';
import { Group } from '../group/entities/group.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { Venue } from '../venue/entities/venue.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { BlogPost } from '../blog/entities/blog-post.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { Waitlist } from '../waitlist/entities/waitlist.entity';
import { Subscription } from '../payment/entities/subscription.entity';
import { Invoice } from '../payment/entities/invoice.entity';
import { Payment } from '../payment/entities/payment.entity';
import { StripeAccount } from '../payment/entities/stripe-account.entity';
import { Dispute } from '../payment/entities/dispute.entity';
import { WebhookEvent } from '../payment/entities/webhook-event.entity';
import { MessageReport } from '../messaging/entities/message-report.entity';
import { WorkoutReport } from '../workout/entities/workout-report.entity';
import { Notification } from '../notification/entities/notification.entity';

export interface DbBrowserEntry {
  /** The Sequelize model backing this table. */
  model: ModelStatic<Model>;
  /** One-line description shown in the table picker. */
  label: string;
  /**
   * Per-table columns to redact (in addition to the global secret
   * patterns in admin.constants). camelCase attribute names.
   */
  redact: string[];
}

/**
 * Whitelist for the read-only DB browser. The `:table` path param is
 * looked up here by key — it never reaches raw SQL — so the only tables
 * an admin can browse are the ones explicitly listed below. Adding a
 * table is a deliberate, reviewable act.
 *
 * Secret columns are stripped twice: by the per-table `redact` list here
 * AND by the global regex patterns (GLOBAL_REDACT_PATTERNS) applied in
 * the service. Belt-and-braces so a forgotten `redact` entry can't leak.
 */
export const DB_BROWSER_REGISTRY: Record<string, DbBrowserEntry> = {
  user: {
    model: User,
    label: 'Users',
    redact: ['passwordHash', 'emailVerificationToken', 'passwordResetToken'],
  },
  group: { model: Group, label: 'Groups', redact: ['joinToken'] },
  instructor_profile: {
    model: InstructorProfile,
    label: 'Instructor profiles',
    redact: [],
  },
  venue: { model: Venue, label: 'Venues', redact: [] },
  instructor_client: {
    model: InstructorClient,
    label: 'Instructor↔client links',
    redact: [],
  },
  blog_post: { model: BlogPost, label: 'Blog posts', redact: [] },
  feedback: { model: Feedback, label: 'Feedback', redact: [] },
  waitlist: { model: Waitlist, label: 'Waitlist', redact: [] },
  subscription: { model: Subscription, label: 'Subscriptions', redact: [] },
  invoice: { model: Invoice, label: 'Invoices', redact: [] },
  payment: { model: Payment, label: 'Payments', redact: [] },
  stripe_account: {
    model: StripeAccount,
    label: 'Stripe accounts',
    redact: [],
  },
  dispute: { model: Dispute, label: 'Disputes', redact: [] },
  webhook_event: {
    model: WebhookEvent,
    label: 'Stripe webhook events',
    // payload can carry PII; keep it out of the generic browser.
    redact: ['payload'],
  },
  message_report: {
    model: MessageReport,
    label: 'Message reports',
    redact: [],
  },
  workout_report: {
    model: WorkoutReport,
    label: 'Workout reports',
    redact: [],
  },
  notification: { model: Notification, label: 'Notifications', redact: [] },
};

/** Models the AdminModule must register in SequelizeModule.forFeature. */
export const DB_BROWSER_MODELS: ModelStatic<Model>[] = Object.values(
  DB_BROWSER_REGISTRY,
).map((e) => e.model);
