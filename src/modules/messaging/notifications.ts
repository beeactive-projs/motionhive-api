import type { NotifyParams } from '../notification/notification.service';
import type { NotificationMessage } from '../notification/notification-message';
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
  /**
   * A share sent without a caption (migration 092): announced as "Ana
   * shared a session: Yoga" instead of a preview.
   */
  shared?: SharedNotice | null;
}

/** What a share without a caption is announced as. */
export interface SharedNotice {
  /** SESSION, GROUP, COACH, EXERCISE, ROUTINE or PROGRAM. */
  type: string;
  /** The name, for what people write; null for translated content. */
  title: string | null;
}

function messageFor(args: MessageReceivedArgs): NotificationMessage {
  if (args.hidePreviewInEmail) {
    return {
      key: 'messaging.receivedPrivate',
      params: { name: args.senderName },
    };
  }
  if (args.shared) {
    return {
      key: 'messaging.shared',
      params: {
        name: args.senderName,
        type: args.shared.type,
        title: args.shared.title,
      },
    };
  }
  return {
    key: 'messaging.received',
    params: {
      name: args.senderName,
      preview: truncatePreview(args.preview),
    },
  };
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
  // The override only ever turns a channel off: an email the person
  // switched off in their preferences stays off.
  const channelOverride: Partial<ChannelPreferences> = { in_app: false };
  if (args.suppressEmail || args.muted) {
    channelOverride.email = false;
  }
  if (args.muted) {
    channelOverride.push = false;
  }

  const params: NotifyParams = {
    userId: args.recipientId,
    type: NotificationType.MESSAGE_RECEIVED,
    message: messageFor(args),
    data: {
      screen: 'messages',
      queryParams: { conversationId: args.conversationId },
    },
    collapseKey: `conversation.${args.conversationId}`,
    channelOverride,
  };

  return params;
}

export interface MessageRequestReceivedArgs {
  recipientId: string;
  conversationId: string;
  /** Display name of the sender (firstName + lastName). null → "Someone". */
  senderName: string | null;
}

/**
 * Someone the reader isn't connected with wrote, so the chat waits in their
 * message requests (migration 090). Sent once, when the request starts; the
 * sender's further messages before it is accepted announce nothing.
 *
 * In the app and by push (the type's default), never by email, and with no
 * preview: a stranger's words don't land on a lock screen or in an inbox
 * before the reader chose to read them. Opens the conversation, which an app
 * that knows requests shows as one, and an older app as a chat.
 */
export function messageRequestReceived(
  args: MessageRequestReceivedArgs,
): NotifyParams {
  return {
    userId: args.recipientId,
    type: NotificationType.MESSAGE_REQUEST_RECEIVED,
    message: {
      key: 'messaging.requestReceived',
      params: { name: args.senderName },
    },
    data: {
      screen: 'messages',
      queryParams: { conversationId: args.conversationId },
    },
    collapseKey: `conversation.${args.conversationId}`,
    channelOverride: { email: false },
  };
}
