import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { apiError, ApiErrorBody } from '../../common/i18n';

/**
 * Per-user/per-conversation rate limit for outgoing messages.
 *
 * Design constraints:
 *   - MUST work without Redis (dev convenience; matches the project's
 *     existing BullMQ-when-REDIS_HOST discipline).
 *   - The interface (assertSendAllowed + recordSend) is stable so a
 *     Redis-backed implementation can replace the internals later
 *     without touching MessagingService.
 *
 * v1 implementation: in-memory sliding-window counters with periodic
 * cleanup. Two windows:
 *
 *   PER_USER_PER_MINUTE   — 30 messages / 60s / user
 *   PER_USER_PER_CONV_SEC — 10 messages / 1s / (user, conversation)
 *
 * The per-conversation rule defangs flood-typing accidents without
 * frustrating real conversation. The per-user rule is the abuse-spam
 * gate. Both numbers come from the plan §2 / §5.
 *
 * When breached, we throw HttpException(429) so the framework turns it
 * into a clean response. The exception carries `Retry-After` (seconds).
 */
@Injectable()
export class MessagingRateLimitService implements OnModuleDestroy {
  static readonly USER_PER_MINUTE_LIMIT = 30;
  static readonly USER_PER_MINUTE_WINDOW_MS = 60_000;
  static readonly CONV_PER_SECOND_LIMIT = 10;
  static readonly CONV_PER_SECOND_WINDOW_MS = 1_000;

  /** Map of bucket-key → list of send timestamps (ms epoch). */
  private readonly buckets = new Map<string, number[]>();

  /**
   * Sweep stale entries every minute. unref() so this never blocks
   * Node from exiting (important: messaging tests that spin up the
   * service via NestTestingModule must still terminate cleanly).
   */
  private readonly sweepTimer: NodeJS.Timeout = setInterval(
    () => this.sweep(),
    60_000,
  ).unref();

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    this.buckets.clear();
  }

  /**
   * Resolve whether a fresh send is allowed for this (user,
   * conversationId?) tuple. Throws HttpException(429) when not. When
   * allowed, also reserves the slot (no separate `record` call needed
   * — the check-and-record is atomic from the caller's perspective).
   *
   * Returns `Promise<void>` rather than `void` so the future Redis
   * adapter can swap in without changing the caller signature.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async assertSendAllowed(
    userId: string,
    conversationId?: string,
  ): Promise<void> {
    const now = Date.now();

    this.assertWindow(
      now,
      `u:${userId}`,
      MessagingRateLimitService.USER_PER_MINUTE_WINDOW_MS,
      MessagingRateLimitService.USER_PER_MINUTE_LIMIT,
      apiError('messaging.tooManyMessages', {
        max: MessagingRateLimitService.USER_PER_MINUTE_LIMIT,
      }),
    );

    if (conversationId) {
      this.assertWindow(
        now,
        `c:${userId}:${conversationId}`,
        MessagingRateLimitService.CONV_PER_SECOND_WINDOW_MS,
        MessagingRateLimitService.CONV_PER_SECOND_LIMIT,
        apiError('messaging.tooManyMessagesInConversation'),
      );
    }
  }

  /**
   * The per-conversation soft throttle alone, for the second check of a
   * send whose per-user slot `assertSendAllowed(userId)` already took:
   * asking that one again would count the same message twice against
   * the per-minute ceiling.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async assertConversationSendAllowed(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    this.assertWindow(
      Date.now(),
      `c:${userId}:${conversationId}`,
      MessagingRateLimitService.CONV_PER_SECOND_WINDOW_MS,
      MessagingRateLimitService.CONV_PER_SECOND_LIMIT,
      apiError('messaging.tooManyMessagesInConversation'),
    );
  }

  /**
   * Returns the current send count in the per-user 60s window. Used by
   * the velocity-alarm tracker to decide whether to flag the user.
   */
  recentUserSendCount(userId: string, windowMs: number): number {
    const cutoff = Date.now() - windowMs;
    const list = this.buckets.get(`u:${userId}`) ?? [];
    return list.filter((t) => t > cutoff).length;
  }

  /** Drops all buckets — used in tests. Never call in prod. */
  resetForTests(): void {
    this.buckets.clear();
  }

  // =========================================================================
  // Email "quiet-period" gate for MESSAGE_RECEIVED.
  //
  // Product rule (post-launch revision): we want a "you have a new
  // message after a quiet period" email — NOT a fixed 1-per-hour rate
  // limit. The intent is to nudge users back in when the conversation
  // has gone quiet, and to stay out of their inbox while they're
  // actively chatting.
  //
  // The gate is a pure decision based on the gap between the new
  // message and the previous one in the same conversation: if the
  // previous arrived within QUIET_PERIOD_MS, the recipient is
  // presumably still engaged → suppress the email. Otherwise → allow.
  //
  // Caller passes `previousMessageAt` (the createdAt of the message
  // immediately before the just-sent one, in the same conversation,
  // OR null if this is the conversation's first message). The
  // decision is stateless — no buckets, no race conditions, survives
  // restarts.
  // =========================================================================

  /** How long the conversation must have been quiet to warrant an email. */
  static readonly EMAIL_QUIET_PERIOD_MS = 60 * 60 * 1000;

  /**
   * Should we suppress the MESSAGE_RECEIVED email for the recipient?
   *
   *   - First message in the conversation (no previous) → allow.
   *   - Previous message was &gt; QUIET_PERIOD_MS ago → allow.
   *   - Previous message was within the window → suppress.
   *
   * Stateless; safe under concurrency.
   */
  shouldSuppressMessageEmail(previousMessageAt: Date | null): boolean {
    if (!previousMessageAt) return false;
    const gapMs = Date.now() - previousMessageAt.getTime();
    return gapMs < MessagingRateLimitService.EMAIL_QUIET_PERIOD_MS;
  }

  // ─────────────────────────── internal ───────────────────────────────

  private assertWindow(
    now: number,
    key: string,
    windowMs: number,
    limit: number,
    message: ApiErrorBody,
  ): void {
    const list = this.buckets.get(key) ?? [];
    const cutoff = now - windowMs;
    // Drop expired entries in-place. This keeps memory bounded over
    // time without needing the sweep timer to have fired recently.
    const filtered = list.filter((t) => t > cutoff);
    if (filtered.length >= limit) {
      const oldest = filtered[0];
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + windowMs - now) / 1000),
      );
      // Save the pruned list back even on the failure path so a flood
      // doesn't keep an ever-growing entry list around.
      this.buckets.set(key, filtered);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          ...message,
          retryAfter: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    filtered.push(now);
    this.buckets.set(key, filtered);
  }

  /**
   * Drop entries that are older than the *longest* window we track. We
   * use the per-minute window — anything older than that cannot affect
   * any future decision.
   */
  private sweep(): void {
    const cutoff =
      Date.now() - MessagingRateLimitService.USER_PER_MINUTE_WINDOW_MS;
    for (const [key, list] of this.buckets) {
      const filtered = list.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        this.buckets.delete(key);
      } else if (filtered.length !== list.length) {
        this.buckets.set(key, filtered);
      }
    }
  }
}
