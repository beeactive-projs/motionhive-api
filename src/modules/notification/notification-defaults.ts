import { NotificationType } from './notification-types';
import { ChannelPreferences } from './entities/notification-preference.entity';

/**
 * System defaults — what channels each notification type uses when
 * the user has NOT set an override in `notification_preference`.
 *
 * Editing this map is a no-migration change: existing user overrides
 * still take precedence; users who haven't touched their preferences
 * will see the new behavior immediately.
 *
 * Channel meanings:
 *   in_app  — always recommended (cheap, non-intrusive, persists in bell)
 *   email   — anything the user might want a written record of
 *   push    — time-sensitive ("happening now/soon")
 *   sms     — reserved for high-urgency money/account events; off by default
 *
 * Defaults skew conservative for noisy categories (group activity,
 * post engagement) and aggressive for things that affect the user's
 * money or schedule.
 */

const ON_EVERYTHING_BUT_SMS: ChannelPreferences = {
  in_app: true,
  email: true,
  push: true,
  sms: false,
};

const IN_APP_AND_EMAIL: ChannelPreferences = {
  in_app: true,
  email: true,
  push: false,
  sms: false,
};

const IN_APP_ONLY: ChannelPreferences = {
  in_app: true,
  email: false,
  push: false,
  sms: false,
};

const IN_APP_AND_PUSH: ChannelPreferences = {
  in_app: true,
  email: false,
  push: true,
  sms: false,
};

export const NOTIFICATION_DEFAULTS: Record<
  NotificationType,
  ChannelPreferences
> = {
  // ── Sessions ─────────────────────────────────────────────
  // Reminders are time-sensitive → push on. 24h gets email too
  // (planning ahead); 1h is push-only (you're about to start).
  [NotificationType.SESSION_REMINDER_24H]: ON_EVERYTHING_BUT_SMS,
  [NotificationType.SESSION_REMINDER_1H]: IN_APP_AND_PUSH,
  // Cancellation / reschedule affects user's plans → email + push.
  [NotificationType.SESSION_CANCELLED]: ON_EVERYTHING_BUT_SMS,
  [NotificationType.SESSION_RESCHEDULED]: ON_EVERYTHING_BUT_SMS,
  // Status changes (started/completed) are informational only.
  [NotificationType.SESSION_STATUS_CHANGED]: IN_APP_ONLY,
  // Instructor-sent follow-up — content the user expects to read,
  // not just see in the bell. Email + in-app, push muted to avoid
  // late-night dings.
  [NotificationType.SESSION_FOLLOW_UP]: IN_APP_AND_EMAIL,
  // Roster churn is in-app only — too noisy to email about.
  [NotificationType.PARTICIPANT_JOINED]: IN_APP_ONLY,
  [NotificationType.PARTICIPANT_LEFT]: IN_APP_ONLY,

  // ── Client / coaching relationships ──────────────────────
  // IN_APP_ONLY on purpose — these five are the one family where
  // ClientService already sends a dedicated domain email of its own
  // (sendClientRequestToInstructorEmail, sendClientRequestAcceptedEmail,
  // sendClientRequestDeclinedEmail, sendExistingUserClientInvitationEmail,
  // sendCollaborationEndedEmail) right next to the notify() call. Leaving
  // the email channel on here delivered the generic notification email as
  // well, so an invitee got two emails for one invite. The domain template
  // is the better one — it carries the Accept/Decline CTAs — so it keeps
  // the email channel and the notification stays in-app.
  //
  // Each builder targets exactly the recipient who already gets that
  // domain email, so nobody loses an email by this. If you ever fire one
  // of these types from a path with no domain email, give it its own
  // preset rather than flipping these back.
  [NotificationType.CLIENT_REQUEST_RECEIVED]: IN_APP_ONLY,
  [NotificationType.CLIENT_REQUEST_ACCEPTED]: IN_APP_ONLY,
  [NotificationType.CLIENT_REQUEST_DECLINED]: IN_APP_ONLY,
  [NotificationType.CLIENT_INVITATION_RECEIVED]: IN_APP_ONLY,
  [NotificationType.CLIENT_RELATIONSHIP_ENDED]: IN_APP_ONLY,

  // ── Groups & invitations ─────────────────────────────────
  // IN_APP_ONLY for the same reason as the coaching block above: every
  // one of these already has a dedicated domain email next to its
  // notify() call in InvitationService / GroupService, addressed to the
  // same recipient. GROUP_MEMBER_LEFT was already set this way; the rest
  // were not, so they sent the generic notification email on top of the
  // domain one. These events are still emailed — just once, by the
  // richer template that carries the real CTAs.
  [NotificationType.GROUP_INVITATION_RECEIVED]: IN_APP_ONLY,
  [NotificationType.GROUP_INVITATION_ACCEPTED]: IN_APP_ONLY,
  [NotificationType.GROUP_INVITATION_DECLINED]: IN_APP_ONLY,
  // Member churn is noisy in active groups → in-app only.
  [NotificationType.GROUP_MEMBER_JOINED]: IN_APP_ONLY,
  [NotificationType.GROUP_MEMBER_LEFT]: IN_APP_ONLY,
  // Removal / ownership transfer / role change is consequential, and
  // stays emailed — via sendGroupMemberRemovedEmail /
  // sendGroupOwnershipTransferredEmail / sendGroupRoleChangedEmail.
  [NotificationType.GROUP_MEMBER_REMOVED]: IN_APP_ONLY,
  [NotificationType.GROUP_MEMBER_ROLE_CHANGED]: IN_APP_ONLY,
  [NotificationType.GROUP_OWNERSHIP_TRANSFERRED]: IN_APP_ONLY,
  // Join requests — owner needs to act; user wants to know the outcome.
  // Both are covered by sendGroupJoinRequestReceivedEmail /
  // sendGroupJoinRequestDecidedEmail.
  [NotificationType.GROUP_JOIN_REQUEST_RECEIVED]: IN_APP_ONLY,
  [NotificationType.GROUP_JOIN_REQUEST_APPROVED]: IN_APP_ONLY,
  [NotificationType.GROUP_JOIN_REQUEST_REJECTED]: IN_APP_ONLY,

  // ── Payments & invoicing ─────────────────────────────────
  // Money matters → email always on by default.
  [NotificationType.INVOICE_CREATED]: IN_APP_AND_EMAIL,
  [NotificationType.INVOICE_DUE_SOON]: IN_APP_AND_EMAIL,
  [NotificationType.INVOICE_OVERDUE]: ON_EVERYTHING_BUT_SMS,
  [NotificationType.INVOICE_PAID]: IN_APP_AND_EMAIL,
  [NotificationType.PAYMENT_FAILED]: ON_EVERYTHING_BUT_SMS,
  [NotificationType.SUBSCRIPTION_CREATED]: IN_APP_AND_EMAIL,
  [NotificationType.SUBSCRIPTION_CANCELED]: IN_APP_AND_EMAIL,
  [NotificationType.PAYOUT_SENT]: IN_APP_AND_EMAIL,
  // Connect onboarding state — instructor needs to act.
  [NotificationType.STRIPE_ACCOUNT_READY]: IN_APP_AND_EMAIL,
  [NotificationType.STRIPE_ACCOUNT_RESTRICTED]: ON_EVERYTHING_BUT_SMS,
  // Disputes / refunds — instructor must respond on a deadline.
  [NotificationType.DISPUTE_OPENED]: ON_EVERYTHING_BUT_SMS,
  // Dispute evidence deadline approaching — high-urgency money event.
  [NotificationType.DISPUTE_EVIDENCE_DUE]: ON_EVERYTHING_BUT_SMS,
  [NotificationType.REFUND_ISSUED]: IN_APP_AND_EMAIL,
  // Refund window closing — instructor's last chance to refund; push it.
  [NotificationType.REFUND_WINDOW_CLOSING]: ON_EVERYTHING_BUT_SMS,
  // Card expiring soon — client should update before the next charge fails.
  [NotificationType.CARD_EXPIRING_SOON]: IN_APP_AND_EMAIL,
  // Monthly earnings summary — a written record the instructor wants.
  [NotificationType.EARNINGS_SUMMARY]: IN_APP_AND_EMAIL,

  // ── Posts ────────────────────────────────────────────────
  [NotificationType.POST_NEW_COMMENT]: IN_APP_ONLY,
  [NotificationType.POST_PENDING_APPROVAL]: IN_APP_AND_EMAIL,
  [NotificationType.POST_APPROVED]: IN_APP_ONLY,
  [NotificationType.POST_REJECTED]: IN_APP_AND_EMAIL,

  // ── Messaging ────────────────────────────────────────────
  // In-app on every message; email is throttled at the call site
  // (one per recipient/conversation/hour). Push reserved for v2.
  [NotificationType.MESSAGE_RECEIVED]: IN_APP_AND_EMAIL,

  // ── Workouts ─────────────────────────────────────────────
  // Fork notifications are high-volume on popular public exercises;
  // keep them in-app to avoid an inbox flood.
  [NotificationType.EXERCISE_FORKED]: IN_APP_ONLY,
  // Program assignment is a real coaching event — email so the
  // client sees it even when they're not in the app.
  [NotificationType.PROGRAM_ASSIGNED]: IN_APP_AND_EMAIL,
  // A coach with ten clients would get ten emails a day, so this one
  // stays in-app. It exists to make the roster feel alive, not to
  // interrupt.
  [NotificationType.CLIENT_COMPLETED_WORKOUT]: IN_APP_ONLY,
  // A single workout is one of many and stays in-app; finishing an
  // entire plan happens a handful of times a year and is the moment a
  // coach should act on (debrief, re-assign), so it earns an email.
  [NotificationType.CLIENT_COMPLETED_PLAN]: IN_APP_AND_EMAIL,
};

/**
 * Resolve a user's effective channel preferences for a type:
 * user override (from DB) wins; missing keys fall back to the
 * system default; missing whole row falls back to defaults entirely.
 */
export function resolveChannels(
  type: NotificationType,
  override: ChannelPreferences | null,
): Required<ChannelPreferences> {
  const base = NOTIFICATION_DEFAULTS[type] ?? IN_APP_ONLY;
  return {
    in_app: override?.in_app ?? base.in_app ?? true,
    email: override?.email ?? base.email ?? false,
    push: override?.push ?? base.push ?? false,
    sms: override?.sms ?? base.sms ?? false,
  };
}
