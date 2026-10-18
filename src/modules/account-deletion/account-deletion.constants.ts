import { SubscriptionStatus } from '../payment/entities/subscription.entity';
import { SessionParticipantStatus } from '../session/entities/session.enums';

/**
 * The erasure sweep's daily run, in UTC. The cron and the date we give
 * people both use it, so the date is exact.
 */
export const ERASURE_RUN_UTC = { hour: 4, minute: 40 } as const;

/**
 * At least this many days pass before the data is erased: it goes at the
 * first daily run after them, so between day 29 and day 30. The published
 * policy promises erasure within 30 days.
 */
export const COOLING_OFF_DAYS = 29;

/** The first daily erasure run at least COOLING_OFF_DAYS after `from`. */
export function erasureDate(from: Date): Date {
  const earliest = new Date(from.getTime() + COOLING_OFF_DAYS * 86_400_000);
  const run = new Date(
    Date.UTC(
      earliest.getUTCFullYear(),
      earliest.getUTCMonth(),
      earliest.getUTCDate(),
      ERASURE_RUN_UTC.hour,
      ERASURE_RUN_UTC.minute,
    ),
  );
  if (run < earliest) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}

/** How long the emailed code works. */
export const CODE_TTL_MINUTES = 15;

/** Wrong codes allowed before a new one must be requested. */
export const MAX_CODE_ATTEMPTS = 5;

/** How long a sign-in leaves to choose "keep my account". */
export const RESTORE_TICKET_TTL = '15m';

/** Subscriptions that would still charge someone. */
export const LIVE_SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.UNPAID,
];

/** Bookings that still hold (or wait for) a place. */
export const LIVE_BOOKING_STATUSES = [
  SessionParticipantStatus.PendingApproval,
  SessionParticipantStatus.Confirmed,
  SessionParticipantStatus.Waitlisted,
];

/**
 * Stripe dispute statuses that wait on the coach's evidence. A coach in one
 * of these must answer before leaving: nobody else can. `under_review`
 * does not block, the evidence is already in.
 */
export const DISPUTE_NEEDS_RESPONSE = [
  'needs_response',
  'warning_needs_response',
];

/** Machine-readable codes the apps branch on. */
export const AccountDeletionErrorCodes = {
  ScheduledForDeletion: 'ACCOUNT_SCHEDULED_FOR_DELETION',
  OpenDispute: 'OPEN_DISPUTE',
} as const;
