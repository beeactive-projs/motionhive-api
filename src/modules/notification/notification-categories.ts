import { NotificationType } from './notification-types';

/**
 * Top-level groupings the user sees in the settings UI. Industry
 * convention (Linear, HubSpot redesign, Slack) is to group by
 * category rather than per-event-type — a user shouldn't have to
 * decide 30 times "do I want this notification?" Six choices are
 * plenty and match how people actually think about their inbox.
 *
 * Adding a new NotificationType is a zero-migration change: pick
 * the right category in TYPE_TO_CATEGORY below. The settings page
 * automatically picks it up.
 */
export enum NotificationCategory {
  Sessions = 'SESSIONS',
  Coaching = 'COACHING',
  Groups = 'GROUPS',
  Payments = 'PAYMENTS',
  Account = 'ACCOUNT',
  Posts = 'POSTS',
  Messaging = 'MESSAGING',
  Workouts = 'WORKOUTS',
}

/**
 * The labels + descriptions shown in the settings UI. Kept here so
 * the FE can fetch them from the API rather than re-implementing
 * the copy on the FE — keeps the user-facing language consistent
 * with the catalog.
 */
export const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; description: string }
> = {
  [NotificationCategory.Sessions]: {
    label: 'Sessions',
    description: 'Reminders, cancellations, reschedules, and roster changes.',
  },
  [NotificationCategory.Coaching]: {
    label: 'Coaching',
    description:
      'Client requests, instructor invitations, and coaching relationship updates.',
  },
  [NotificationCategory.Groups]: {
    label: 'Groups',
    description: 'Invitations, member changes, and group ownership updates.',
  },
  [NotificationCategory.Payments]: {
    label: 'Payments & invoices',
    description:
      'Invoices, payments, subscriptions, refunds, payouts, and disputes.',
  },
  [NotificationCategory.Account]: {
    label: 'Account & security',
    description: 'Stripe account status changes that need your attention.',
  },
  [NotificationCategory.Posts]: {
    label: 'Posts & comments',
    description: 'Comments on your posts, approvals, and moderation outcomes.',
  },
  [NotificationCategory.Workouts]: {
    label: 'Workouts & exercises',
    description:
      'Fork notifications on your public exercises, program assignment ' +
      'updates, and workout-completion alerts from your clients.',
  },
  [NotificationCategory.Messaging]: {
    label: 'Direct messages',
    description:
      'New messages from your clients and instructors. We coalesce email alerts so you only get one per conversation per hour.',
  },
};

/**
 * Every NotificationType maps to exactly one category. Source of
 * truth: this map. The settings UI uses it to group the toggles;
 * the preference service uses it to fan out a category-level edit
 * to all member types when the user saves.
 *
 * When you add a new NotificationType, add a row here. TypeScript
 * will fail to compile until you do (Record<NotificationType, …>
 * forces exhaustive coverage).
 */
export const TYPE_TO_CATEGORY: Record<NotificationType, NotificationCategory> =
  {
    // Sessions
    [NotificationType.SESSION_REMINDER_24H]: NotificationCategory.Sessions,
    [NotificationType.SESSION_REMINDER_1H]: NotificationCategory.Sessions,
    [NotificationType.SESSION_CANCELLED]: NotificationCategory.Sessions,
    [NotificationType.SESSION_RESCHEDULED]: NotificationCategory.Sessions,
    [NotificationType.SESSION_STATUS_CHANGED]: NotificationCategory.Sessions,
    [NotificationType.SESSION_FOLLOW_UP]: NotificationCategory.Sessions,
    [NotificationType.PARTICIPANT_JOINED]: NotificationCategory.Sessions,
    [NotificationType.PARTICIPANT_LEFT]: NotificationCategory.Sessions,

    // Coaching
    [NotificationType.CLIENT_REQUEST_RECEIVED]: NotificationCategory.Coaching,
    [NotificationType.CLIENT_REQUEST_ACCEPTED]: NotificationCategory.Coaching,
    [NotificationType.CLIENT_REQUEST_DECLINED]: NotificationCategory.Coaching,
    [NotificationType.CLIENT_INVITATION_RECEIVED]:
      NotificationCategory.Coaching,
    [NotificationType.CLIENT_RELATIONSHIP_ENDED]: NotificationCategory.Coaching,
    [NotificationType.COACH_LEFT]: NotificationCategory.Coaching,

    // Groups
    [NotificationType.GROUP_INVITATION_RECEIVED]: NotificationCategory.Groups,
    [NotificationType.GROUP_INVITATION_ACCEPTED]: NotificationCategory.Groups,
    [NotificationType.GROUP_INVITATION_DECLINED]: NotificationCategory.Groups,
    [NotificationType.GROUP_MEMBER_JOINED]: NotificationCategory.Groups,
    [NotificationType.GROUP_MEMBER_LEFT]: NotificationCategory.Groups,
    [NotificationType.GROUP_MEMBER_REMOVED]: NotificationCategory.Groups,
    [NotificationType.GROUP_CLOSED]: NotificationCategory.Groups,
    [NotificationType.GROUP_MEMBER_ROLE_CHANGED]: NotificationCategory.Groups,
    [NotificationType.GROUP_OWNERSHIP_TRANSFERRED]: NotificationCategory.Groups,
    [NotificationType.GROUP_JOIN_REQUEST_RECEIVED]: NotificationCategory.Groups,
    [NotificationType.GROUP_JOIN_REQUEST_APPROVED]: NotificationCategory.Groups,
    [NotificationType.GROUP_JOIN_REQUEST_REJECTED]: NotificationCategory.Groups,

    // Payments
    [NotificationType.INVOICE_CREATED]: NotificationCategory.Payments,
    [NotificationType.INVOICE_DUE_SOON]: NotificationCategory.Payments,
    [NotificationType.INVOICE_OVERDUE]: NotificationCategory.Payments,
    [NotificationType.INVOICE_PAID]: NotificationCategory.Payments,
    [NotificationType.PAYMENT_FAILED]: NotificationCategory.Payments,
    [NotificationType.SUBSCRIPTION_CREATED]: NotificationCategory.Payments,
    [NotificationType.SUBSCRIPTION_CANCELED]: NotificationCategory.Payments,
    [NotificationType.PAYOUT_SENT]: NotificationCategory.Payments,
    [NotificationType.DISPUTE_OPENED]: NotificationCategory.Payments,
    [NotificationType.DISPUTE_EVIDENCE_DUE]: NotificationCategory.Payments,
    [NotificationType.REFUND_ISSUED]: NotificationCategory.Payments,
    [NotificationType.REFUND_WINDOW_CLOSING]: NotificationCategory.Payments,
    [NotificationType.CARD_EXPIRING_SOON]: NotificationCategory.Payments,
    [NotificationType.EARNINGS_SUMMARY]: NotificationCategory.Payments,

    // Account & security — Stripe Connect status changes are higher-stakes
    // than regular payment events; they live in their own bucket so the
    // user can keep payment-noise off but still be told if their account
    // is restricted.
    [NotificationType.STRIPE_ACCOUNT_READY]: NotificationCategory.Account,
    [NotificationType.STRIPE_ACCOUNT_RESTRICTED]: NotificationCategory.Account,

    // Posts
    [NotificationType.POST_NEW_COMMENT]: NotificationCategory.Posts,
    [NotificationType.POST_PENDING_APPROVAL]: NotificationCategory.Posts,
    [NotificationType.POST_APPROVED]: NotificationCategory.Posts,
    [NotificationType.POST_REJECTED]: NotificationCategory.Posts,

    // Messaging
    [NotificationType.MESSAGE_RECEIVED]: NotificationCategory.Messaging,

    // Workouts (exercises + programs)
    [NotificationType.EXERCISE_FORKED]: NotificationCategory.Workouts,
    [NotificationType.PROGRAM_ASSIGNED]: NotificationCategory.Workouts,
    [NotificationType.CLIENT_COMPLETED_WORKOUT]: NotificationCategory.Workouts,
    [NotificationType.CLIENT_COMPLETED_PLAN]: NotificationCategory.Workouts,
  };

/**
 * Reverse index — all NotificationTypes belonging to a category.
 * Used by the preference service to fan a category-level edit out
 * to per-type rows.
 */
export const CATEGORY_TO_TYPES: Record<
  NotificationCategory,
  NotificationType[]
> = Object.entries(TYPE_TO_CATEGORY).reduce(
  (acc, [type, category]) => {
    acc[category].push(type as NotificationType);
    return acc;
  },
  {
    [NotificationCategory.Sessions]: [],
    [NotificationCategory.Coaching]: [],
    [NotificationCategory.Groups]: [],
    [NotificationCategory.Payments]: [],
    [NotificationCategory.Account]: [],
    [NotificationCategory.Posts]: [],
    [NotificationCategory.Messaging]: [],
    [NotificationCategory.Workouts]: [],
  } as Record<NotificationCategory, NotificationType[]>,
);

/**
 * Stable order for the settings UI. The enum order is alphabetic
 * (Account, Coaching, …) which doesn't match user expectations.
 * This list is the canonical render order: Sessions first because
 * those are the most common day-to-day events; Account last because
 * it's rarely-touched.
 */
export const CATEGORY_DISPLAY_ORDER: NotificationCategory[] = [
  NotificationCategory.Messaging,
  NotificationCategory.Sessions,
  NotificationCategory.Coaching,
  NotificationCategory.Workouts,
  NotificationCategory.Groups,
  NotificationCategory.Payments,
  NotificationCategory.Posts,
  NotificationCategory.Account,
];
