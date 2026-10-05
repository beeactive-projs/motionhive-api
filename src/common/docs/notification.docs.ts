/**
 * API documentation for the Notification, NotificationSettings, and
 * Device endpoints. Imported by the three controllers in the
 * notification module.
 */
import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const NotificationDocs = {
  list: {
    summary: 'List notifications for the current user',
    description:
      'Paginated bell list. Returns receipt rows joined with the parent notification, ' +
      'newest first. Filters out expired alerts and alerts scheduled for the future. ' +
      'Set `unreadOnly=true` to skip read + dismissed entries. Pass `category` — ' +
      'once, repeated, or comma-separated — to narrow to one or more categories.',
    auth: true,
    responses: [
      { status: 200, description: 'Paginated list of bell notifications' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  unreadCount: {
    summary: 'Unread + non-dismissed count for the bell badge',
    description:
      'Returns `{ count: number }`. Same visibility filters as the list ' +
      '(deliver_at <= now, expire_at IS NULL OR > now).',
    auth: true,
    responses: [
      { status: 200, description: 'Unread count' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  markRead: {
    summary: 'Mark a single notification as read',
    description:
      'Sets `read_at = now()` if not already read. Idempotent. Returns 404 ' +
      "(not 403) when the receipt belongs to another user — we don't leak " +
      'existence.',
    auth: true,
    responses: [
      { status: 204, description: 'Marked as read' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  markUnread: {
    summary: 'Put a notification back to unread',
    description:
      'Clears `read_at` (and `clicked_at`, so the row is not both unread and ' +
      "clicked). Idempotent. 404 for another user's receipt.",
    auth: true,
    responses: [
      { status: 204, description: 'Marked as unread' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  markAllRead: {
    summary: 'Mark every unread notification as read',
    description: 'Returns `{ updated: number }`.',
    auth: true,
    responses: [
      { status: 200, description: 'Bulk update result' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  markViewed: {
    summary: 'Mark a batch as viewed (analytics signal)',
    description:
      'Called by the FE when the bell dropdown opens. Sets `viewed_at` ' +
      'on rows that are not already viewed. Capped at 100 IDs per call.',
    auth: true,
    responses: [
      { status: 200, description: 'Bulk update result' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  markClicked: {
    summary: 'Mark a notification as clicked (deep-linked through)',
    description:
      'Sets both `clicked_at` and `read_at` in one save. Called when ' +
      'the user follows the notification’s deep link.',
    auth: true,
    responses: [
      { status: 204, description: 'Marked as clicked' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  dismiss: {
    summary: 'Dismiss a notification (X-out without reading)',
    description:
      'Sets `dismissed_at`. Dismissed entries are filtered out of the ' +
      'unread count and (when unreadOnly=true) the list.',
    auth: true,
    responses: [
      { status: 204, description: 'Dismissed' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  remove: {
    summary: 'Hard-delete a notification receipt',
    description:
      'Permanent. Re-shows are achieved by emitting a new notification, ' +
      'not by un-deleting.',
    auth: true,
    responses: [
      { status: 204, description: 'Deleted' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};

export const NotificationSettingsDocs = {
  get: {
    summary: 'Get effective notification preferences',
    description:
      'Returns one entry per known NotificationType with the merged ' +
      '(user override over system default) channel toggles, plus an ' +
      '`isCustomized` flag.',
    auth: true,
    responses: [
      { status: 200, description: 'Preference view' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Bulk update notification preferences',
    description:
      'Whole-payload save — the FE sends one entry per type the user has ' +
      'changed. Items not included keep their previous value (we never ' +
      'wipe; we only upsert). Capped at 200 entries per call.',
    auth: true,
    responses: [
      { status: 200, description: 'Bulk write result' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  resetType: {
    summary: 'Reset a single type to its system default',
    description:
      'Deletes the override row for `type` so the next delivery uses the ' +
      'in-code default.',
    auth: true,
    responses: [
      { status: 200, description: 'Reset result' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  resetAll: {
    summary: 'Reset every override to system default',
    description: 'Wipes all override rows for the user.',
    auth: true,
    responses: [
      { status: 200, description: 'Reset result' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};

export const NotificationDebugDocs = {
  notify: {
    summary: 'Fire a test notification (SUPER_ADMIN only)',
    description:
      'Smoke-test endpoint that calls NotificationService.notify() with the supplied params. ' +
      'Creates a notification + receipt + delivers in-app + email synchronously, just like a ' +
      'real producer would. Returns the result object so you can see per-channel delivery ' +
      'status without having to query the DB.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Delivery result (notificationId + per-channel statuses)',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,
};

export const DeviceDocs = {
  register: {
    summary: 'Register or refresh a push device',
    description:
      'Idempotent — same browser/device upserts on (user_id, ' +
      'endpoint_hash) and bumps last_seen_at. Pass either a Web Push ' +
      'subscription (platform=WEB) or an FCM token (platform=IOS/ANDROID).',
    auth: true,
    responses: [
      { status: 201, description: 'Device registered' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  list: {
    summary: 'List the user’s active push devices',
    description:
      'Powers the “logged-in devices” UI. Active = revoked_at IS NULL.',
    auth: true,
    responses: [
      { status: 200, description: 'Devices' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  revoke: {
    summary: 'Revoke (logout / remove) a device',
    description:
      'Sets revoked_at. Idempotent. 404 (not 403) when the device belongs ' +
      'to another user.',
    auth: true,
    responses: [
      { status: 204, description: 'Revoked' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  heartbeat: {
    summary: 'Bump last_seen_at for a device',
    description:
      'Cheap heartbeat. Used by the FE to keep the device list accurate ' +
      'so we know which devices are still in active use.',
    auth: true,
    responses: [
      { status: 204, description: 'Heartbeat recorded' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
