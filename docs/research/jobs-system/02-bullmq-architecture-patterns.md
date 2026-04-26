# 02 — BullMQ Architecture Patterns for NestJS

> Research date: **2026-04-25**.
>
> Scope: how to structure BullMQ inside MotionHive's NestJS codebase so we don't have to refactor when we move from "in-process workers on the API" to "dedicated worker dynos."

## TL;DR

- **One queue per domain**, not per job type. (`notifications`, `payments`, `media`, `recurring-sessions`, etc.)
- Inside a queue, use **named jobs** to discriminate between handlers.
- Workers extend `WorkerHost` and dispatch by `job.name` in `process()`.
- Start with **same-process workers**, gated by `WORKER_ENABLED=true` env var so we can flip to a **dedicated worker dyno** without code changes.
- Use **sandboxed processors** only for CPU-bound jobs (PDF, image transcode). Default to in-process.
- **`FlowProducer`** for multi-step workflows like "finalize invoice → send email + send SMS + update analytics".
- Always implement **graceful shutdown** with SIGTERM handlers; Railway sends SIGTERM with a grace window.
- One **shared ioredis connection** for the whole app (with `maxRetriesPerRequest: null` — required by BullMQ).

## 1. Queue topology: per-domain vs per-job-type

The official docs and most field guides converge on **per-domain queues**. ([NashTech BullMQ guide](https://blog.nashtechglobal.com/mastering-bullmq-in-nestjs-a-step-by-step-introduction-part-1/), [Stackademic build-up](https://medium.com/@karthiks05/how-we-built-a-robust-message-queue-using-bullmq-part-1-2d5ad1016958))

### Why per-domain
- **Operational isolation**: a stuck `media` queue (e.g. Cloudinary down) doesn't block `notifications`.
- **Per-queue rate limits**: we can throttle Stripe API calls without throttling email.
- **Per-queue concurrency**: image transcode runs at concurrency 2 (CPU-bound), email at 50 (I/O-bound).
- **Per-queue Redis prefix** if we ever want multi-tenancy.

### Why not per-job-type
- Cardinality explodes — one queue per job type means dozens of queues for a mid-size app, each with its own connection.
- Bull Board becomes noisy.
- Redis memory overhead per queue (small but non-zero).

### Proposed queue layout for MotionHive

```
notifications      → email_send, push_send, sms_send, in_app_create
payments           → stripe_reconcile, invoice_send, refund_process, dunning
sessions           → reminder_send, status_transition, recurring_generate
media              → cloudinary_upload, image_transcode, pdf_generate
analytics          → daily_summary, weekly_report
auth               → password_reset_email, verification_email
maintenance        → cleanup_expired, gdpr_export
```

7 queues. Each has 2–8 named jobs. This is sustainable in Bull Board and lets us scale workers independently.

## 2. Processor pattern (NestJS-idiomatic)

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('notifications', { concurrency: 50 })
export class NotificationsProcessor extends WorkerHost {
  async process(job: Job<NotificationJobData>): Promise<void> {
    switch (job.name) {
      case 'email_send':   return this.handleEmail(job);
      case 'push_send':    return this.handlePush(job);
      case 'sms_send':     return this.handleSms(job);
      case 'in_app_create': return this.handleInApp(job);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }
}
```

### Pattern notes
- **`WorkerHost` is mandatory** in BullMQ; the legacy `@Process('jobname')` decorator doesn't exist.
- **Concurrency** is a worker option, not a queue option (different from Bull v3).
- **One processor class per queue** keeps the dispatching obvious. Don't try to use multiple `@Processor` decorators for the same queue.
- For very large queues, you can split handler logic into separate services injected into the processor — keep the processor a thin dispatcher.

## 3. Same-process vs separate worker process

This is the most important architectural decision. The good news: **BullMQ lets you flip this with no code change** — the Worker is just a class that connects to Redis.

([BullMQ scaling docs](https://docs.bullmq.io/guide/parallelism-and-concurrency), [DragonflyDB scaling guide](https://www.dragonflydb.io/faq/bullmq-scaling-effective-ways), [Background Job Processing in Node.js](https://dev.to/young_gao/background-job-processing-in-nodejs-bullmq-queues-and-worker-patterns-31d4))

### Phase 1: same process (where we start)

```
[ NestJS app process ]
   ├── HTTP API
   └── BullMQ Workers (consume from Redis)
```

- Pros: one dyno, one cost, simple deploys.
- Cons: a runaway worker (memory leak, infinite retry loop) takes the API down with it.
- Right for: <100k jobs/day, no CPU-heavy work.

### Phase 2: dedicated worker process (same image)

```
[ API dyno ] ← HTTP only, WORKER_ENABLED=false
[ Worker dyno ] ← consumes from Redis, WORKER_ENABLED=true
```

- Same Docker image, different env var.
- Conditionally register processors:

```ts
@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
  ],
  providers: process.env.WORKER_ENABLED === 'true'
    ? [NotificationsProcessor]
    : [],
})
export class NotificationModule {}
```

- Cost: one extra Railway dyno (~$5/mo on Hobby).
- Right for: production traffic, anything > 50k jobs/day.

### Phase 3: per-queue worker dynos

```
[ API dyno ]
[ Notifications worker dyno ] ← consumes notifications queue
[ Media worker dyno ]         ← consumes media queue (CPU-heavy, sandboxed)
[ Payments worker dyno ]      ← consumes payments queue
```

- Use `WORKER_QUEUES=notifications,auth` env var to filter which processors register on each dyno.
- Right for: scale where one queue's load justifies isolating it.

### Recommendation
- **Build for Phase 2 from day one** — it's literally one env var of difference. Ship Phase 1 in production, but write the code so Phase 2 is a Railway service add, not a refactor.

## 4. Sandboxed processors (CPU-heavy work)

BullMQ supports running a worker in a **separate Node process** via `processFile`:

```ts
const worker = new Worker('media', path.join(__dirname, 'transcode.processor.js'));
```

The processor file is `import`ed in a child Node process — completely isolated from the main event loop.

([BullMQ sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors), [Timeout pattern](https://docs.bullmq.io/patterns/timeout-for-sandboxed-processors))

### When to use
- **PDF generation** (puppeteer is heavy).
- **Image transcoding** (sharp/ffmpeg).
- **AI/ML inference** in-process.
- **Anything that can leak memory** (isolation makes leaks recoverable).

### When NOT to use
- I/O-bound work (HTTP calls, DB queries, sending emails). The overhead of process spawning isn't justified.
- Anything that needs the NestJS DI container — sandboxed processors are plain Node files. You can't easily inject services into them.

### NestJS-specific gotcha
NestJS DI doesn't cross the process boundary. For sandboxed processors, you'd typically:
- Pass all needed config in the job payload, or
- Have the sandboxed processor bootstrap a minimal app context, or
- Keep CPU work in plain functions you can call from a sandbox file.

For MotionHive, **no sandboxed processors yet** — all current/imminent jobs are I/O-bound (email, push, Stripe API). Reach for sandbox only when we add PDF receipts or image processing.

## 5. FlowProducer (parent + child jobs)

`FlowProducer` lets us model:

```
Parent: invoice_send_v2
   ├── Child: stripe_finalize
   ├── Child: email_invoice (depends on stripe_finalize)
   ├── Child: in_app_notification
   └── Child: analytics_event
```

The parent waits for all children. Failure semantics: if a child fails after retries, parent is failed. Useful for ensuring **all-or-nothing notification batches**.

For MotionHive, this is **overkill for v1**. Our current Stripe webhook flow can use simple per-event jobs. Revisit FlowProducer when we have a flow with >3 dependent steps that all need observability as one unit.

## 6. Connection management

**Always use one ioredis connection per process** (or a small pool), shared across all queues and workers.

```ts
import { BullModule } from '@nestjs/bullmq';

BullModule.forRoot({
  connection: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,  // ← REQUIRED by BullMQ
    enableReadyCheck: false,     // ← recommended
  },
});
```

### Critical settings

| Setting | Value | Why |
|---|---|---|
| `maxRetriesPerRequest` | `null` | BullMQ blocks on `BRPOPLPUSH`; the default of 20 retries causes spurious errors |
| `enableReadyCheck` | `false` | Avoids extra `INFO` calls on every reconnect |
| `connectTimeout` | 10000 | Default is 10s, fine for Railway |

### Why one connection
- BullMQ creates additional connections internally (one per Worker for blocking reads, one per QueueEvents). If your `BullModule.forRoot` connection is shared, the count stays sane (~3–5 per process).
- ioredis pools are not what we want — BullMQ wants exclusive connections for blocking commands.

## 7. Graceful shutdown

Railway (and most platforms) sends SIGTERM, then SIGKILL after a timeout (default 30s on Railway). Workers in flight when SIGKILL hits become **stalled jobs** — they re-run after `lockDuration` expires (default 30s), risking duplicate side effects.

([BullMQ graceful shutdown docs](https://docs.bullmq.io/guide/workers/graceful-shutdown), [Stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs))

### Pattern (NestJS lifecycle hook)

```ts
@Injectable()
export class WorkerShutdown implements OnApplicationShutdown {
  constructor(@InjectQueue('notifications') private notif: Queue) {}

  async onApplicationShutdown(signal?: string) {
    // BullModule auto-closes registered workers on shutdown,
    // but explicit close gives you control over timeouts
    await this.notif.close();
  }
}
```

NestJS's `app.enableShutdownHooks()` (we already call this in `main.ts`) will trigger the lifecycle methods. BullMQ's `worker.close()` waits for in-flight jobs to finish, so set NestJS shutdown timeout > worker max job duration.

### Recommendations
- Set `app.enableShutdownHooks()` (we have this).
- Cap individual job duration at < 25s (Railway's grace window minus buffer).
- If a job is genuinely long (PDF render), use **sandboxed processors** so the child process can be killed without losing the parent's bookkeeping.

## 8. Naming conventions

### Queues
- `kebab-case`, singular noun for grouped concept: `notifications`, `payments`, `media`.
- Match the directory: `src/jobs/notifications/`.

### Job names
- `snake_case` verb_object: `email_send`, `invoice_finalize`, `push_subscribe`.
- Keep them short — they're stored in Redis on every job.

### Job IDs (idempotency keys)
- Pattern: `<job_name>:<entity_id>:<discriminator>`.
- Example: `invoice_send:inv_abc123:initial`, `password_reset_email:user_xyz:1714000000`.
- See file 08 for full deduplication discussion.

### Files
- `src/jobs/notifications/notifications.queue.ts` — re-exports the `Queue` token + adds typed `add()` helpers.
- `src/jobs/notifications/notifications.processor.ts` — the `WorkerHost`.
- `src/jobs/notifications/handlers/email-send.handler.ts` — actual logic, injectable service.
- `src/jobs/notifications/types.ts` — discriminated union of job payloads.

## 9. Typed job payloads

Strongly-type job data with a discriminated union:

```ts
export type NotificationJob =
  | { name: 'email_send'; data: EmailSendData }
  | { name: 'push_send'; data: PushSendData }
  | { name: 'sms_send'; data: SmsSendData }
  | { name: 'in_app_create'; data: InAppCreateData };
```

Wrap `queue.add` in a typed helper so callers can't add malformed jobs:

```ts
@Injectable()
export class NotificationsQueue {
  constructor(@InjectQueue('notifications') private q: Queue) {}

  enqueue<T extends NotificationJob>(job: T, opts?: JobsOptions) {
    return this.q.add(job.name, job.data, opts);
  }
}
```

This pays for itself the first time someone tries to add a typo'd job name.

## 10. Job options defaults

Set sensible per-queue defaults so callers don't have to think about retries every time:

```ts
BullModule.registerQueue({
  name: 'notifications',
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail:    { count: 5000, age: 7 * 24 * 3600 },
  },
});
```

### Why `removeOn*` matters
Without it, completed/failed jobs **accumulate forever in Redis**, eating memory. The shape `{ count: N, age: seconds }` keeps the most recent N within the age window — both bounds.

Recommended defaults:
- `notifications`: complete-1k/24h, fail-5k/7d (we want to debug failures)
- `payments`: complete-10k/30d, fail-10k/90d (audit trail matters)
- `media`: complete-500/24h, fail-2k/30d
- `analytics`: complete-100/6h, fail-1k/7d

## 11. Rate limiting (essential for Stripe + email)

```ts
new Worker('payments', processor, {
  limiter: { max: 10, duration: 1000 }, // 10 jobs/sec
});
```

For MotionHive we should rate-limit:
- **Payments queue**: Stripe API has 100 req/sec on test, 25 req/sec on live → cap at 20.
- **Notifications/email_send**: Resend free tier is 100 emails/day; paid is 10 req/sec.
- **Notifications/sms_send**: Twilio is 1 SMS/sec on long codes.

## 12. Repeatable jobs (cron)

BullMQ supports repeatable jobs:
```ts
queue.add('cleanup_expired', {}, {
  repeat: { pattern: '0 3 * * *' },  // 3am daily
  jobId: 'cleanup_expired_cron',     // dedup the schedule itself
});
```

Note: NestJS already has `@nestjs/schedule` for cron. Use `@nestjs/schedule` only for the **trigger** that enqueues the job — never run business logic inside `@Cron()` directly. The trigger fires `queue.add(...)` and the worker runs the actual work. This way:
- A late/missed cron doesn't lose work (BullMQ has the queue).
- Multi-instance API doesn't double-run (use `@nestjs/schedule` only on a designated leader, or use BullMQ's repeatable jobs which are inherently single-fire).

**Cleaner alternative**: skip `@nestjs/schedule` entirely and use BullMQ repeatables. One less moving part.

## 13. Things to avoid (easy mistakes)

- ❌ **Heavy payloads**: don't put a 10MB image in a job. Upload to Cloudinary first, pass the URL.
- ❌ **`console.log` in processors**: use the Winston logger we already have.
- ❌ **DB transactions spanning the entire job**: keep transactions tight; if the job fails after committing, idempotency handles re-runs.
- ❌ **Catching errors silently**: let BullMQ see the throw — that's how retries work. Catch only to add context, then re-throw.
- ❌ **Long-lived state in the processor class**: processors are singletons; mutable state across jobs causes bugs.
- ❌ **Forgetting `removeOn*`**: we'll OOM Redis in 6 weeks.

## 14. Suggested directory structure

```
src/
├── modules/
│   └── notification/
│       ├── notification.module.ts
│       ├── notification.service.ts       ← business API: notify(), notifyMany()
│       └── ...
└── jobs/
    ├── jobs.module.ts                    ← imports BullModule.forRoot
    ├── notifications/
    │   ├── notifications.module.ts
    │   ├── notifications.queue.ts        ← typed add() wrapper
    │   ├── notifications.processor.ts    ← WorkerHost dispatcher
    │   ├── handlers/
    │   │   ├── email-send.handler.ts
    │   │   ├── push-send.handler.ts
    │   │   └── ...
    │   └── types.ts
    ├── payments/
    │   └── ...
    └── ...
```

`modules/notification` owns the business API; `jobs/notifications` is the transport. The notification module *uses* the queue but doesn't own its lifecycle.

## Sources

- [BullMQ official docs — Workers](https://docs.bullmq.io/guide/workers)
- [BullMQ — Parallelism and concurrency](https://docs.bullmq.io/guide/parallelism-and-concurrency)
- [BullMQ — Sandboxed processors](https://docs.bullmq.io/guide/workers/sandboxed-processors)
- [BullMQ — Graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown)
- [BullMQ — Stalled jobs](https://docs.bullmq.io/guide/workers/stalled-jobs)
- [BullMQ — Architecture](https://docs.bullmq.io/guide/architecture)
- [NestJS Queues docs](https://docs.nestjs.com/techniques/queues)
- [NestJS BullMQ guide](https://docs.bullmq.io/guide/nestjs)
- [Mastering BullMQ in NestJS — NashTech](https://blog.nashtechglobal.com/mastering-bullmq-in-nestjs-a-step-by-step-introduction-part-1/)
- [BullMQ scaling — DragonflyDB](https://www.dragonflydb.io/faq/bullmq-scaling-effective-ways)
- [Worker queues in NestJS — Bhagya Rana](https://medium.com/@bhagyarana80/worker-queues-in-nestjs-scaling-with-bullmq-and-redis-without-breaking-your-api-903fdcff43df)
- [Handling 2M jobs/day in NestJS — Hash Block](https://medium.com/@connect.hashblock/handling-2-million-background-jobs-a-day-in-nestjs-with-bullmq-and-rate-limited-queues-d059f8c69681)
- [BullMQ deduplication](https://docs.bullmq.io/guide/jobs/deduplication)
- [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids)
- [BullMQ auto-removal of jobs](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs)
- [Background Job Processing in Node.js (2026)](https://dev.to/young_gao/background-job-processing-in-nodejs-bullmq-queues-and-worker-patterns-31d4)
