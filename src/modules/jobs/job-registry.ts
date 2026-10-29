/**
 * Central catalog of every queue + job + payload type.
 *
 * Two reasons this lives in one file:
 *
 * 1. Type safety end-to-end. Producers call
 *    `jobs.enqueue('notifications.email_send', payload)` and TypeScript
 *    enforces that `payload` has the right shape. If we miss a field
 *    or pass garbage, the compiler catches it.
 *
 * 2. Adding a new job is a one-line change here + one new worker file.
 *    No need to touch the JobsService or wire up new types in three
 *    different places.
 *
 * Naming convention: `<queueName>.<jobName>`. The dot-prefix makes it
 * easy to grep producers ("who enqueues notifications.* ?") and lets
 * us add per-queue concerns later (separate concurrency, separate
 * retention, separate workers on different dynos).
 */

import type { Locale } from '../../common/i18n';

/**
 * Queue names. Keep these short and lowercase — they show up in
 * Redis keys and the Bull Board UI. Add a new entry only when a job
 * needs different concurrency/retry/retention from existing queues.
 *
 * Today there's just `notifications`. Future queues per the research
 * synthesis will include `payments`, `sessions`, `auth`, `analytics`,
 * `maintenance`, `media`. Each gets its own row in QUEUE_DEFAULTS.
 */
export enum QueueName {
  Notifications = 'notifications',
  Sessions = 'sessions',
  Workouts = 'workouts',
  Payments = 'payments',
  Maintenance = 'maintenance',
}

/**
 * The full set of registered jobs. The keys MUST match
 * `<QueueName>.<jobName>` exactly — JobsService splits on the dot to
 * route to the right BullMQ queue.
 *
 * Phase 6 ships exactly one job (`notifications.email_send`) so the
 * shape is small. Subsequent phases add entries here.
 */
export interface JobPayloads {
  /**
   * Send a single notification email via Resend. The payload contains
   * everything the worker needs — no DB lookups required during
   * delivery (which keeps the worker fast and lets us retry without
   * worrying about DB state changing under us).
   */
  'notifications.email_send': {
    /** Receipt id — used for the BullMQ jobId so we get idempotency
     *  for free (the producer can re-enqueue after a transient failure
     *  and BullMQ will dedupe on this id). */
    receiptId: string;
    /** Recipient email address. */
    to: string;
    /** Subject line, already rendered in the recipient's language. */
    title: string;
    /** Email body text, already rendered in the recipient's language. */
    body: string;
    /**
     * The language `title` / `body` are in, so the layout around them
     * (eyebrow, footer, legal links) matches. Optional only because a job
     * enqueued by an older deploy will not have it.
     */
    locale?: Locale;
    /** Optional CTA URL pre-built by NotificationService.buildCtaUrl().
     *  We pre-build it on the producer side so the worker doesn't
     *  need access to ConfigService. */
    ctaUrl?: string;
    /** Button label shown next to the CTA URL. */
    ctaLabel?: string;
  };

  /**
   * Push one notification to every device a user has.
   *
   * Unlike `email_send` this carries a `userId` rather than the
   * addresses: a user has N devices, tokens are revoked and replaced
   * between a notification being raised and this running, and sending
   * to one we already know is dead wastes an attempt. The worker reads
   * the live device list instead.
   */
  'notifications.push_send': {
    /** Receipt id — also the BullMQ jobId, so a re-enqueue dedupes. */
    receiptId: string;
    /** Whose devices to deliver to. */
    userId: string;
    /** Notification title, rendered in the recipient's language. */
    title: string;
    /** Body text, rendered in the recipient's language. */
    body: string;
    /** Deep-link payload forwarded to the device for tap routing. */
    data?: Record<string, string>;
    /** Replaces an earlier alert about the same thing instead of stacking. */
    collapseKey?: string;
  };

  /**
   * One invite email from a client import (`ClientImportService`).
   *
   * Carries only the request id: the worker reads the row at send time,
   * so an invite cancelled or accepted in the meantime is skipped, and
   * the row's `email_status` (QUEUED → SENT) is the post-failure retry
   * guard, the job of the receipt check on `email_send`.
   */
  'notifications.client_invite_send': {
    /** client_request id. The jobId adds the expiry, so a resend is a new job. */
    requestId: string;
    /** Language for someone with no account; one with an account reads theirs. */
    locale?: Locale;
  };

  // ── Sessions ────────────────────────────────────────────────────────
  // System-wide sweeps. No per-call payload — the worker queries the DB
  // for what's due at run time (resilient: a run catches up everything
  // outstanding, not just one row). `runKey` is an optional dedup tag
  // the scheduler stamps from a coarse time bucket so overlapping cron
  // ticks collapse to one job.

  /** Read due `session_reminder_schedule` rows and fan out reminders. */
  'sessions.reminder_dispatch': { runKey?: string };
  /** Flip SCHEDULED→IN_PROGRESS (start passed) and IN_PROGRESS→COMPLETED (end passed). */
  'sessions.status_transition': { runKey?: string };
  /** Top up future occurrences for recurring templates to the horizon. */
  'sessions.generate_recurring': { runKey?: string };
  /** Decline PENDING_APPROVAL bookings whose session start has passed. */
  'sessions.cleanup_stale_participants': { runKey?: string };

  // ── Workouts ────────────────────────────────────────────────────────

  /** Skip never-started assigned workouts whose scheduled date is in the past. */
  'workouts.auto_skip_past_workouts': { runKey?: string };
  /** Close workouts left open and untouched for a day. */
  'workouts.close_stale_workouts': { runKey?: string };
  /** Complete assignments whose workouts are all COMPLETED or SKIPPED. */
  'workouts.auto_complete_assignments': { runKey?: string };

  // ── Payments ────────────────────────────────────────────────────────
  // System-wide reminder/maintenance sweeps; idempotent via notification
  // fingerprints. `runKey` is the coarse time-bucket dedup tag.

  /** Remind clients of OPEN invoices due within ~3 days. */
  'payments.invoice_due_soon': { runKey?: string };
  /** Escalate OPEN invoices past their due date (client + instructor). */
  'payments.invoice_overdue': { runKey?: string };
  /** Warn clients whose subscription card expires within ~30 days. */
  'payments.card_expiring': { runKey?: string };
  /** Email each instructor a summary of the previous month's earnings. */
  'payments.earnings_summary': { runKey?: string };
  /** Warn instructors when a payment's 14-day refund window is ~2 days out. */
  'payments.refund_window_closing': { runKey?: string };
  /** Nudge clients on OPEN invoices whose payment failed and remains unpaid. */
  'payments.dunning': { runKey?: string };
  /** Remind instructors of disputes whose evidence deadline is approaching. */
  'payments.dispute_deadline': { runKey?: string };
  /** Refresh the cached Stripe balance on each connected account. */
  'payments.balance_cache_refresh': { runKey?: string };
  /** Process a verified Stripe webhook event off the request path.
   *  `event` carries the full verified Stripe.Event so account.* keep
   *  their top-level `event.account`. */
  'payments.process_webhook': {
    webhookEventId: string;
    event: Record<string, unknown>;
  };
  /** Re-process ORPHANED webhook rows whose local entity has since
   *  appeared; age out the truly stuck ones. */
  'payments.reconcile_webhooks': { runKey?: string };
  /** A user changed language: point their Stripe customer at it, so
   *  Stripe's own invoice emails and hosted pages follow. */
  'payments.sync_customer_locale': { userId: string; locale: Locale };

  // ── Maintenance ─────────────────────────────────────────────────────
  // Bulk housekeeping sweeps; silent + idempotent.

  /** Delete expired refresh tokens. */
  'maintenance.cleanup_refresh_tokens': { runKey?: string };
  /** Reset account lockouts whose window has elapsed. */
  'maintenance.cleanup_lockouts': { runKey?: string };
  /** Decline still-pending invitations past their expiry. */
  'maintenance.cleanup_invitations': { runKey?: string };
  /** Decline PENDING client requests past their 30-day window. */
  'maintenance.cleanup_client_requests': { runKey?: string };
  /**
   * Account deletion, daily at 04:40 UTC: retry unfinished wind-downs, then
   * erase the accounts whose cooling-off has run out.
   */
  'maintenance.erase_accounts': { runKey?: string };
}

/**
 * Type-level helper: pull the payload type for a given job name. Used
 * by JobsService.enqueue<K>() and by BaseWorker so handlers know the
 * exact shape they'll receive.
 */
export type JobPayload<K extends keyof JobPayloads> = JobPayloads[K];

/**
 * The set of valid job names. Useful in places where we need a
 * runtime check (e.g. testing whether a string belongs to the
 * registry).
 */
export const ALL_JOB_NAMES: ReadonlyArray<keyof JobPayloads> = [
  'notifications.email_send',
  'notifications.push_send',
  'notifications.client_invite_send',
  'sessions.reminder_dispatch',
  'sessions.status_transition',
  'sessions.generate_recurring',
  'sessions.cleanup_stale_participants',
  'workouts.auto_skip_past_workouts',
  'workouts.close_stale_workouts',
  'workouts.auto_complete_assignments',
  'payments.invoice_due_soon',
  'payments.invoice_overdue',
  'payments.card_expiring',
  'payments.earnings_summary',
  'payments.refund_window_closing',
  'payments.dunning',
  'payments.dispute_deadline',
  'payments.balance_cache_refresh',
  'payments.process_webhook',
  'payments.reconcile_webhooks',
  'payments.sync_customer_locale',
  'maintenance.cleanup_refresh_tokens',
  'maintenance.cleanup_lockouts',
  'maintenance.cleanup_invitations',
  'maintenance.cleanup_client_requests',
  'maintenance.erase_accounts',
] as const;

/**
 * Jobs an operator may trigger on demand from the admin console. These
 * are the idempotent system sweeps — every one takes a `{ runKey? }`
 * payload and is safe to fire manually (a manual run just catches up
 * whatever is outstanding). The payload-carrying jobs
 * (`notifications.email_send`, `notifications.client_invite_send`,
 * `payments.process_webhook`) are deliberately excluded — they need
 * real per-event data, not a sweep.
 */
export type TriggerableJobName = Exclude<
  keyof JobPayloads,
  | 'notifications.email_send'
  | 'notifications.client_invite_send'
  | 'payments.process_webhook'
>;

/**
 * Catalog of manually-triggerable sweeps with their normal cron cadence
 * (for display in the admin Operations screen). The schedule strings are
 * descriptive (sourced from the @Cron schedulers), not parsed.
 */
export const TRIGGERABLE_JOBS: ReadonlyArray<{
  key: TriggerableJobName;
  queue: QueueName;
  schedule: string;
}> = [
  {
    key: 'sessions.reminder_dispatch',
    queue: QueueName.Sessions,
    schedule: 'every 5m',
  },
  {
    key: 'sessions.status_transition',
    queue: QueueName.Sessions,
    schedule: 'every 5m',
  },
  {
    key: 'sessions.generate_recurring',
    queue: QueueName.Sessions,
    schedule: 'daily',
  },
  {
    key: 'sessions.cleanup_stale_participants',
    queue: QueueName.Sessions,
    schedule: 'hourly',
  },
  {
    key: 'workouts.auto_skip_past_workouts',
    queue: QueueName.Workouts,
    schedule: 'daily 02:00',
  },
  {
    key: 'workouts.close_stale_workouts',
    queue: QueueName.Workouts,
    schedule: 'daily 02:15',
  },
  {
    key: 'workouts.auto_complete_assignments',
    queue: QueueName.Workouts,
    schedule: 'daily 02:30',
  },
  {
    key: 'payments.invoice_due_soon',
    queue: QueueName.Payments,
    schedule: 'daily 06:00',
  },
  {
    key: 'payments.invoice_overdue',
    queue: QueueName.Payments,
    schedule: 'daily 06:15',
  },
  {
    key: 'payments.dunning',
    queue: QueueName.Payments,
    schedule: 'daily 06:30',
  },
  {
    key: 'payments.card_expiring',
    queue: QueueName.Payments,
    schedule: 'daily 07:00',
  },
  {
    key: 'payments.refund_window_closing',
    queue: QueueName.Payments,
    schedule: 'daily 07:30',
  },
  {
    key: 'payments.dispute_deadline',
    queue: QueueName.Payments,
    schedule: 'daily 08:00',
  },
  {
    key: 'payments.earnings_summary',
    queue: QueueName.Payments,
    schedule: 'monthly 1st 08:00',
  },
  {
    key: 'payments.balance_cache_refresh',
    queue: QueueName.Payments,
    schedule: 'hourly',
  },
  {
    key: 'payments.reconcile_webhooks',
    queue: QueueName.Payments,
    schedule: 'every 30m',
  },
  {
    key: 'maintenance.cleanup_refresh_tokens',
    queue: QueueName.Maintenance,
    schedule: 'daily 04:00',
  },
  {
    key: 'maintenance.cleanup_lockouts',
    queue: QueueName.Maintenance,
    schedule: 'daily 04:10',
  },
  {
    key: 'maintenance.cleanup_invitations',
    queue: QueueName.Maintenance,
    schedule: 'daily 04:20',
  },
  {
    key: 'maintenance.cleanup_client_requests',
    queue: QueueName.Maintenance,
    schedule: 'daily 04:30',
  },
  {
    key: 'maintenance.erase_accounts',
    queue: QueueName.Maintenance,
    schedule: 'daily 04:40 UTC',
  },
];

const TRIGGERABLE_KEYS: ReadonlySet<string> = new Set(
  TRIGGERABLE_JOBS.map((j) => j.key),
);

/** Runtime guard: is this string a manually-triggerable sweep? */
export function isTriggerableJob(name: string): name is TriggerableJobName {
  return TRIGGERABLE_KEYS.has(name);
}

/**
 * Per-queue defaults applied to every job in that queue unless
 * overridden at enqueue time. The numbers come from
 * docs/research/jobs-system/02-bullmq-architecture-patterns.md.
 *
 *   attempts          how many times we retry on transient failure
 *   backoff           exponential delay between retries
 *   removeOnComplete  retention for successful jobs (size + age caps)
 *   removeOnFail      retention for failed jobs (longer — useful for
 *                     postmortem when something goes wrong)
 *
 * The retention caps are how we stay under 30 MB on Redis Cloud free
 * (see docs/research/jobs-system/redis-free-tier-decision.md).
 */
export const QUEUE_DEFAULTS = {
  [QueueName.Notifications]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential' as const, delay: 2_000 },
      removeOnComplete: { age: 86_400, count: 1_000 }, // 1 day or 1k jobs
      removeOnFail: { age: 7 * 86_400, count: 5_000 }, // 7 days or 5k jobs
    },
  },
  // Sessions/Workouts jobs are idempotent system sweeps — a failed run
  // just re-runs on the next cron tick, so we keep the retry budget
  // small (3 attempts) and never want a stuck job to pin the queue.
  [QueueName.Sessions]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 500 },
      removeOnFail: { age: 7 * 86_400, count: 2_000 },
    },
  },
  [QueueName.Workouts]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 500 },
      removeOnFail: { age: 7 * 86_400, count: 2_000 },
    },
  },
  // Payments holds both idempotent reminder sweeps and webhook processing.
  // Webhook jobs override `attempts` to 5 at enqueue time (more retries for
  // event-driven work); the sweeps are happy with the default 3.
  [QueueName.Payments]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 7 * 86_400, count: 5_000 },
    },
  },
  [QueueName.Maintenance]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 200 },
      removeOnFail: { age: 7 * 86_400, count: 1_000 },
    },
  },
} as const;

/**
 * Helper: split a registry key into its queue name and bare job name.
 *   parseJobKey('notifications.email_send')
 *     → { queue: 'notifications', name: 'email_send' }
 */
export function parseJobKey<K extends keyof JobPayloads>(
  key: K,
): { queue: QueueName; name: string } {
  const [queue, ...rest] = (key as string).split('.');
  return { queue: queue as QueueName, name: rest.join('.') };
}
