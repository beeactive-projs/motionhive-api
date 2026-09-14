import type { LoggerService } from '@nestjs/common';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { randomUUID } from 'crypto';
import { col, fn, Op, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  buildPaginatedResponse,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';
import { User, USER_SAFE_ATTRIBUTES } from '../user/entities/user.entity';
import { Conversation, ConversationType } from './entities/conversation.entity';
import {
  ConversationParticipant,
  ConversationParticipantRole,
} from './entities/conversation-participant.entity';
import { Message, MessageKind } from './entities/message.entity';
import {
  MessagingContentService,
  ThreatScanResult,
} from './messaging-content.service';
import { MessagingEventsService } from './messaging-events.service';
import { MessagingRateLimitService } from './messaging-rate-limit.service';
import { MessagingSafetyService } from './messaging-safety.service';
import { MessagingVelocityService } from './messaging-velocity.service';
import { NotificationService } from '../notification/notification.service';
import { messageReceived } from './notifications';
import { DELETED_MESSAGE_BODY, directKeyFor } from './constants';

// ---------------------------------------------------------------------------
// Public-facing shapes returned by the service. Plain JSON, ready for the
// camelCase interceptor.
// ---------------------------------------------------------------------------

export interface ConversationListItem {
  id: string;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  muted: boolean;
  /**
   * For DIRECT conversations only: the *other* participant. null for groups.
   */
  otherUser: ParticipantSnapshot | null;
  /**
   * For DIRECT conversations only: the *other* participant's `lastReadAt`
   * (ISO string), so the FE can render a read receipt on the caller's own
   * messages without an extra round-trip. null for groups, or when the other
   * side has never read the thread.
   */
  lastReadByOther: string | null;
}

export interface ParticipantSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  /** Null until the user picks one. Addresses their public profile. */
  handle: string | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface SendMessageResult {
  /** Always present so the FE can append optimistically. */
  message: MessageView;
  conversation: ConversationListItem;
  /**
   * `true` on the happy path. `false` when the message was suppressed by
   * a safety check that produces a silent drop (e.g. recipient blocked
   * the sender). The FE renders identically in both cases — the sender
   * MUST NOT learn whether the recipient actually received the message.
   */
  delivered: boolean;
  /**
   * Content scan attached to the response. The FE shows a warning
   * banner inside the sender's own thread (and only there) when any
   * flag fires. Never returned to the recipient.
   */
  threatFlags: ThreatScanResult;
}

// Tombstone moved to ./constants — single source of truth.
const DELETED_BODY_TOMBSTONE = DELETED_MESSAGE_BODY;

/** The conversation fields an inbox row is built from. */
type ConversationSummary = Pick<
  Conversation,
  'id' | 'type' | 'name' | 'avatarUrl' | 'lastMessageAt' | 'lastMessagePreview'
>;

/**
 * MessagingService — core conversation/message operations.
 *
 * Stage 2 implements the bare functional flow (send / list / read /
 * mute / leave / soft-delete-own). Safety gating (block, suspension,
 * new-account rule) is layered in Stage 3 via MessagingSafetyService.
 *
 * All multi-table writes run inside a single Sequelize transaction.
 * Body access uses the get/setMessageBody helpers so a future encryption
 * swap touches exactly two functions.
 */
@Injectable()
export class MessagingService {
  constructor(
    @InjectModel(Conversation)
    private readonly conversationModel: typeof Conversation,
    @InjectModel(ConversationParticipant)
    private readonly participantModel: typeof ConversationParticipant,
    @InjectModel(Message)
    private readonly messageModel: typeof Message,
    private readonly sequelize: Sequelize,
    private readonly safety: MessagingSafetyService,
    private readonly content: MessagingContentService,
    private readonly rateLimit: MessagingRateLimitService,
    private readonly velocity: MessagingVelocityService,
    private readonly notifications: NotificationService,
    private readonly emitter: MessagingEventsService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =========================================================================
  // Body helpers — single seam for future application-level encryption.
  // =========================================================================

  /**
   * Read the body of a message as plaintext.
   *
   * Why: single seam for future encryption-at-rest. Today: passthrough.
   * How to apply: every consumer that needs plaintext (controller
   * response, notification preview, threat scan, SSE payload) MUST call
   * this — never read `message.body` directly.
   */
  getMessageBody(stored: string): string {
    return stored;
  }

  /**
   * Convert a plaintext body to the form stored on the row.
   *
   * Why: single seam for future encryption-at-rest. Today: passthrough.
   * How to apply: every place that writes `message.body` MUST go through
   * this — never `model.create({ body: rawUserInput })`.
   */
  setMessageBody(plaintext: string): string {
    return plaintext;
  }

  // =========================================================================
  // Send
  // =========================================================================

  /**
   * Send a DM. Creates the conversation on first send between two users;
   * reuses it on subsequent sends.
   *
   * Stage 2: no safety gating yet (block/suspension/new-account land in
   * Stage 3). Stage 2 still asserts:
   *   - sender ≠ recipient
   *   - recipient is a real (non-deleted) user
   *   - body has been validated by the DTO
   */
  async sendMessage(
    senderId: string,
    recipientId: string,
    rawBody: string,
  ): Promise<SendMessageResult> {
    if (senderId === recipientId) {
      throw new BadRequestException('Cannot send a message to yourself.');
    }

    // ── Rate limit FIRST ────────────────────────────────────────────
    // Cheapest reject — does not touch the DB. We don't yet know the
    // conversationId (might not exist), so this is the per-user
    // 30/min ceiling only. The per-conversation soft throttle runs
    // again after we resolve/create the conversation.
    await this.rateLimit.assertSendAllowed(senderId);

    const trimmed = rawBody.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('Message body cannot be empty.');
    }

    // Load both sides up front. Sender → for the after-commit
    // notification body (avoids a second findByPk later). Recipient →
    // for the silent-drop response shape AND so we can decide whether
    // the recipient exists at all without leaking the answer.
    //
    // We include `isActive` on the recipient because a deactivated
    // user (account disabled but not deleted) cannot sign in to
    // receive the message — we treat them like a missing recipient
    // and silent-drop, matching the block-leak protections below.
    const [sender, recipient] = await Promise.all([
      User.findByPk(senderId, {
        // createdAt feeds the safety gate's new-account rule so it does
        // not look the sender up a second time.
        attributes: ['id', 'firstName', 'lastName', 'createdAt'],
      }),
      User.findByPk(recipientId, {
        attributes: [
          'id',
          'firstName',
          'lastName',
          'avatarUrl',
          'handle',
          'isActive',
        ],
      }),
    ]);

    // Content scan — pure, runs whether delivered or silently dropped.
    // FE renders the warning banner from this regardless.
    const threatFlags = this.content.detectThreats(trimmed);

    // Treat a missing OR deactivated recipient as a silent drop, NOT a
    // 404. A 404 here distinguishes "user doesn't exist" from "user
    // blocked me", letting an attacker enumerate which user IDs are
    // blocking them. Same reasoning applies to deactivated accounts —
    // they can't sign in, so delivery would be wasted.
    if (!recipient || !recipient.isActive) {
      return this.buildSilentDropResponse(
        senderId,
        // Synthesize a minimal recipient stub for the response shape.
        // The user id stays the one the sender supplied — the sender
        // already knows it.
        {
          id: recipientId,
          firstName: 'Unknown',
          lastName: 'User',
          avatarUrl: null,
          handle: null,
        },
        trimmed,
        threatFlags,
      );
    }

    // ── Safety gate ──────────────────────────────────────────────────
    // Asked BEFORE the transaction so we never write a row that would
    // need to be rolled back (and never emit an event for a blocked
    // send). The gate decides between three semantically distinct
    // outcomes — see CanMessageResult.
    const verdict = await this.safety.canMessage(senderId, recipientId, {
      senderCreatedAt: sender?.createdAt ?? null,
    });

    if (verdict.kind === 'forbidden') {
      throw new ForbiddenException(verdict.reason);
    }

    if (verdict.kind === 'silentDrop') {
      // Recipient has blocked sender. Build a synthetic response that
      // looks identical to a successful send so the sender's UI cannot
      // distinguish the two states. NO row is written.
      return this.buildSilentDropResponse(
        senderId,
        recipient,
        trimmed,
        threatFlags,
      );
    }

    // ── Happy path ────────────────────────────────────────────────────
    // Resolve or create the conversation BEFORE the message transaction:
    //   1. The per-conversation rate limit needs a conversation id and
    //      should run *outside* the message tx so a 429 doesn't leave
    //      a stale slot reservation when the tx rolls back.
    //   2. The lookup is a plain read; only the first-send create path
    //      opens a transaction (see findOrCreateDirectConversation).
    const conversation = await this.findOrCreateDirectConversation(
      senderId,
      recipientId,
    );

    await this.rateLimit.assertSendAllowed(senderId, conversation.id);

    // Capture the previous-message timestamp BEFORE the update writes
    // the new one. This drives the email "quiet-period" gate — if the
    // conversation has been silent for > EMAIL_QUIET_PERIOD_MS we'll
    // email the recipient; otherwise they're presumably still engaged
    // and we stay out of their inbox.
    const previousMessageAt: Date | null = conversation.lastMessageAt;

    const storedBody = this.setMessageBody(trimmed);
    const preview = trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
    const now = new Date();
    const metadata = threatFlags.anyFlag ? { threatFlags } : null;

    // The write and the participant lookup are independent, so they
    // share one round trip. `returning: true` makes the INSERT hand the
    // full row back (DB defaults included), so the created message is
    // used as-is instead of being re-fetched by id.
    const [createdMessage, participants] = await Promise.all([
      this.sequelize.transaction(async (tx) => {
        const message = await this.messageModel.create(
          {
            conversationId: conversation.id,
            senderId,
            kind: MessageKind.TEXT,
            body: storedBody,
            metadata,
          },
          { transaction: tx, returning: true },
        );

        await this.conversationModel.update(
          { lastMessageAt: now, lastMessagePreview: preview, updatedAt: now },
          { where: { id: conversation.id }, transaction: tx },
        );

        return message;
      }),
      this.participantModel.findAll({
        where: { conversationId: conversation.id },
        include: [{ model: User, attributes: USER_SAFE_ATTRIBUTES }],
      }),
    ]);

    const self =
      participants.find((p) => p.userId === senderId && !p.leftAt) ?? null;
    if (!self) {
      // Should never happen — the sender's participant row was written
      // together with the conversation.
      throw new NotFoundException('Conversation state vanished after send.');
    }
    // v1 is DIRECT-only, so "the other side" is the one non-sender row.
    const other = participants.find((p) => p.userId !== senderId) ?? null;

    const unread = await this.countUnreadFor(
      senderId,
      conversation.id,
      self.lastReadAt,
    );
    const listItem = this.toListItem(
      self,
      {
        id: conversation.id,
        type: conversation.type,
        name: conversation.name,
        avatarUrl: conversation.avatarUrl,
        // Reflect the write we just committed without re-reading the row.
        lastMessageAt: now,
        lastMessagePreview: preview,
      },
      unread,
      other,
    );

    // Velocity bookkeeping AFTER commit. Fire-and-forget — alarm
    // failures must never break message delivery.
    void this.velocity.recordSendAndMaybeAlarm(senderId);

    // Realtime fan-out AFTER commit. Only the *other* participants
    // receive the live event — the sender already has the REST
    // response and rendering it twice would create double-bubbles in
    // their own thread. Group v2 will broaden this to all non-sender
    // active participants automatically.
    this.emitter.emitMessageCreated([recipientId], {
      conversationId: conversation.id,
      message: {
        id: createdMessage.id,
        senderId: createdMessage.senderId,
        body: this.getMessageBody(createdMessage.body),
        kind: createdMessage.kind,
        createdAt: createdMessage.createdAt.toISOString(),
      },
    });

    // notify-after-commit: in-app channel is always off (the Messages
    // sidebar badge is the persistent in-app signal); email follows
    // the "quiet-period" rule — sent only when the conversation has
    // been silent for > EMAIL_QUIET_PERIOD_MS since the previous
    // message. Sender display name is threaded through from the
    // upfront lookup — no second query.
    const senderName =
      [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim() ||
      null;
    void this.dispatchMessageReceivedNotification(
      recipientId,
      conversation.id,
      senderName,
      trimmed,
      previousMessageAt,
    );

    return {
      message: this.toMessageView(createdMessage),
      conversation: listItem,
      delivered: true,
      threatFlags,
    };
  }

  /**
   * Dispatch the MESSAGE_RECEIVED notification to the recipient. Runs
   * AFTER commit (see sendMessage) and is fire-and-forget — failures
   * here are logged, never propagated.
   *
   * Sender display name is threaded from the upfront `User.findByPk`
   * in sendMessage so we don't issue a second query here.
   */
  private async dispatchMessageReceivedNotification(
    recipientId: string,
    conversationId: string,
    senderName: string | null,
    plaintext: string,
    previousMessageAt: Date | null,
  ): Promise<void> {
    try {
      const suppressEmail =
        this.rateLimit.shouldSuppressMessageEmail(previousMessageAt);

      await this.notifications.notify(
        messageReceived({
          recipientId,
          conversationId,
          senderName,
          preview: plaintext,
          suppressEmail,
          // v1: hidePreviewInEmail comes from a per-user preference we
          // haven't surfaced yet. Default to false (include preview)
          // matching the recommendation in the security discussion.
          hidePreviewInEmail: false,
        }),
      );
    } catch (err) {
      this.logger.error?.(
        `[messaging] notify dispatch failed for ${recipientId} in ${conversationId}: ${(err as Error).message}`,
        (err as Error).stack,
        'MessagingService',
      );
    }
  }

  /**
   * Synthetic response returned when the recipient has blocked the
   * sender. The response is shaped exactly like a successful send so
   * the FE renders the message in the sender's own thread without
   * revealing the block.
   */
  private buildSilentDropResponse(
    senderId: string,
    recipient: Pick<
      User,
      'id' | 'firstName' | 'lastName' | 'avatarUrl' | 'handle'
    >,
    plaintext: string,
    threatFlags: ThreatScanResult,
  ): SendMessageResult {
    const now = new Date();
    // Use real UUIDs so the FE cannot tell a silent-drop apart from a
    // successful send by inspecting the id shape. The synthetic ids
    // are never persisted and will 404 if the FE looks them up — which
    // it shouldn't (the response shape is final).
    const syntheticConversationId = randomUUID();
    const syntheticMessageId = randomUUID();
    return {
      message: {
        id: syntheticMessageId,
        conversationId: syntheticConversationId,
        senderId,
        kind: MessageKind.TEXT,
        body: plaintext,
        deletedAt: null,
        createdAt: now,
      },
      conversation: {
        id: syntheticConversationId,
        type: ConversationType.DIRECT,
        name: null,
        avatarUrl: null,
        lastMessageAt: now,
        lastMessagePreview:
          plaintext.length > 200 ? plaintext.slice(0, 200) : plaintext,
        unreadCount: 0,
        muted: false,
        otherUser: {
          id: recipient.id,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          avatarUrl: recipient.avatarUrl ?? null,
          handle: recipient.handle ?? null,
        },
        lastReadByOther: null,
      },
      delivered: false,
      threatFlags,
    };
  }

  // =========================================================================
  // Read — list conversations, list messages, get one conversation
  // =========================================================================

  async listConversations(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<ConversationListItem>> {
    const offset = (page - 1) * limit;

    const { rows, count } = await this.participantModel.findAndCountAll({
      where: { userId, leftAt: null },
      include: [
        {
          model: Conversation,
          required: true,
        },
      ],
      order: [
        [
          { model: Conversation, as: 'conversation' },
          'lastMessageAt',
          'DESC NULLS LAST',
        ],
        [{ model: Conversation, as: 'conversation' }, 'updatedAt', 'DESC'],
      ],
      limit,
      offset,
      distinct: true,
    });

    const items = await this.hydrateListItems(userId, rows);

    return buildPaginatedResponse(items, count, page, limit);
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationListItem> {
    await this.assertParticipant(userId, conversationId);
    const item = await this.buildListItemForUser(userId, conversationId);
    if (!item) {
      // We just asserted participation — but if the conversation was
      // hard-deleted between the two queries, 404.
      throw new NotFoundException('Conversation not found.');
    }
    return item;
  }

  async listMessages(
    userId: string,
    conversationId: string,
    cursor: { before?: string; limit: number },
  ): Promise<{ items: MessageView[]; nextBefore: string | null }> {
    await this.assertParticipant(userId, conversationId);

    const limit = Math.min(Math.max(cursor.limit, 1), 100);

    const where: {
      conversationId: string;
      createdAt?: { [Op.lt]: Date };
    } = { conversationId };

    if (cursor.before) {
      const beforeMessage = await this.messageModel.findOne({
        where: { id: cursor.before, conversationId },
        attributes: ['id', 'createdAt'],
      });
      if (!beforeMessage) {
        throw new BadRequestException(
          'Cursor message not found in conversation.',
        );
      }
      where.createdAt = { [Op.lt]: beforeMessage.createdAt };
    }

    const rows = await this.messageModel.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((m) =>
      this.toMessageView(m),
    );
    const nextBefore = hasMore ? items[items.length - 1].id : null;

    return { items, nextBefore };
  }

  /**
   * Fetch a single message. Used for permalinks. Returns 404 (not
   * 403) when the caller is not a participant in the message's
   * conversation — same existence-leak rules as listMessages.
   */
  async getMessage(userId: string, messageId: string): Promise<MessageView> {
    const message = await this.messageModel.findByPk(messageId, {
      attributes: [
        'id',
        'conversationId',
        'senderId',
        'kind',
        'body',
        'deletedAt',
        'createdAt',
      ],
    });
    if (!message) {
      throw new NotFoundException('Message not found.');
    }
    // assertParticipant 404s if the user isn't in the conversation —
    // same shape as the message-not-found path. No leak.
    await this.assertParticipant(userId, message.conversationId);
    return this.toMessageView(message);
  }

  /**
   * Total unread count for the user across all active conversations.
   * Powers the global badge.
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const participants = await this.participantModel.findAll({
      where: { userId, leftAt: null },
      attributes: ['conversationId', 'lastReadAt'],
    });

    if (participants.length === 0) {
      return { count: 0 };
    }

    // One grouped query rather than a count per thread. This badge is
    // fetched on every page load, and counting serially made it the
    // slowest call a user with a busy inbox makes — N round trips where
    // one does.
    const byConversation = await this.countUnreadByConversation(
      userId,
      participants,
    );

    let total = 0;
    for (const count of byConversation.values()) {
      total += count;
    }

    return { count: total };
  }

  // =========================================================================
  // Write — mark read, mute, leave, delete own
  // =========================================================================

  async markRead(
    userId: string,
    conversationId: string,
    upToIso?: string,
  ): Promise<{ lastReadAt: Date }> {
    await this.assertParticipant(userId, conversationId);

    const now = new Date();
    let upTo = upToIso ? new Date(upToIso) : now;
    if (Number.isNaN(upTo.getTime())) {
      throw new BadRequestException('upToIso is not a valid ISO timestamp.');
    }
    // Clamp to "now" — a client supplying a future timestamp would
    // prematurely mark messages-not-yet-received as read.
    if (upTo.getTime() > now.getTime()) {
      upTo = now;
    }

    // Wrap the write in a tx so the emit-after-commit pattern can be
    // honoured. If the update affects zero rows (participant left
    // between assertParticipant and here) we still emit — the event
    // is idempotent and the FE side-effect (clear local unread) is
    // safe to repeat.
    await this.sequelize.transaction(async (tx) => {
      await this.participantModel.update(
        { lastReadAt: upTo },
        {
          where: { conversationId, userId, leftAt: null },
          transaction: tx,
        },
      );
    });

    // Tell the *other* participants the conversation was read (powers
    // future read-receipt indicators on the FE — v1 just relies on it
    // to clear unread badges live). notify-after-commit.
    const otherIds = await this.otherActiveParticipantIds(
      conversationId,
      userId,
    );
    this.emitter.emitConversationRead(otherIds, {
      conversationId,
      userId,
      lastReadAt: upTo.toISOString(),
    });

    return { lastReadAt: upTo };
  }

  async muteConversation(
    userId: string,
    conversationId: string,
    untilIso: string | null | undefined,
  ): Promise<{ mutedUntil: Date | null }> {
    await this.assertParticipant(userId, conversationId);

    let mutedUntil: Date | null = null;
    if (untilIso) {
      const parsed = new Date(untilIso);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('untilIso is not a valid ISO timestamp.');
      }
      // Past timestamp = treat as unmute (defensive).
      mutedUntil = parsed.getTime() > Date.now() ? parsed : null;
    }

    await this.participantModel.update(
      { mutedUntil },
      { where: { conversationId, userId, leftAt: null } },
    );

    // Fan the mute change out over SSE to the same user's other
    // sessions/tabs so the inbox row indicator updates everywhere
    // without a refresh. Single recipient — the actor themselves.
    this.emitter.emitConversationMuted([userId], {
      conversationId,
      userId,
      mutedUntil: mutedUntil ? mutedUntil.toISOString() : null,
    });

    return { mutedUntil };
  }

  /**
   * Soft-leave a conversation. v1 DMs reject (use block instead). Group
   * conversations let the user leave with `left_at` set.
   */
  async leave(userId: string, conversationId: string): Promise<void> {
    await this.assertParticipant(userId, conversationId);

    const conversation = await this.conversationModel.findByPk(conversationId, {
      attributes: ['id', 'type'],
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    if (conversation.type === ConversationType.DIRECT) {
      throw new BadRequestException(
        'Cannot leave a direct conversation. Block the other user instead.',
      );
    }

    await this.participantModel.update(
      { leftAt: new Date() },
      { where: { conversationId, userId, leftAt: null } },
    );
  }

  /**
   * Sender soft-deletes their own message. Replaces the body with a
   * tombstone so plaintext is gone, but the row stays for thread
   * continuity ("this message was deleted").
   */
  async deleteOwnMessage(
    userId: string,
    messageId: string,
  ): Promise<MessageView> {
    const message = await this.messageModel.findByPk(messageId);
    if (!message) {
      throw new NotFoundException('Message not found.');
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages.');
    }
    if (message.deletedAt) {
      return this.toMessageView(message);
    }

    // Resolve the recipients BEFORE the update so we can emit the
    // event immediately after the write commits — same notify-after-
    // commit pattern used elsewhere. Doing it after the update would
    // be fine for in-process pubsub but breaks when this fans out to
    // Redis (a listener could observe the delete event before the
    // row's `deletedAt` is queryable).
    const otherIds = await this.otherActiveParticipantIds(
      message.conversationId,
      userId,
    );

    await message.update({
      deletedAt: new Date(),
      deletedById: userId,
      body: this.setMessageBody(DELETED_BODY_TOMBSTONE),
    });

    // Tell the other participants the message was removed so the FE
    // can replace it with the "[deleted]" tombstone in place.
    this.emitter.emitMessageDeleted(otherIds, {
      conversationId: message.conversationId,
      messageId: message.id,
    });

    return this.toMessageView(message);
  }

  // =========================================================================
  // Authorization helper — exposed for the conversation-participant guard.
  // =========================================================================

  /**
   * Delegates to MessagingSafetyService — there is exactly one
   * authoritative implementation of "is this user a participant", in
   * the safety service. Kept on MessagingService as a convenience so
   * callers don't need to inject both.
   */
  async assertParticipant(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.safety.assertParticipant(userId, conversationId);
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Look up the canonical DIRECT conversation between two users; create
   * it (with both participant rows) on first send.
   *
   * The lookup is a plain read and deliberately runs outside any
   * transaction — every send after the first takes this branch, and a
   * BEGIN/COMMIT pair around one SELECT is two wasted round trips.
   *
   * Concurrent-first-send race protection comes from the partial UNIQUE
   * index on `conversation.direct_key` (migration 039): if two senders
   * create simultaneously, exactly one insert succeeds. The loser's
   * transaction rolls back on the UniqueConstraintError and it re-reads
   * the winner's row.
   */
  private async findOrCreateDirectConversation(
    aId: string,
    bId: string,
  ): Promise<Conversation> {
    const directKey = directKeyFor(aId, bId);
    const [sortedA, sortedB] = [aId, bId].sort();

    // Fast path: lookup by the deterministic key.
    const existing = await this.conversationModel.findOne({
      where: { type: ConversationType.DIRECT, directKey },
    });
    if (existing) return existing;

    try {
      return await this.sequelize.transaction(async (tx) => {
        const conversation = await this.conversationModel.create(
          {
            type: ConversationType.DIRECT,
            createdById: aId,
            directKey,
          },
          { transaction: tx },
        );

        await this.participantModel.bulkCreate(
          [
            {
              conversationId: conversation.id,
              userId: sortedA,
              role: ConversationParticipantRole.MEMBER,
            },
            {
              conversationId: conversation.id,
              userId: sortedB,
              role: ConversationParticipantRole.MEMBER,
            },
          ],
          { transaction: tx },
        );

        return conversation;
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        // Another concurrent sender won the create; our transaction
        // rolled back. Re-read by the deterministic key to grab the
        // winner.
        const winner = await this.conversationModel.findOne({
          where: { type: ConversationType.DIRECT, directKey },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * Active participants of a conversation, minus the actor. Used by
   * the realtime emit calls to figure out who needs the live event.
   * Excludes rows with `left_at` set so a user who left a group
   * doesn't keep receiving its events.
   */
  private async otherActiveParticipantIds(
    conversationId: string,
    actorId: string,
  ): Promise<string[]> {
    const rows = await this.participantModel.findAll({
      where: {
        conversationId,
        leftAt: null,
        userId: { [Op.ne]: actorId },
      },
      attributes: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  /**
   * Build a single inbox-list item for the given user + conversation.
   * Returns null if the conversation no longer exists or the user is
   * no longer an active participant.
   */
  private async buildListItemForUser(
    userId: string,
    conversationId: string,
  ): Promise<ConversationListItem | null> {
    const participant = await this.participantModel.findOne({
      where: { conversationId, userId, leftAt: null },
      include: [
        {
          model: Conversation,
          required: true,
        },
      ],
    });
    if (!participant || !participant.conversation) {
      return null;
    }
    const [item] = await this.hydrateListItems(userId, [participant]);
    return item ?? null;
  }

  /**
   * Inbox hydration for N participant rows (each with `conversation`
   * included) in two queries total, regardless of N: one grouped
   * unread count and one lookup of the other side of every DIRECT
   * thread. The previous per-row version issued 2N queries, which on a
   * remote database turned a 20-thread inbox into 40 round trips.
   */
  private async hydrateListItems(
    userId: string,
    participants: ConversationParticipant[],
  ): Promise<ConversationListItem[]> {
    if (participants.length === 0) return [];

    const directIds = participants
      .filter((p) => p.conversation.type === ConversationType.DIRECT)
      .map((p) => p.conversationId);

    const [unreadByConversation, otherByConversation] = await Promise.all([
      this.countUnreadByConversation(userId, participants),
      this.otherParticipantByConversation(userId, directIds),
    ]);

    return participants.map((p) =>
      this.toListItem(
        p,
        p.conversation,
        unreadByConversation.get(p.conversationId) ?? 0,
        otherByConversation.get(p.conversationId) ?? null,
      ),
    );
  }

  /**
   * Unread messages per conversation for one user, in a single grouped
   * query. "Unread" = sent by someone else, not deleted, and newer than
   * the user's `lastReadAt` for that conversation (everything when they
   * have never read it).
   */
  private async countUnreadByConversation(
    userId: string,
    participants: ConversationParticipant[],
  ): Promise<Map<string, number>> {
    const rows = (await this.messageModel.findAll({
      attributes: ['conversationId', [fn('COUNT', col('Message.id')), 'count']],
      where: {
        senderId: { [Op.ne]: userId },
        deletedAt: null,
        [Op.or]: participants.map((p) => ({
          conversationId: p.conversationId,
          ...(p.lastReadAt ? { createdAt: { [Op.gt]: p.lastReadAt } } : {}),
        })),
      },
      group: ['Message.conversation_id'],
      raw: true,
    })) as unknown as Array<{ conversationId: string; count: string | number }>;

    return new Map(rows.map((r) => [r.conversationId, Number(r.count)]));
  }

  /** The non-`userId` participant of each DIRECT conversation, with user. */
  private async otherParticipantByConversation(
    userId: string,
    conversationIds: string[],
  ): Promise<Map<string, ConversationParticipant>> {
    const byConversation = new Map<string, ConversationParticipant>();
    if (conversationIds.length === 0) return byConversation;

    const rows = await this.participantModel.findAll({
      where: {
        conversationId: { [Op.in]: conversationIds },
        userId: { [Op.ne]: userId },
      },
      include: [{ model: User, attributes: USER_SAFE_ATTRIBUTES }],
    });
    for (const row of rows) {
      if (!byConversation.has(row.conversationId)) {
        byConversation.set(row.conversationId, row);
      }
    }
    return byConversation;
  }

  /** Unread count for one user in one conversation (see above). */
  private countUnreadFor(
    userId: string,
    conversationId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    return this.messageModel.count({
      where: {
        conversationId,
        senderId: { [Op.ne]: userId },
        deletedAt: null,
        ...(lastReadAt ? { createdAt: { [Op.gt]: lastReadAt } } : {}),
      },
    });
  }

  /**
   * Shape one inbox row. Pure — every input has already been loaded, so
   * callers control how many queries the hydration costs.
   */
  private toListItem(
    participant: ConversationParticipant,
    conversation: ConversationSummary,
    unreadCount: number,
    other: ConversationParticipant | null,
  ): ConversationListItem {
    const otherUser: ParticipantSnapshot | null = other?.user
      ? {
          id: other.user.id,
          firstName: other.user.firstName,
          lastName: other.user.lastName,
          avatarUrl: other.user.avatarUrl ?? null,
          handle: other.user.handle ?? null,
        }
      : null;
    const lastReadByOther = other?.lastReadAt
      ? other.lastReadAt.toISOString()
      : null;

    const mutedUntil = participant.mutedUntil;
    const muted = !!(mutedUntil && mutedUntil.getTime() > Date.now());

    return {
      id: conversation.id,
      type: conversation.type,
      name: conversation.name,
      avatarUrl: conversation.avatarUrl,
      lastMessageAt: conversation.lastMessageAt,
      lastMessagePreview: conversation.lastMessagePreview,
      unreadCount,
      muted,
      otherUser,
      lastReadByOther,
    };
  }

  private toMessageView(message: Message): MessageView {
    const isDeleted = !!message.deletedAt;
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      kind: message.kind,
      body: isDeleted
        ? DELETED_BODY_TOMBSTONE
        : this.getMessageBody(message.body),
      deletedAt: message.deletedAt,
      createdAt: message.createdAt,
    };
  }
}
