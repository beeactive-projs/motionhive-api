import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

/**
 * Swagger documentation for the messaging module.
 *
 * Conventions matched here:
 *   - Every endpoint that needs auth declares `auth: true` so the
 *     "Authorize" button surfaces the bearer-token form.
 *   - Silent-drop endpoints (POST /messaging/messages when blocked)
 *     do NOT surface a separate 403 example — the response shape is
 *     identical to a successful send by design. Documented in the
 *     description instead so the FE knows what to do with `delivered:
 *     false`.
 *   - Admin endpoints note the required roles in the description and
 *     include 403 for non-admin callers.
 */
export const MessagingDocs = {
  // ── User-facing ─────────────────────────────────────────────

  sendMessage: {
    summary: 'Send a direct message',
    description:
      'Send a plaintext message to another user. Creates the conversation on first send between two users and reuses it on subsequent sends. ' +
      'Response includes `delivered: true` on the happy path and `delivered: false` when the recipient has blocked the sender, the recipient does not exist, or another silent-drop condition fires — the FE MUST render both identically (no leak). ' +
      'Body is capped at 4000 chars by both the DTO and a DB CHECK constraint. ' +
      'Rate-limited to 30 messages/min/user (per-user) and 10/sec/(user, conversation) (per-conversation soft throttle).',
    auth: true,
    responses: [
      ApiStandardResponses.Created,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  listConversations: {
    summary: 'List my conversations',
    description:
      'Paginated inbox sorted by `last_message_at DESC`. Each item carries the other-user snapshot (DM only), unread count, mute state, and the preview of the most recent message. ' +
      '`folder` picks a part of the inbox: `inbox` (chats taken in, not archived), `requests` (message requests waiting for you, each with a `requestContext`), `archived`. Omitted, it lists everything but deleted requests, as before requests existed (app versions already in the stores). ' +
      'Items carry `isRequest`, `archived`, and `waiting: { remaining }` when the other person has not accepted your request yet; `lastReadByOther` stays null until they do. ' +
      'Rate-limited to 120 req/min/user.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  getUnreadCount: {
    summary: 'Total unread message count',
    description:
      'Aggregate count of unread messages across all active conversations. Powers the global app badge. `count` is the total as before requests existed (requests and archived chats included); `inbox` counts unread in chats taken in and not archived; `requests` is how many message requests are waiting. Rate-limited to 240 req/min/user.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  getConversation: {
    summary: 'Get a single conversation snapshot',
    description:
      'Returns the same shape as a list item but for one conversation. 404 when the caller is not an active participant — no existence leak.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  listMessages: {
    summary: 'List messages in a conversation',
    description:
      'Cursor-paginated, newest first. Pass `before=<messageId>` to load older messages. Response carries `nextBefore` (null when no more pages). 404 on non-participant — no existence leak, no probe leakage via `before`.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  getMessage: {
    summary: 'Get a single message (permalink)',
    description:
      'Returns one message by id. 404 when the message does not exist OR when the caller is not a participant in its conversation — same response for both, no existence leak.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  markRead: {
    summary: 'Mark a conversation read',
    description:
      "Updates the caller's `last_read_at`. Omit `upToIso` to mark everything as read; supply an ISO timestamp to mark read only up to that point. Emits a `conversation.read` SSE event to the other participants.",
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  markUnread: {
    summary: 'Mark a conversation unread',
    description:
      "Sets the caller's `marked_unread` flag: a reminder to come back to the thread, independent of `last_read_at`, so the other participant's read receipt is untouched. Mark-read clears it. The list returns it as `markedUnread`, and the unread badge counts a marked conversation as at least 1. Emits a `conversation.unread` SSE event to the caller's other sessions.",
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  muteConversation: {
    summary: 'Mute or unmute a conversation',
    description:
      'Per-conversation mute state. Pass a future ISO timestamp to mute until then; omit or pass null to unmute. Past timestamps are treated as unmute.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  leaveConversation: {
    summary: 'Leave a conversation (groups only)',
    description:
      "Soft-leave: sets `left_at` on the caller's participant row, preserving history. DIRECT conversations cannot be left — block the other user instead.",
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  clearConversation: {
    summary: 'Delete a conversation for me',
    description:
      "Sets `cleared_at` on the caller's participant row. Messages up to that moment are hidden from the caller (list, single lookup) and never count as unread; the conversation leaves the caller's inbox until a newer message arrives. The other participant keeps the full history, and nothing is removed, so reports and moderation still see every message. Emits a `conversation.cleared` SSE event to the caller's other sessions.",
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  shareTo: {
    summary: 'Send a public thing to several people',
    description:
      'One session, group, coach, exercise or starter program to up to 10 people, each as its own message with the optional caption (requests, blocks and limits apply per person). Returns `results`, one per person: SENT, WAITING (sent as a message request) or REFUSED with the error key in `reason`. 400 `messaging.notShareable` when the thing is not public, or a session that is over. A single message can carry one too: `attachment` on POST /messaging/messages.',
    auth: true,
    responses: [
      ApiStandardResponses.Created,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  acceptRequest: {
    summary: 'Accept a message request',
    description:
      'Moves the chat from your message requests to your chats; the sender can write freely again. Replying to a request accepts it too. Accepting a chat already taken in changes nothing. Emits `conversation.accepted` to both sides. Returns the conversation.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  declineRequest: {
    summary: 'Delete a message request',
    description:
      "Removes the request from your requests and hides its messages for you. The sender is never told and keeps seeing it as waiting; what they write within their limit afterwards is kept but never shown or announced. 400 `messaging.notARequest` when the chat isn't a request.",
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  archiveConversation: {
    summary: 'Archive or unarchive a chat',
    description:
      'An archived chat leaves your chats for the archived list, stays there when messages arrive, and sends no push or email; sending a message in it brings it back. 400 `messaging.acceptRequestFirst` on a message request. Emits `conversation.archived` to your other sessions.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  reach: {
    summary: 'What happens if I write to this person',
    description:
      '`status`: DIRECT (straight into their chats), REQUEST (a message request; `requestLimit` messages fit before they accept), CONNECTIONS_ONLY (their setting), YOU_BLOCKED, NEW_ACCOUNT, SUSPENDED. A block by them is never revealed: the answer is the one you would get without it.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  getSettings: {
    summary: 'My messaging settings',
    description:
      '`whoCanMessage`: EVERYONE, REQUESTS (the default) or CONNECTIONS.',
    auth: true,
    responses: [ApiStandardResponses.OK, ApiStandardResponses.Unauthorized],
  } as ApiEndpointOptions,

  updateSettings: {
    summary: 'Change who can message me',
    description:
      'EVERYONE: anyone lands in your chats. REQUESTS: people you are connected with (coaching, a booking in the last 14 days, a group one of you runs) go straight in, anyone else arrives as a message request. CONNECTIONS: only they can start a chat.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  deleteOwnMessage: {
    summary: 'Soft-delete one of my messages',
    description:
      'Replaces the message body with the `[deleted]` tombstone; row stays for thread continuity. 403 when the caller is not the original sender. Emits a `message.deleted` SSE event to the other participants.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  block: {
    summary: 'Block another user',
    description:
      'After blocking, any message that user tries to send to me is silently dropped (their UI shows "sent", but no row is written and I receive no notification). 409 if the block already exists.',
    auth: true,
    responses: [
      ApiStandardResponses.Created,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  listBlocks: {
    summary: 'List users I have blocked',
    description:
      "Returns my block list with the blocked user's id/name/avatar snapshot. 200 with empty array when I have not blocked anyone.",
    auth: true,
    responses: [ApiStandardResponses.OK, ApiStandardResponses.Unauthorized],
  } as ApiEndpointOptions,

  unblock: {
    summary: 'Unblock a user',
    description:
      'Removes the block. Their future messages will deliver normally. Does not replay messages that were silently dropped while the block was active.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  report: {
    summary: 'Report a message or conversation',
    description:
      'Submit an abuse report. Either `messageId` or `conversationId` is required. Reports queue in OPEN status for admin review. ' +
      'Tightly throttled (5/hour/user) — reports can themselves be a harassment vector.',
    auth: true,
    responses: [
      ApiStandardResponses.Created,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
      ApiStandardResponses.TooManyRequests,
    ],
  } as ApiEndpointOptions,

  // ── SSE stream ──────────────────────────────────────────────

  stream: {
    summary: 'Server-Sent Events stream',
    description:
      'Long-lived event stream of messaging activity for the authenticated user. ' +
      'Auth is via the `?token=<jwt>` query parameter because browser `EventSource` cannot set custom headers. ' +
      'Emits these event types: `message.created`, `message.deleted`, `conversation.read`, `conversation.muted`, and `heartbeat` (every 25s, keeps proxies alive). ' +
      'Each event carries an SSE `id:` so the browser sets `Last-Event-ID` on reconnect (server-side replay is deferred to v2).',
    auth: false,
    responses: [
      { status: 200, description: 'Stream opened (text/event-stream)' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  streamAck: {
    summary: 'Acknowledge SSE event delivery',
    description:
      'Client records the id of the most recently processed SSE event. Used today as a stream-health beacon; will power cursor-based replay in v2 without a migration.',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};

/**
 * Admin-only moderation endpoints. Requires `SUPER_ADMIN` or `SUPPORT`
 * role; non-admin callers get 403.
 */
export const MessagingAdminDocs = {
  listReports: {
    summary: 'List user-submitted reports',
    description:
      'Paginated moderation queue. Filterable by `status` and `category`. Defaults sort OPEN/REVIEWING first, then most recent. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  resolveReport: {
    summary: 'Transition a report to a non-OPEN state',
    description:
      'Allowed: OPEN → REVIEWING/RESOLVED/DISMISSED, REVIEWING → RESOLVED/DISMISSED. Terminal states (RESOLVED/DISMISSED) cannot be reopened. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  readConversation: {
    summary: 'Read messages in a flagged conversation (audit-logged)',
    description:
      'Returns the most recent messages in a conversation for moderation review. **Every call writes an `admin_message_access_log` row in the same transaction as the read** — this is the only audited entry point to user message contents. `reason` is required and is stored verbatim on the audit row. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  suspend: {
    summary: "Suspend a user's ability to send messages",
    description:
      'Reads remain allowed. `expiresAtIso` omitted = indefinite suspension; a future ISO timestamp auto-lifts. 409 when an active suspension already exists for the user. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.Created,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  liftSuspension: {
    summary: 'Lift an active suspension',
    description:
      'Sets `lifted_at` + `lifted_by_id`. Idempotency: 400 if the suspension is already lifted. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  listVelocityAlarms: {
    summary: 'List velocity alarms',
    description:
      'Informational alarms fired when a user crosses 100 sends/hour. Defaults to unreviewed only; pass `includeReviewed=true` to see all. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  reviewVelocityAlarm: {
    summary: 'Mark a velocity alarm as reviewed',
    description:
      'Records that an admin has examined the alarm. Does not take any automated action — that is a deliberate human-in-the-loop decision. **SUPER_ADMIN or SUPPORT role required.**',
    auth: true,
    responses: [
      ApiStandardResponses.OK,
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
