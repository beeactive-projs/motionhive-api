import { EventEmitter2 } from '@nestjs/event-emitter';
import { firstValueFrom } from 'rxjs';
import { filter, take, toArray } from 'rxjs/operators';

import {
  MessageCreatedPayload,
  MessagingEventsService,
  MessagingStreamEvent,
} from './messaging-events.service';

describe('MessagingEventsService — Stage 7', () => {
  let emitter: EventEmitter2;
  let service: MessagingEventsService;

  beforeEach(() => {
    emitter = new EventEmitter2();
    service = new MessagingEventsService(emitter);
  });

  function makePayload(convId = 'c-1', msgId = 'm-1'): MessageCreatedPayload {
    return {
      conversationId: convId,
      message: {
        id: msgId,
        senderId: 'sender',
        body: 'hi',
        kind: 'TEXT',
        createdAt: new Date().toISOString(),
      },
    };
  }

  // ─────────────────────────── per-user filter ──────────────────────

  it('subscribeForUser delivers events whose recipient list includes the user', async () => {
    const recipientStream = service.subscribeForUser('recipient').pipe(
      filter((e) => e.data.type !== 'heartbeat'),
      take(1),
    );
    const got = firstValueFrom(recipientStream);

    service.emitMessageCreated(['recipient'], makePayload());

    const event = await got;
    expect(event.data.type).toBe('message.created');
  });

  it('subscribeForUser does NOT deliver events for other users', async () => {
    const collected: MessagingStreamEvent[] = [];
    const sub = service
      .subscribeForUser('other-user')
      .pipe(filter((e) => e.data.type !== 'heartbeat'))
      .subscribe((e) => collected.push(e.data));

    service.emitMessageCreated(['recipient'], makePayload());

    // Give the event loop a tick to deliver if it were going to.
    await new Promise((r) => setImmediate(r));
    expect(collected).toHaveLength(0);
    sub.unsubscribe();
  });

  it('empty recipient list is a no-op (no bus emit)', async () => {
    const collected: MessagingStreamEvent[] = [];
    const sub = service
      .subscribeForUser('any')
      .pipe(filter((e) => e.data.type !== 'heartbeat'))
      .subscribe((e) => collected.push(e.data));

    service.emitMessageCreated([], makePayload());

    await new Promise((r) => setImmediate(r));
    expect(collected).toHaveLength(0);
    sub.unsubscribe();
  });

  // ─────────────────────────── multi-event ordering ─────────────────

  it('delivers each event type with the correct shape', async () => {
    const stream$ = service.subscribeForUser('u').pipe(
      filter((e) => e.data.type !== 'heartbeat'),
      take(6),
      toArray(),
    );
    const got = firstValueFrom(stream$);

    service.emitMessageCreated(['u'], makePayload('c1', 'm1'));
    service.emitMessageDeleted(['u'], {
      conversationId: 'c1',
      messageId: 'm1',
    });
    service.emitConversationRead(['u'], {
      conversationId: 'c1',
      userId: 'u',
      lastReadAt: '2026-05-12T10:00:00.000Z',
    });
    service.emitConversationMuted(['u'], {
      conversationId: 'c1',
      userId: 'u',
      mutedUntil: null,
    });
    service.emitConversationUnread(['u'], {
      conversationId: 'c1',
      userId: 'u',
      markedUnread: true,
    });
    service.emitConversationCleared(['u'], {
      conversationId: 'c1',
      userId: 'u',
      clearedAt: '2026-10-25T00:00:00.000Z',
    });

    const events = await got;
    expect(events.map((e) => e.data.type)).toEqual([
      'message.created',
      'message.deleted',
      'conversation.read',
      'conversation.muted',
      'conversation.unread',
      'conversation.cleared',
    ]);
  });

  // ─────────────────────────── isolation between subscribers ────────

  it('two subscribers for two users only see their own events', async () => {
    const alice: MessagingStreamEvent[] = [];
    const bob: MessagingStreamEvent[] = [];
    const subA = service
      .subscribeForUser('alice')
      .pipe(filter((e) => e.data.type !== 'heartbeat'))
      .subscribe((e) => alice.push(e.data));
    const subB = service
      .subscribeForUser('bob')
      .pipe(filter((e) => e.data.type !== 'heartbeat'))
      .subscribe((e) => bob.push(e.data));

    service.emitMessageCreated(['alice'], makePayload('c1', 'm1'));
    service.emitMessageCreated(['bob'], makePayload('c2', 'm2'));

    await new Promise((r) => setImmediate(r));
    expect(alice).toHaveLength(1);
    expect(bob).toHaveLength(1);
    expect((alice[0].payload as MessageCreatedPayload).message.id).toBe('m1');
    expect((bob[0].payload as MessageCreatedPayload).message.id).toBe('m2');
    subA.unsubscribe();
    subB.unsubscribe();
  });

  // ─────────────────────────── replay buffer ────────────────────────

  describe('replay buffer', () => {
    it('records emitted events into the per-user buffer', () => {
      service.emitMessageCreated(['alice'], makePayload('c1', 'm1'));
      service.emitMessageCreated(['alice'], makePayload('c1', 'm2'));

      const buf = service.getReplayBufferForTests('alice');
      expect(buf).toHaveLength(2);
      expect(buf.every((e) => /^[0-9a-f-]{36}$/.test(e.id))).toBe(true);
    });

    it('does NOT buffer events for users that were not in the recipient list', () => {
      service.emitMessageCreated(['alice'], makePayload());
      expect(service.getReplayBufferForTests('bob')).toHaveLength(0);
    });

    it('subscribeForUser with a known lastEventId replays the events AFTER it, then live', async () => {
      // Emit two events that go into Alice's buffer.
      service.emitMessageCreated(['alice'], makePayload('c1', 'm1'));
      service.emitMessageCreated(['alice'], makePayload('c1', 'm2'));
      const buf = service.getReplayBufferForTests('alice');
      const firstId = buf[0].id;
      const secondId = buf[1].id;

      // Reconnect with the first event as the last seen.
      const collected: { id: string; type: string }[] = [];
      const sub = service
        .subscribeForUser('alice', firstId)
        .pipe(filter((e) => e.data.type !== 'heartbeat'))
        .subscribe((e) => collected.push({ id: e.id, type: e.data.type }));

      // Live event after reconnect.
      service.emitMessageCreated(['alice'], makePayload('c1', 'm3'));

      await new Promise((r) => setImmediate(r));

      // Should see: replay of m2 (id == secondId), then the live m3
      // (with a fresh id assigned by the live observable).
      expect(collected).toHaveLength(2);
      expect(collected[0].id).toBe(secondId);
      expect(collected[1].id).not.toBe(secondId);
      sub.unsubscribe();
    });

    it('unknown lastEventId yields no replay (FE refetches to fill the gap)', async () => {
      service.emitMessageCreated(['alice'], makePayload('c1', 'm1'));

      const collected: MessagingStreamEvent[] = [];
      const sub = service
        .subscribeForUser('alice', 'unknown-cursor-id')
        .pipe(filter((e) => e.data.type !== 'heartbeat'))
        .subscribe((e) => collected.push(e.data));

      await new Promise((r) => setImmediate(r));
      expect(collected).toHaveLength(0);
      sub.unsubscribe();
    });

    it('caps the per-user buffer (oldest dropped)', () => {
      const N = 105; // > REPLAY_BUFFER_SIZE (100)
      for (let i = 0; i < N; i++) {
        service.emitMessageCreated(['alice'], makePayload('c1', `m${i}`));
      }
      const buf = service.getReplayBufferForTests('alice');
      expect(buf.length).toBe(100);
      // Oldest 5 events were dropped — the most recent 100 remain.
      const ids = new Set(buf.map((e) => e.id));
      expect(ids.size).toBe(100); // no duplicates
    });
  });
});
