import type { NotifyParams } from '../notification/notification.service';
import { NotificationType } from '../notification/notification.service';
import type { ChannelPreferences } from '../notification/entities/notification-preference.entity';

/**
 * Notification builders for the messaging module.
 *
 * Click target: `data.screen: 'messages'` with `queryParams: { conversationId }`
 * — matches the NotificationOutbox / queryParams convention in CLAUDE.md
 * (tabbed pages use queryParams instead of entityId).
 *
 * Builders take PRIMITIVE arguments only — never a Sequelize entity. Per
 * the existing repo convention, this avoids partial-load bugs and keeps
 * the builders trivial to test.
 *
 * Copy lives in the catalog (`notifications.messaging.*` under
 * src/common/i18n/catalog).
 *
 * The sender name and preview are passed RAW, like every other message
 * param. Each surface escapes for itself: the email template runs the
 * rendered text through `escapeHtml`, the app binds it as text, and a
 * push is plain text. Escaping here as well would show `&amp;` to the
 * reader.
 */
const PREVIEW_MAX_LENGTH = 80;

function truncatePreview(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= PREVIEW_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

export interface MessageReceivedArgs {
  recipientId: string;
  conversationId: string;
  /** Display name of the sender (firstName + lastName). null → "Someone". */
  senderName: string | null;
  /** Plaintext body — truncated here, escaped by whatever renders it. */
  preview: string;
  /**
   * When true, the recipient has already received an email for this
   * conversation in the throttle window. We keep the in-app notification
   * but suppress the email channel via `channelOverride`.
   */
  suppressEmail: boolean;
  /**
   * When true, the user has opted out of message previews in emails
   * (privacy preference). The in-app body still includes the preview;
   * the email body is replaced with a generic copy ("You have a new
   * message — open MotionHive to read it").
   *
   * For v1 we read this from a request-scoped flag; the persistent
   * setting lands in the FE preferences screen in a later sprint.
   */
  hidePreviewInEmail: boolean;
  /**
   * The recipient has muted this conversation. The phone stays quiet;
   * the unread count still moves.
   */
  muted: boolean;
}

export function messageReceived(args: MessageReceivedArgs): NotifyParams {
  // Channel policy for MESSAGE_RECEIVED (matches Slack/WhatsApp):
  //   - in_app:  ALWAYS off. The Messages sidebar badge + the
  //              conversation row's unread count are the persistent
  //              in-app signals; the bell would just duplicate them.
  //              Live "you have a new message" toasts are emitted via
  //              SSE and are transient, not stored in the bell.
  //   - email:   on for the first message in a (recipient, conversation)
  //              hour-window, off afterwards. Caller supplies the
  //              suppress flag from the rate-limit service.
  //   - push:    on for every message (the user's preference decides),
  //              off when the recipient muted the conversation. One
  //              collapse key per conversation, so the shade shows the
  //              latest message from a thread rather than a stack.
  //
  // We still call `notify()` so the receipt row gets written (we
  // need that for the email-send worker's dedup), but the in_app
  // channel is suppressed at the receipt layer — no bell entry.
  const channelOverride: Partial<ChannelPreferences> = {
    in_app: false,
    email: !args.suppressEmail,
    ...(args.muted ? { push: false } : {}),
  };

  const params: NotifyParams = {
    userId: args.recipientId,
    type: NotificationType.MESSAGE_RECEIVED,
    message: args.hidePreviewInEmail
      ? { key: 'messaging.receivedPrivate', params: { name: args.senderName } }
      : {
          key: 'messaging.received',
          params: {
            name: args.senderName,
            preview: truncatePreview(args.preview),
          },
        },
    data: {
      screen: 'messages',
      queryParams: { conversationId: args.conversationId },
    },
    collapseKey: `conversation.${args.conversationId}`,
    channelOverride,
  };

  return params;
}
