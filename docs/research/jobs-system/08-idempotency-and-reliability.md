# 08 — Idempotency, Reliability, and the Outbox Pattern

> Research date: **2026-04-25**.
>
> Scope: making sure jobs don't run twice (or run zero times). Critical for our Stripe webhook → email/notification flow.

## TL;DR

- **At-least-once is the realistic ceiling.** Build every job to be safe to run twice.
- **Custom job IDs** = idempotency keys. Use `<workflow>:<entity>:<discriminator>` pattern.
- BullMQ's **deduplication** (Simple/Throttle/Debounce modes) handles enqueue-side dedup. We still need consumer-side idempotency.
- For "do A in DB, then enqueue B" flows: use the **transactional outbox pattern** so we never have orphaned DB state or orphaned jobs.
- Stripe webhooks already have `event.id` — that's our idempotency key for free.
- **Poison messages** (jobs that always fail): cap retries at 5–10, then DLQ + alert.

## The fundamental problem

In a distributed system, three things can happen between "publish job" and "job completes":

1. **Publisher commits to DB but crashes before enqueue** → DB state without job. Lost work.
2. **Publisher enqueues but DB transaction rolls back** → Job without DB state. Inconsistent.
3. **Worker processes successfully but crashes before ack** → Same job runs again. Duplicate side-effect.

Cases 1 and 2 are solved by the **outbox pattern**. Case 3 is solved by **idempotent consumers**.

## At-least-once vs exactly-once

**Exactly-once delivery is a myth in distributed systems.** Every queue (Kafka, RabbitMQ, BullMQ, SQS) ultimately gives at-least-once. "Exactly-once processing" is achievable only with idempotent consumers.

Quote from [Decodable's outbox revisit](https://www.decodable.co/blog/revisiting-the-outbox-pattern):

> The transactional outbox pattern guarantees at-least-once delivery — not exactly-once. Consumers might receive duplicate events due to transient failures.

**Implication**: every BullMQ processor must assume the job might run multiple times, and use idempotency to make duplicate runs no-ops.

## Idempotency: making consumers safe

### Pattern 1: deterministic idempotency key in the side-effect

For external API calls that support idempotency keys (Stripe, Resend partial support, Twilio):

```ts
// In an email_send handler
await stripe.charges.create({ amount, currency }, {
  idempotencyKey: `charge:${invoiceId}:${attemptId}`,
});
```

We already do this for Stripe via `StripeService.buildIdempotencyKey()`. Extend the convention to other channels where supported.

### Pattern 2: dedup table

For operations without provider-side idempotency:

```sql
CREATE TABLE side_effect_dedup (
  key       VARCHAR(128) PRIMARY KEY,
  job_id    VARCHAR(64),
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
```

Handler:
```ts
const dedupKey = `notif:in_app:${userId}:${workflowKey}:${triggerId}`;
const inserted = await sideEffectDedupRepo.insertIgnoreConflict({ key: dedupKey, job_id: job.id });
if (!inserted) {
  this.logger.info('Skipping duplicate side-effect', { key: dedupKey });
  return;
}
// proceed with side effect
```

Use `INSERT ... ON CONFLICT DO NOTHING` in Postgres. The unique constraint is the dedup mechanism.

Trade-off: this table grows. Either:
- Truncate rows older than 30 days via maintenance job.
- Use a partial / TTL approach (Postgres doesn't have native TTL — pg_cron + DELETE works).

### Pattern 3: check-before-write on the entity itself

If the side effect is a DB write, check the entity:

```ts
// Job: send_invoice — only sends if not already sent
const invoice = await invoiceRepo.findByPk(invoiceId);
if (invoice.sentAt) {
  this.logger.info('Invoice already sent, skipping', { invoiceId });
  return;
}
await stripe.invoices.sendInvoice(invoice.stripeId);
await invoiceRepo.update({ sentAt: new Date() }, { where: { id: invoiceId } });
```

Cleanest pattern when the side effect maps 1:1 to a DB state change.

## Custom job IDs as idempotency keys

BullMQ lets you specify a `jobId`. ([BullMQ Job IDs](https://docs.bullmq.io/guide/jobs/job-ids))

```ts
queue.add('invoice_send', { invoiceId: 'inv_123' }, {
  jobId: `invoice_send:inv_123`,
});
```

If another caller tries to add a job with the same `jobId` while it's still in the queue, BullMQ rejects the duplicate. **This is enqueue-side dedup, not consumer-side.**

Important: `jobId` only deduplicates while the job is **active or waiting**. Once completed, the same `jobId` can be re-added. Use BullMQ's deduplication API for time-windowed dedup.

### Naming pattern

`<workflow>:<entity>:<discriminator>`

Examples:
- `invoice_send:inv_abc:initial` — first send of invoice
- `invoice_send:inv_abc:reminder1` — first dunning reminder
- `password_reset_email:user_xyz:1714000000` — reset email with timestamp (allows multiple)
- `session_reminder:sess_def:24h_before` — 24h-before reminder, exactly once

The discriminator changes for each "logical" send. The whole string is the idempotency key.

## BullMQ deduplication API

BullMQ has a separate `deduplication` option distinct from `jobId`. ([BullMQ Deduplication](https://docs.bullmq.io/guide/jobs/deduplication))

### Three modes

#### Simple Mode
```ts
queue.add('sync_user', { userId }, {
  deduplication: { id: `sync_user:${userId}` },
});
```
Skips duplicate IDs while the original is still in queue (waiting/active). Good for "don't enqueue another sync if one is pending."

#### Throttle Mode (TTL)
```ts
queue.add('refresh_cache', { key }, {
  deduplication: { id: `refresh_cache:${key}`, ttl: 60_000 },
});
```
Skips duplicates for `ttl` ms after the first one. Good for "rate-limit recompute to once per minute".

#### Debounce Mode
```ts
queue.add('search_index_user', { userId }, {
  deduplication: { id: `search_index_user:${userId}`, ttl: 5000, extend: true, replace: true },
});
```
Each new add replaces the pending one and resets TTL. Good for "wait 5s after the last edit, then index."

### When to use what

| Scenario | Mode |
|---|---|
| One in-flight at a time | Simple |
| Rate limit (one per N seconds) | Throttle |
| Wait for typing/edits to settle | Debounce |
| Idempotent business event (one-and-done) | Custom `jobId` (Simple is fine too) |

For MotionHive's notification system: mostly **custom `jobId`** with the `<workflow>:<entity>:<discriminator>` pattern. The dedup modes are useful for things like "user changed avatar 5 times in 10s, only run image processing once."

## The transactional outbox pattern

This is the load-bearing pattern for the **Stripe webhook → notification** flow.

### The problem

```ts
// WRONG — double-write across DB and queue
async function onPaymentSucceeded(event) {
  await db.transaction(async (tx) => {
    await invoiceRepo.update({ status: 'paid' }, { where: { id }, transaction: tx });
  });
  await queue.add('email_send', { invoiceId: id });  // ← if this fails, no email
}
```

If the queue.add fails (Redis blip), the DB is updated but the email never fires. Inconsistent.

```ts
// ALSO WRONG — wrong order
async function onPaymentSucceeded(event) {
  await queue.add('email_send', { invoiceId: id });  // ← email fires before invoice marked paid
  await invoiceRepo.update({ status: 'paid' }, ...);
}
```

If the DB update fails, an email goes out for a paid invoice that was never marked paid. Also inconsistent.

### The outbox solution

Write the "intent to enqueue" to a DB table **in the same transaction** as the domain change. A separate process (the "relay") drains the table and pushes to the queue.

```sql
CREATE TABLE outbox_event (
  id            CHAR(36)     PRIMARY KEY,
  aggregate     VARCHAR(64)  NOT NULL,         -- 'invoice', 'session', etc.
  aggregate_id  CHAR(36)     NOT NULL,
  event_type    VARCHAR(64)  NOT NULL,         -- 'invoice.paid'
  payload       JSONB        NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ,
  attempts      INT          NOT NULL DEFAULT 0
);

CREATE INDEX idx_outbox_pending ON outbox_event (created_at) WHERE published_at IS NULL;
```

```ts
// In webhook handler
await db.transaction(async (tx) => {
  await invoiceRepo.update({ status: 'paid' }, { where: { id }, transaction: tx });
  await outboxRepo.create({
    aggregate: 'invoice', aggregate_id: id,
    event_type: 'invoice.paid',
    payload: { invoiceId: id, amount: event.amount },
  }, { transaction: tx });
});

// In a separate "relay" job (BullMQ repeatable, every 1s)
async function relayOutbox() {
  const events = await db.query(`
    SELECT * FROM outbox_event
    WHERE published_at IS NULL AND attempts < 10
    ORDER BY created_at ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  `);
  for (const event of events) {
    try {
      await notificationService.notify({
        workflowKey: event.event_type,
        userId: event.payload.userId,
        data: event.payload,
      });
      await outboxRepo.update({ published_at: new Date() }, { where: { id: event.id } });
    } catch (err) {
      await outboxRepo.update(
        { attempts: event.attempts + 1 },
        { where: { id: event.id } }
      );
    }
  }
}
```

### Why this works
- DB transaction is atomic: either invoice is paid AND outbox row exists, or neither.
- Relay is at-least-once: it might publish twice if it crashes between publish and `published_at` update. **Consumer must be idempotent.**
- `FOR UPDATE SKIP LOCKED` lets multiple relay workers run in parallel safely.

### Cost
- One extra table.
- One extra repeatable job (1s polling).
- Extra DB load: negligible at our scale (LIMIT 100 query every 1s on an indexed table).

### Trade-off
- Slight latency: 0–1s between transaction commit and notification fire (vs ~immediate without outbox).
- For session reminders and most notifications: who cares.
- For 2FA codes: don't use outbox; send directly with retry-on-failure.

### Alternative: Postgres LISTEN/NOTIFY

Instead of polling, use Postgres pub/sub:

```sql
CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_notify_trigger
  AFTER INSERT ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION notify_outbox();
```

Relay process subscribes via `LISTEN outbox`. Sub-millisecond latency.

For us: **start with polling at 1s interval**. LISTEN/NOTIFY is an optimization for when latency matters.

### Outbox + Stripe webhook integration

Our existing webhook handler already commits everything in one transaction (see CLAUDE.md "transactions" rule). To add outbox:

```ts
// In webhook handler service
async handleStripeEvent(event, tx) {
  // existing logic: update invoice, payment, etc.
  await invoice.update(..., { transaction: tx });

  // NEW: also write outbox
  await outbox.create({
    aggregate: 'invoice', aggregate_id: invoice.id,
    event_type: 'invoice.paid',
    payload: { ... },
  }, { transaction: tx });
}
```

**That's it.** The webhook idempotency table (`webhook_event` with UNIQUE on `stripe_event_id`) prevents the webhook handler itself from running twice. The outbox prevents lost notifications. The consumer being idempotent prevents duplicate sends.

## Stripe webhooks: extra notes

Stripe gives us idempotency for free:
- `event.id` is unique per webhook.
- Use it as the outbox `aggregate_id` or as part of the consumer dedup key.

Pattern:
```ts
// Use event.id as the job's idempotency key
await queue.add('process_stripe_event', { eventId: event.id }, {
  jobId: `process_stripe:${event.id}`,
});
```

Combined with the existing `webhook_event` table's UNIQUE on `stripe_event_id`, this is robust.

## Retry strategies

### Default for most jobs

```ts
defaultJobOptions: {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
}
```

Delay sequence: 2s, 4s, 8s, 16s, 32s. Total ~1 minute of retries.

### For external APIs that rate-limit

```ts
attempts: 8,
backoff: { type: 'exponential', delay: 5000 },  // up to ~10 min
```

### For email send

Resend can have transient 5xx. Aggressive retry:
```ts
attempts: 6,
backoff: { type: 'exponential', delay: 10_000 },  // up to ~10 min, then DLQ
```

### For Stripe API

Stripe responds quickly; transient errors are rare. Conservative retry:
```ts
attempts: 4,
backoff: { type: 'exponential', delay: 5_000 },
```

### Custom backoff for special cases

```ts
// Honor Retry-After header from a 429 response
const customBackoff = async (attemptsMade, err) => {
  if (err.status === 429 && err.retryAfter) {
    return err.retryAfter * 1000;
  }
  return Math.min(60000, 1000 * Math.pow(2, attemptsMade));
};

new Worker('payments', processor, {
  settings: { backoffStrategy: customBackoff },
});
```

### Jitter

To avoid retry stampedes (10k jobs all retrying at the same instant), add jitter:

```ts
backoff: { type: 'exponential', delay: 2000, jitter: 0.5 }
```

50% jitter: actual delay is between 50–100% of computed value.

## Poison messages

A "poison message" is a job that **always fails** no matter how many times you retry — a logic bug, malformed data, dependency permanently broken.

### Detection
- Same `jobId` failing > 5 times in a row → likely poison.
- DLQ catches them after `attempts` exhausted.

### Handling
- DLQ + Slack alert (file 07).
- Don't auto-replay DLQ; require manual triage.
- Fix the bug, then re-enqueue from DLQ to original queue.

### Prevention
- Validate job payloads at enqueue time (use class-validator or zod).
- For payloads from external sources (webhooks), validate before enqueueing.

## Data validation at enqueue

```ts
const schema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
});

@Injectable()
export class PaymentsQueue {
  async enqueueRefund(data: unknown) {
    const validated = schema.parse(data);  // throws on bad input
    return this.queue.add('refund', validated);
  }
}
```

Catching schema errors at enqueue is way easier than debugging a poison message in DLQ.

## Reliability checklist

For every job we write:

- [ ] **Idempotency key**: custom `jobId` follows `<workflow>:<entity>:<discriminator>` pattern
- [ ] **Consumer is idempotent**: re-running with the same data is safe
- [ ] **Validates payload**: rejects malformed input at enqueue
- [ ] **Uses retry with backoff**: appropriate to the failure mode
- [ ] **Has DLQ on retry exhaustion**: caught by per-queue DLQ
- [ ] **Logs include**: queue, job_name, job_id, attempt, request_id
- [ ] **External API calls use provider idempotency keys** where supported (Stripe, etc.)
- [ ] **For DB-coupled enqueue: uses outbox** (or accepts the eventual-loss risk if the data is non-critical)

## Recommendation summary

1. **Always set custom `jobId`** matching `<workflow>:<entity>:<discriminator>`. Free idempotency for in-flight dedup.
2. **Use the outbox pattern for Stripe webhook → notification** flows. ~50 lines of code, eliminates a whole class of inconsistency bugs.
3. **Reach for BullMQ deduplication modes** when the natural pattern is "throttle/debounce" (e.g. "reindex user" after a flurry of edits).
4. **Make consumers idempotent** even when you think the producer guarantees uniqueness. Networks lie.
5. **DLQ + alert** > silently retrying forever.
6. **Retry with jitter** for any external API call.

## Sources

- [BullMQ Job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- [BullMQ Deduplication](https://docs.bullmq.io/guide/jobs/deduplication)
- [BullMQ Retrying failing jobs](https://docs.bullmq.io/guide/retrying-failing-jobs)
- [BullMQ Custom backoff strategy](https://docs.bullmq.io/bull/patterns/custom-backoff-strategy)
- [BullMQ Stop retrying jobs](https://docs.bullmq.io/patterns/stop-retrying-jobs)
- [Transactional outbox pattern — gmhafiz](https://www.gmhafiz.com/blog/transactional-outbox-pattern/)
- [Push-based outbox with Postgres logical replication](https://event-driven.io/en/push_based_outbox_pattern_with_postgres_logical_replication/)
- [Revisiting the Outbox Pattern — Decodable](https://www.decodable.co/blog/revisiting-the-outbox-pattern)
- [Implementing the Outbox Pattern — Milan Jovanović](https://www.milanjovanovic.tech/blog/implementing-the-outbox-pattern)
- [Outbox + Logical Decoding — Node.js example](https://medium.com/@hadiyolworld007/node-js-transactional-outbox-logical-decoding-exactly-once-events-from-postgres-74d0fa517076)
- [pg-transactional-outbox library](https://www.npmjs.com/package/pg-transactional-outbox)
- [Stripe Webhooks Implementation Guide 2026](https://www.hooklistener.com/learn/stripe-webhooks-implementation)
- [Building a Robust Webhook Handler in Node.js](https://dev.to/dumebii/building-a-robust-webhook-handler-in-nodejs-validation-queuing-and-retry-logic-2fb6)
- [Stripe Webhooks with Background Jobs — freeCodeCamp](https://www.freecodecamp.org/news/stripe-webhooks-background-jobs)
