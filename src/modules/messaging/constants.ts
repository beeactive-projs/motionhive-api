import { createHash } from 'crypto';

/**
 * Module-wide messaging constants. Single source of truth so the FE
 * contract, the moderation views, and the service's tombstone all
 * agree on the same string.
 */

/**
 * Body string written when a message is soft-deleted (by sender) or
 * removed (by moderator). The row stays for thread continuity; the
 * plaintext is gone.
 *
 * The FE renders this verbatim — keep it user-facing.
 */
export const DELETED_MESSAGE_BODY = '[deleted]';

/**
 * Deterministic direct-conversation key for a pair of users.
 *
 * Used by `findOrCreateDirectConversation` to dedupe concurrent first-
 * sends from opposite sides via a partial UNIQUE index on
 * `conversation.direct_key` (migration 039). The exact algorithm here
 * MUST match the backfill in 039_messaging_direct_key.sql so existing
 * rows and new rows produce the same key.
 *
 * Format: `sha256(sortedA + ':' + sortedB)` as hex.
 */
export function directKeyFor(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  return createHash('sha256').update(`${a}:${b}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Message requests (migration 090, docs/research/messaging/WHO_CAN_MESSAGE.md)
// ---------------------------------------------------------------------------

/** Messages someone can send while their request waits (owner, 2026-11-20). */
export const REQUEST_MESSAGE_LIMIT = 3;

/**
 * The same, written to a coach who is taking clients: someone asking about
 * coaching needs room to explain (owner, 2026-11-20).
 */
export const COACH_REQUEST_MESSAGE_LIMIT = 10;

/**
 * New message requests one person may start in a day. Stops anyone (a coach
 * looking for clients, most likely) from writing to a whole group.
 */
export const DAILY_REQUEST_LIMIT = 20;

/** How long after a class its coach and the people booked into it stay connected. */
export const BOOKING_CONNECTION_DAYS = 14;
