# 06 — In-App Notifications and Realtime Delivery

> Research date: **2026-04-25**.
>
> Scope: bell-icon notification feed in the MotionHive UI. Pattern, transport (poll vs SSE vs WebSocket), and SaaS alternatives.

## TL;DR

- The **storage** is just a `notification` table with `user_id`, `read_at`, `created_at`. Always-on REST endpoint to list/mark-read.
- The **realtime layer** is optional but adds polish. Two viable transports for us:
  - **SSE (Server-Sent Events)** — recommended. Simpler, works behind any HTTP proxy, no Socket.IO weight, NestJS has first-class support.
  - **WebSocket / Socket.IO** — pick this if we'll add real bidirectional features later (chat, live coaching).
- For multi-instance fan-out, use **Redis pub/sub** between API instances → each connected client.
- **SaaS realtime providers** (Pusher/Ably/Supabase) only justify cost above ~10k concurrent connections. We're not there.

## The data model (always-on)

Even before realtime, we need durable storage so users see their inbox after a refresh.

```sql
CREATE TABLE notification (
  id           CHAR(36)     PRIMARY KEY,
  user_id      CHAR(36)     NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workflow_key VARCHAR(64)  NOT NULL,           -- e.g. 'invoice.paid'
  title        VARCHAR(255) NOT NULL,
  body         TEXT,
  action_url   TEXT,                             -- where to send user on click
  metadata     JSONB,                            -- workflow-specific data
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at  TIMESTAMPTZ
);

CREATE INDEX idx_notification_user_unread
  ON notification (user_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;

CREATE INDEX idx_notification_user_recent
  ON notification (user_id, created_at DESC);
```

### Endpoints

```
GET    /notifications?cursor=...&limit=20    → paginated feed
GET    /notifications/unread-count           → badge number
PATCH  /notifications/:id/read               → mark single
POST   /notifications/mark-all-read          → bulk
DELETE /notifications/:id                    → archive
```

### Performance notes
- The partial index on `(user_id, created_at) WHERE read_at IS NULL` makes unread-count queries cheap.
- For users with thousands of notifications, archive/delete > 90 days via a maintenance job.
- Don't return `metadata` in the list endpoint by default — it can be heavy. Fetch on detail endpoint or expand-on-click.

## Transport options

You have three options for "make the bell update without a page refresh":

### Option A: Polling (the boring, often correct choice)

```js
setInterval(() => fetch('/notifications/unread-count'), 30000);
```

- **Pros**: zero new infra, works behind every proxy, debug with curl.
- **Cons**: not "real" realtime; 30s lag; wasted requests when nothing changes.
- **When right**: < 1k concurrent users, latency requirements > 30s, want to ship in a day.

For MotionHive at MVP: **polling is fine**. Set 30s interval on the unread-count endpoint, refresh the feed on user-visible action (clicking the bell). Deploy realtime later when we have user feedback that it matters.

### Option B: Server-Sent Events (SSE)

A long-lived HTTP/1.1 or HTTP/2 connection from client to server. Server writes events as they happen. Browser auto-reconnects on drop.

- **Pros**: standard HTTP, works behind any proxy, native `EventSource` browser API, easy to debug, NestJS has first-class support.
- **Cons**: unidirectional (server → client only); per-connection memory if server doesn't pool well; some HTTP/1.1 connection-limit-per-host gotchas.
- **When right**: notifications, live counters, status streams — anything one-way and not high-volume per-connection.

#### NestJS SSE support

NestJS has a built-in `@Sse` decorator. ([NestJS SSE docs](https://docs.nestjs.com/techniques/server-sent-events))

```ts
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly stream: NotificationStreamService) {}

  @Sse('stream')
  @UseGuards(AuthGuard('jwt'))
  stream(@CurrentUser() user: User): Observable<MessageEvent> {
    return this.stream.forUser(user.id);
  }
}
```

The `NotificationStreamService` returns an RxJS Observable. Subscribe via Redis pub/sub for cross-instance fan-out.

#### Multi-instance pattern (essential)

```
[ API instance 1 ]──┐
[ API instance 2 ]──┼─→ Redis pub/sub channel: user:${userId}:notifications
[ API instance 3 ]──┘
       ↑
       │ each instance subscribes for connected users
       │ relays messages to local SSE streams
```

When the BullMQ `in_app_create` job fires:
1. Insert row into `notification` table.
2. `redis.publish('user:abc123:notifications', JSON.stringify(payload))`.
3. Whichever API instance has user `abc123`'s SSE connection picks up the publish and writes to the stream.

Works whether the user is on instance 1 or 7 — Redis pub/sub broadcasts to all subscribers.

#### Cost
- Redis pub/sub: included in our existing Redis bill. **$0 marginal.**
- Memory per connection: ~50–200KB (NestJS / Express overhead) → 1k concurrent = 50–200MB RAM.
- Bandwidth: a few KB per notification.

### Option C: WebSocket (Socket.IO or platform-ws)

Full-duplex bidirectional connection. Socket.IO adds rooms, ack/retry, fallback transports.

- **Pros**: bidirectional (good for chat, live coaching, presence). Rooms make targeted broadcasts trivial.
- **Cons**: heavier than SSE; some load balancers need sticky sessions; Socket.IO upgrades from polling to WebSocket can be flaky.
- **When right**: anything bidirectional. Chat, multiplayer, collaborative editing, real-time coaching feedback.

#### NestJS Socket.IO

```ts
@WebSocketGateway({ namespace: 'notifications', cors: true })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  async handleConnection(client: Socket) {
    const userId = await this.auth.verify(client.handshake.auth.token);
    if (!userId) return client.disconnect();
    client.join(`user:${userId}`);
  }

  // Called from notification service after enqueue
  notify(userId: string, payload: object) {
    this.server.to(`user:${userId}`).emit('notification', payload);
  }
}
```

Multi-instance: use the **socket.io-redis-adapter** so all instances share rooms via Redis pub/sub.

#### Cost
- Same Redis as SSE.
- Memory ~150–400KB per connection.
- Slightly more CPU per message vs SSE.

### Comparison: SSE vs WebSocket for our use case

| Concern | SSE | WebSocket (Socket.IO) |
|---|---|---|
| Direction | server → client | bidirectional |
| Browser support | Universal (since IE10... no, since Edge) | Universal |
| Auto-reconnect | Yes, native | Yes, via Socket.IO |
| Native NestJS support | `@Sse()` decorator | `@WebSocketGateway()` |
| Behind proxies | Just HTTP | Needs proxy that allows upgrade |
| HTTP/2 multiplexing | Yes | Less benefit |
| Memory per conn | Lower | Higher |
| Right for: notifications | ✅ | Overkill |
| Right for: chat, live | ❌ | ✅ |
| Right for: presence | ❌ | ✅ |

**For MotionHive notifications: SSE.** If we later add chat or live coaching, add Socket.IO **alongside** SSE. They're not exclusive.

## SaaS realtime providers (when DIY is overkill)

Only worth considering at scale (10k+ concurrent connections) or when ops burden of running our own gateway is too high.

### Pusher Channels

**Site**: <https://pusher.com> · **Pricing**: <https://pusher.com/channels/pricing>

- **Free (Sandbox)**: 200k messages/day, 100 max concurrent connections.
- **Startup**: $49/mo, 1M msgs/day, 500 connections.
- **Pro**: $99/mo, 4M msgs/day, 2000 connections.

**Pros**: simplest API, broadest SDK coverage, instant setup.
**Cons**: cost climbs fast as connections grow; lock-in.

### Ably

**Site**: <https://ably.com> · **Pricing**: <https://ably.com/pricing>

- **Free**: 6M msgs/mo (monthly, not daily — generous), 200 peak connections.
- **Pay-as-you-go**: $25/mo includes more, then per-message.

**Pros**: enterprise-grade reliability (delivery guarantees, fallback transports, multi-region).
**Cons**: more expensive than Pusher above free; oriented at enterprise.

### Supabase Realtime

**Site**: <https://supabase.com/docs/guides/realtime/pricing>

- **Free** with any Supabase project.
- Charges per peak connection + messages above included quota.

**Pros**: $0 if you're already on Supabase. Tied to Postgres replication.
**Cons**: only useful if you're using Supabase as your DB. We're on Neon.

### Self-hosted Socket.IO

Already covered above. **$0 marginal cost** at our scale.

### Recommendation
- **MVP**: SSE on our own NestJS, Redis pub/sub for fan-out. **$0 marginal.**
- **If we hit 5k+ concurrent connections**: revisit. By then we'll know if Pusher's $99/mo is justified.
- **Never** SaaS for "just notifications" — use SSE.

## Concrete recommendation for MotionHive

### Phase 1: ship-it-tomorrow (MVP)

- Notification table + REST endpoints (list, unread-count, mark-read).
- Frontend polls `/notifications/unread-count` every 30s.
- Frontend fetches feed when bell is opened.
- **Effort**: 2–3 days backend + 2 days frontend.

### Phase 2: realtime (when polling feels laggy)

- Add SSE endpoint `GET /notifications/stream`.
- BullMQ `in_app_create` job publishes to Redis pub/sub after row insert.
- NestJS SSE controller subscribes to per-user channel.
- Frontend `EventSource` subscribes; falls back to polling if SSE disconnects.
- **Effort**: 1 week backend + 2 days frontend.

### Phase 3: bidirectional features (only if needed)

- Add Socket.IO gateway for chat / live coaching.
- Keep SSE for notifications (cleaner separation).
- **Effort**: 2+ weeks per bidirectional feature.

## Implementation gotchas

### Authentication on long-lived connections

JWTs typically expire in 15–60 min. SSE/WebSocket connections live longer.

- **SSE**: re-authenticate the connection by closing and reconnecting on token refresh. Frontend manages this.
- **WebSocket**: Socket.IO has middleware for re-auth; periodically verify token expiry and disconnect when stale.

For us: use the JWT in the SSE URL (`?token=...`) or as a header (`Authorization: Bearer ...`). NestJS guards work on `@Sse` routes.

### Heroku/Railway timeouts

Most platforms terminate idle HTTP connections after 30–60s. Solution:

- **SSE**: send a comment ping every 15s (`: ping\n\n`). EventSource ignores comments but the proxy sees activity.
- **WebSocket**: Socket.IO sends pings automatically.

### Sticky sessions

- **SSE**: not strictly required if you have Redis pub/sub fan-out (any instance can serve). Helpful for cache locality.
- **WebSocket**: required if not using socket.io-redis-adapter; Socket.IO upgrades from polling on the same instance.

Railway's load balancer doesn't do sticky sessions by default. **Use Redis pub/sub fan-out** instead — each connection works on whichever instance got it.

### iOS / mobile background tabs

iOS Safari aggressively suspends background tabs. SSE/WebSocket connections die after ~30s in background. App must handle reconnect on `visibilitychange`.

### Fan-out storms

If a "system maintenance" notification goes to 10k users at once:
- 10k inserts in `notification` table → consider COPY or batched insert.
- 10k Redis publishes → fine, Redis handles millions/sec.
- 10k SSE writes → spreads across connected instances.

Don't worry about this until we have 10k users.

## RxJS pattern for the SSE service

```ts
@Injectable()
export class NotificationStreamService implements OnModuleDestroy {
  private subjects = new Map<string, Subject<NotificationEvent>>();

  constructor(@Inject('REDIS_SUB') private redisSub: Redis) {
    this.redisSub.on('message', (channel, message) => {
      const userId = channel.replace('user:', '').replace(':notifications', '');
      this.subjects.get(userId)?.next(JSON.parse(message));
    });
  }

  forUser(userId: string): Observable<MessageEvent> {
    let subject = this.subjects.get(userId);
    if (!subject) {
      subject = new Subject();
      this.subjects.set(userId, subject);
      this.redisSub.subscribe(`user:${userId}:notifications`);
    }
    return subject.pipe(
      map((data) => ({ data: JSON.stringify(data) } as MessageEvent)),
      finalize(() => {
        // Cleanup when last subscriber disconnects (use refCount in real impl)
      }),
    );
  }
}
```

Use a separate ioredis connection for subscribe (Redis client in subscriber mode can't run other commands).

## Recommendation summary

1. **Build the storage + REST endpoints now.** Required no matter what transport we add.
2. **Use polling on the frontend at MVP.** 30s interval, no realtime infra.
3. **Add SSE when polling latency becomes a UX complaint.** Half a week of work.
4. **Consider Socket.IO only when we add bidirectional features** (chat, live coaching).
5. **Never** pay for Pusher/Ably/Supabase realtime for just notifications.

## Sources

- [NestJS Server-Sent Events docs](https://docs.nestjs.com/techniques/server-sent-events)
- [NestJS Gateways (WebSocket) docs](https://docs.nestjs.com/websockets/gateways)
- [Real-Time Notifications in NestJS — Anshu Sharma](https://medium.com/@anshusharma98204/real-time-notifications-in-nestjs-a-simpler-alternative-to-websockets-with-server-sent-events-d3c94f5efc91)
- [Trendyol SSE realtime experience](https://medium.com/trendyol-tech/how-we-used-server-sent-events-sse-to-deliver-real-time-notifications-on-our-backend-ebae41d3b5cb)
- [WebSockets vs SSE — Ably](https://ably.com/blog/websockets-vs-sse)
- [SSE vs WebSocket — OneUptime](https://oneuptime.com/blog/post/2026-01-27-sse-vs-websockets/view)
- [Pusher Channels pricing](https://pusher.com/channels/pricing)
- [Ably pricing](https://ably.com/pricing)
- [Supabase Realtime pricing](https://supabase.com/docs/guides/realtime/pricing)
- [Pusher vs Supabase comparison — Ably](https://ably.com/compare/pusher-vs-supabase)
- [Ably vs Pusher comparison](https://ably.com/compare/ably-vs-pusher)
- [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/)
