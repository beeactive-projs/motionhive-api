import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { from, fromEvent, interval, merge, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

/**
 * Live-event types delivered over the SSE stream.
 *
 * Adding a new variant: bump this union AND the FE event handler
 * exhaustive switch — don't add a generic "data" type, the FE needs
 * to know which signal it just received.
 */
export type MessagingStreamEvent =
  | { type: 'message.created'; payload: MessageCreatedPayload }
  | { type: 'message.deleted'; payload: MessageDeletedPayload }
  | { type: 'conversation.read'; payload: ConversationReadPayload }
  | { type: 'conversation.muted'; payload: ConversationMutedPayload }
  | { type: 'conversation.unread'; payload: ConversationUnreadPayload }
  | { type: 'heartbeat'; payload: { ts: number } };

export interface MessageCreatedPayload {
  conversationId: string;
  message: {
    id: string;
    senderId: string | null;
    body: string;
    kind: string;
    createdAt: string;
  };
}

export interface MessageDeletedPayload {
  conversationId: string;
  messageId: string;
}

export interface ConversationReadPayload {
  conversationId: string;
  userId: string;
  lastReadAt: string;
}

export interface ConversationMutedPayload {
  conversationId: string;
  userId: string;
  mutedUntil: string | null;
}

/** The reader's own "mark as unread" flag, set or cleared. Sent to the reader only. */
export interface ConversationUnreadPayload {
  conversationId: string;
  userId: string;
  markedUnread: boolean;
}

/**
 * Internal envelope carried on the EventEmitter2 bus. The recipient
 * list lives outside the payload so the per-user filter in
 * `subscribeForUser` doesn't peek into payload shapes.
 */
interface BusEnvelope {
  recipientIds: string[];
  event: MessagingStreamEvent;
}

/** Heartbeat cadence: every 25s. Slightly under most proxy idle timeouts. */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** Internal channel name. Single channel — fan-out is per-user via filter. */
const BUS_CHANNEL = 'messaging.event';

/**
 * Best-effort replay buffer. Per user, we keep the last N events with
 * their assigned ids so a reconnecting client (browser EventSource
 * sends `Last-Event-ID` automatically) can catch up on events it
 * missed during the gap.
 *
 * Caveats — documented explicitly:
 *   - In-process only. Events emitted while the API was DOWN are gone.
 *     The FE compensates by refetching the conversation list/messages
 *     on reconnect — durable replay requires a real event log (deferred
 *     to v2).
 *   - Per-user buffer cap. If the user was offline long enough to
 *     overflow, replay yields whatever fits and the FE refetches to
 *     fill the gap.
 *   - Heartbeats are NOT buffered (no value to replay).
 */
const REPLAY_BUFFER_SIZE = 100;

/**
 * How long a replay entry stays in memory. Beyond this, even if the
 * buffer hasn't overflowed, we drop the entry — the FE should have
 * refetched by then.
 */
const REPLAY_TTL_MS = 10 * 60 * 1000;

/**
 * Fan-out for messaging real-time events.
 *
 * The single seam between the message-writing path (sendMessage,
 * deleteOwnMessage, etc.) and the SSE delivery path. Swap the
 * implementation for a Redis Pub/Sub adapter the day you scale to
 * multiple API instances — the public interface stays identical.
 *
 * NOTE: this service deliberately never opens DB transactions or
 * touches Sequelize. Per the security checklist (plan §6) the SSE
 * subscribe path must NOT hold a DB connection per stream.
 */
interface ReplayEntry {
  id: string;
  event: MessagingStreamEvent;
  recordedAt: number;
}

@Injectable()
export class MessagingEventsService implements OnModuleDestroy {
  /**
   * Per-user ring buffer of recent events. `userId → entries`. Indexed
   * by user so replay queries don't scan a global log.
   */
  private readonly replayByUser = new Map<string, ReplayEntry[]>();

  /** Periodic sweep to drop expired entries. unref()'d to never block exit. */
  private readonly sweepTimer: NodeJS.Timeout = setInterval(
    () => this.sweepReplay(),
    60_000,
  ).unref();

  constructor(private readonly events: EventEmitter2) {}

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    this.replayByUser.clear();
  }

  // =========================================================================
  // Producer side — called by MessagingService after commit
  // =========================================================================

  emitMessageCreated(
    recipientIds: string[],
    payload: MessageCreatedPayload,
  ): void {
    this.publish(recipientIds, { type: 'message.created', payload });
  }

  emitMessageDeleted(
    recipientIds: string[],
    payload: MessageDeletedPayload,
  ): void {
    this.publish(recipientIds, { type: 'message.deleted', payload });
  }

  emitConversationRead(
    recipientIds: string[],
    payload: ConversationReadPayload,
  ): void {
    this.publish(recipientIds, { type: 'conversation.read', payload });
  }

  emitConversationMuted(
    recipientIds: string[],
    payload: ConversationMutedPayload,
  ): void {
    this.publish(recipientIds, { type: 'conversation.muted', payload });
  }

  emitConversationUnread(
    recipientIds: string[],
    payload: ConversationUnreadPayload,
  ): void {
    this.publish(recipientIds, { type: 'conversation.unread', payload });
  }

  // =========================================================================
  // Consumer side — called by the SSE controller
  // =========================================================================

  /**
   * Observable of events the given user is allowed to see, plus a
   * heartbeat tick every HEARTBEAT_INTERVAL_MS.
   *
   * If `lastEventId` is supplied (typically from the `Last-Event-ID`
   * header on reconnect), the observable first emits buffered events
   * that occurred AFTER that id, then continues with the live stream.
   * The replay is best-effort (in-memory, capped, single-instance).
   *
   * The NestJS `@Sse()` decorator emits each value as a JSON SSE frame
   * with the `id:` line set so the browser tracks `Last-Event-ID`.
   */
  subscribeForUser(
    userId: string,
    lastEventId?: string,
  ): Observable<{ id: string; data: MessagingStreamEvent }> {
    const replay = lastEventId
      ? this.replayEventsAfter(userId, lastEventId)
      : [];

    const events$ = fromEvent<BusEnvelope>(this.events, BUS_CHANNEL).pipe(
      filter((envelope) => envelope.recipientIds.includes(userId)),
      map((envelope) => envelope.event),
    );

    const heartbeat$ = interval(HEARTBEAT_INTERVAL_MS).pipe(
      map<number, MessagingStreamEvent>(() => ({
        type: 'heartbeat',
        payload: { ts: Date.now() },
      })),
    );

    // Replay first (preserves the original ids so the FE doesn't see
    // duplicate ids on reconnect), then the live stream with fresh ids.
    const replay$ = from(
      replay.map((entry) => ({ id: entry.id, data: entry.event })),
    );
    const live$ = merge(events$, heartbeat$).pipe(
      map((event) => ({ id: randomUUID(), data: event })),
    );

    return merge(replay$, live$);
  }

  /**
   * Test-only diagnostic. Returns the current replay buffer for a
   * user. NEVER call in prod code.
   */
  getReplayBufferForTests(userId: string): ReplayEntry[] {
    return [...(this.replayByUser.get(userId) ?? [])];
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private publish(recipientIds: string[], event: MessagingStreamEvent): void {
    if (recipientIds.length === 0) return;
    const envelope: BusEnvelope = { recipientIds, event };
    // Pre-assign an id so the replay buffer and the live emission
    // share the same identifier for the same event. The live observable
    // re-assigns its own id via map() below, but for *replay* we want
    // the SSE `id:` to be stable so the FE's Last-Event-ID cursor
    // makes sense after reconnect.
    const id = randomUUID();
    const recordedAt = Date.now();
    for (const userId of recipientIds) {
      this.appendToReplay(userId, { id, event, recordedAt });
    }
    this.events.emit(BUS_CHANNEL, envelope);
  }

  private appendToReplay(userId: string, entry: ReplayEntry): void {
    let buf = this.replayByUser.get(userId);
    if (!buf) {
      buf = [];
      this.replayByUser.set(userId, buf);
    }
    buf.push(entry);
    if (buf.length > REPLAY_BUFFER_SIZE) {
      buf.shift();
    }
  }

  /**
   * Return all buffered events for this user that occurred AFTER the
   * supplied last-event-id. If the id isn't in the buffer (overflowed,
   * expired, or never existed), returns an empty array — the caller
   * relies on the FE's REST refetch to fill the gap.
   */
  private replayEventsAfter(
    userId: string,
    lastEventId: string,
  ): ReplayEntry[] {
    const buf = this.replayByUser.get(userId) ?? [];
    const cutoff = Date.now() - REPLAY_TTL_MS;
    const idx = buf.findIndex((e) => e.id === lastEventId);
    if (idx < 0) return [];
    return buf.slice(idx + 1).filter((e) => e.recordedAt > cutoff);
  }

  private sweepReplay(): void {
    const cutoff = Date.now() - REPLAY_TTL_MS;
    for (const [userId, buf] of this.replayByUser) {
      const filtered = buf.filter((e) => e.recordedAt > cutoff);
      if (filtered.length === 0) {
        this.replayByUser.delete(userId);
      } else if (filtered.length !== buf.length) {
        this.replayByUser.set(userId, filtered);
      }
    }
  }
}
