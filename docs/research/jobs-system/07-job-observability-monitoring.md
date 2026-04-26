# 07 — Job Observability and Monitoring

> Research date: **2026-04-25**.
>
> Scope: how to see what BullMQ is doing in production. UIs, metrics, dead-letter patterns, alerting.

## TL;DR

- **Bull Board** is the default. Free, open-source, mounts as Express middleware in our NestJS app. Use it.
- **Built-in BullMQ Prometheus metrics** since v5 — flip a switch, scrape from Grafana Cloud free tier.
- **Taskforce.sh** is the official paid dashboard if Bull Board isn't enough (rare at our scale).
- **Dead-letter queue pattern**: a separate `<queue>-dlq` queue that failed jobs are moved to after retries exhaust.
- **Alerting**: Grafana Cloud free tier has alerting. Or a simple cron that queries queue counts and posts to Slack/Discord webhook.

## Dashboard / UI options

### Bull Board (recommended)

**Repo**: <https://github.com/felixmosh/bull-board> (~3k stars, MIT)
**Maintainer**: Felix Mosheev (community, not Taskforce)

Drop-in queue dashboard. List queues, inspect jobs, see job data + failure reasons, retry/promote/remove jobs, see stats over time.

**Pros**:
- Free, MIT, well-maintained.
- Mounts as Express middleware → embeds in our NestJS app at `/admin/queues`.
- Supports BullMQ + Bull + BeeQueue.
- Per-queue metrics chart.

**Cons**:
- No persistent metrics history (just what's in Redis).
- Auth is your problem — wrap with our existing JWT/RBAC guards.
- No alerting.

**Cost**: $0.

#### NestJS integration

```ts
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(notificationsQueue),
    new BullMQAdapter(paymentsQueue),
    // ...
  ],
  serverAdapter,
});

app.use('/admin/queues', authMiddleware, serverAdapter.getRouter());
```

Wrap `/admin/queues` with our existing `AuthGuard('jwt') + RolesGuard(['SUPER_ADMIN', 'ADMIN'])`.

#### Production hardening
- Always behind admin auth — never publicly accessible.
- Disable destructive actions in prod (no `clean queue`, no `obliterate`).
- Log who clicked retry/remove (custom middleware).

### Taskforce.sh (official, paid)

**Site**: <https://taskforce.sh> · By the BullMQ creators.

Hosted SaaS dashboard with:
- Real-time queue metrics history.
- Alerting (email/Slack on stuck/failed jobs).
- Multi-environment management.
- Audit log.

**Pricing** (checked 2026-04-25): starts ~$25/mo for hosted, on-prem available with custom pricing.

**When to use**: when Bull Board's lack of metrics history bites, or when we want alerting without hooking up Prometheus/Grafana ourselves.

**Recommendation**: **Defer.** Bull Board + Prometheus/Grafana free tier covers everything Taskforce does, for $0. Revisit if we get tired of stitching the pieces together.

### Arena

**Repo**: <https://github.com/bee-queue/arena>

Older alternative to Bull Board. Still works but Bull Board has more momentum and a nicer UI in 2026.

**Recommendation**: **Skip.** Bull Board strictly better.

### QueueDash, upqueue.io

Newer entrants. Limited adoption. Bull Board is the safe choice.

## Metrics: BullMQ → Prometheus → Grafana

### Built-in Prometheus support (BullMQ v5+)

Since BullMQ v5, there's a built-in `exportPrometheusMetrics(queue)` function. ([BullMQ Prometheus docs](https://docs.bullmq.io/guide/metrics/prometheus))

```ts
import { exportPrometheusMetrics } from 'bullmq';
import express from 'express';

const metricsApp = express();
metricsApp.get('/metrics', async (req, res) => {
  const text = await exportPrometheusMetrics({
    queues: [notificationsQueue, paymentsQueue],
  });
  res.type('text/plain').send(text);
});
metricsApp.listen(9100);
```

Or expose via NestJS controller:

```ts
@Controller('metrics')
export class MetricsController {
  @Get()
  @Public()  // restrict by IP allowlist instead
  async metrics(@Res() res) {
    const text = await exportPrometheusMetrics({ queues: this.allQueues });
    res.type('text/plain').send(text);
  }
}
```

### Available metrics
- `bullmq_job_count{queue, state}` — waiting/active/completed/failed/delayed counts per queue.
- `bullmq_job_processing_time_seconds` — histogram.
- `bullmq_job_wait_time_seconds` — time from enqueue to pick-up.
- Worker-level metrics (active jobs, etc.).

### Third-party exporters (alternatives)

- **bullmq-exporter** ([repo](https://github.com/ron96g/bullmq-exporter)) — standalone Docker image, includes a built-in dashboard.
- **bullmq-prometheus** ([repo](https://github.com/igrek8/bullmq-prometheus)) — Docker image, more configurable.

For us: **use the built-in `exportPrometheusMetrics`**. One less moving part than a separate container.

### Where to send metrics: Grafana Cloud Free

Grafana Cloud Free (as of 2026-04-25):
- 10k Prometheus active series
- 50GB logs/month
- 50GB traces/month
- 14-day retention
- Alerting included

Way more than we need. Free tier is the answer for the next 1–2 years.

#### Alternative: Better Stack (Logtail), Datadog free tier, Axiom

All viable. Grafana Cloud is the obvious default for Prometheus metrics.

### Grafana dashboards

Pre-built community dashboards ([Bull Queue Prometheus dashboard #14278](https://grafana.com/grafana/dashboards/14278-bull-queue-prometheus/)):
- Queue depth over time
- Job throughput (completed/sec)
- Failure rate
- Wait time p50/p95/p99
- Active workers per queue

Import the dashboard, point it at our metrics endpoint. ~30 minutes of setup.

## Logging patterns

### Correlation IDs

Every job should carry the request ID that triggered it. We already have `RequestIdMiddleware` for HTTP — extend the pattern:

```ts
// On enqueue
queue.add('email_send', payload, {
  jobId: ...,
  // BullMQ doesn't have first-class headers; attach via payload or job opts
});
// Attach to logger
this.logger.defaultMeta = { requestId, jobId: job.id, queue: 'notifications' };
```

Use **AsyncLocalStorage** to thread requestId through async boundaries (we should already have this for HTTP requests; reuse for jobs).

### Structured logs (we already use Winston)

Make sure each log line in a processor includes:
- `queue` — name
- `job_name` — e.g. `email_send`
- `job_id`
- `attempt` — current retry number
- `request_id` — original trigger context

```ts
this.logger.info('Email sent', {
  queue: 'notifications', job_name: 'email_send', job_id: job.id,
  attempt: job.attemptsMade, request_id: job.data.requestId,
  user_id: job.data.userId, provider_message_id: result.id,
});
```

### Log volume

BullMQ at 100k jobs/day ≈ 5–10 log lines per job ≈ 1M log lines/day. Grafana Cloud Logs free tier handles 50GB/month easily for typical line sizes.

## Dead-letter queue (DLQ) pattern

BullMQ doesn't ship a DLQ out of the box; you build one with conventions.

### Pattern

```ts
@Processor('notifications', { ... })
export class NotificationsProcessor extends WorkerHost {
  constructor(@InjectQueue('notifications-dlq') private dlq: Queue) {}

  async process(job: Job) {
    // ... handler logic
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error) {
    if (job.attemptsMade >= job.opts.attempts) {
      // Max retries exhausted — move to DLQ
      await this.dlq.add(job.name, {
        originalData: job.data,
        failureReason: err.message,
        failureStack: err.stack,
        originalQueue: 'notifications',
        failedAt: new Date(),
        totalAttempts: job.attemptsMade,
      });
      this.logger.error('Job moved to DLQ', { job_id: job.id, error: err.message });
    }
  }
}
```

### DLQ inspection
- Bull Board includes the DLQ as just another queue.
- Manual triage: dev sees a job in DLQ, fixes the underlying bug, manually re-enqueues to original queue.

### Naming convention
- Per queue: `notifications-dlq`, `payments-dlq`, etc.
- Or one global `dlq` queue with `originalQueue` in payload — simpler to monitor, harder to triage.

For us: **per-queue DLQ**. Easier to alert on "payments-dlq has > 0 jobs".

## Alerting

### What to alert on

| Condition | Severity | Action |
|---|---|---|
| Any queue's failed-state count > 50 | Warning | Slack channel |
| Any queue's `payments-dlq` count > 0 | Critical | Page on-call |
| Worker concurrency drops to 0 unexpectedly | Critical | Page |
| Job wait time p95 > 60s | Warning | Slack channel |
| Job processing time p95 > 30s | Warning | Investigate |
| Specific job_name fails > 5x in 5min | Critical | Slack |

### How to alert

#### Option 1: Grafana Cloud alerts (recommended)

Grafana Cloud Free includes alerting. Define alert rules in Grafana, route to:
- Slack webhook
- Discord webhook
- Email
- PagerDuty (paid integration)

Setup: ~1 hour for basic alerts.

#### Option 2: NestJS cron + Slack webhook (simpler)

If we don't want to set up Prometheus/Grafana yet:

```ts
@Cron('*/5 * * * *')  // every 5 min — but use BullMQ repeat instead
async checkQueueHealth() {
  const counts = await this.notificationsQueue.getJobCounts();
  if (counts.failed > 50 || counts.delayed > 1000) {
    await this.slackWebhook.post({
      text: `🚨 notifications queue: ${counts.failed} failed, ${counts.delayed} delayed`,
    });
  }
}
```

**Pros**: 50 lines of code, no new infra.
**Cons**: no historical trend, no rich alerting logic.

For MVP: this. Add Grafana when we want trend visibility.

## Stuck jobs / stalled jobs

BullMQ has a concept of **stalled** jobs: a worker locked the job, then died before finishing. After `lockDuration` (default 30s), the job becomes available for another worker.

### How to detect
- BullMQ metric `bullmq_stalled_jobs_total` (in Prometheus output).
- Bull Board shows stalled count per queue.
- A job with `attemptsMade > 0` and very recent timestamps is suspicious.

### How to fix
- **Tighten `lockDuration`** if jobs are short.
- **Lengthen `lockDuration`** if jobs are legitimately slow (then `lockRenewTime` should fire).
- **Make jobs idempotent** so re-running after stall is safe (file 08).

### Alert on stalled
If stalled jobs > 10 in 1 hour, something is killing workers. Check memory, OOM, deploy churn.

## Observability checklist

For a healthy production setup:

- [ ] Bull Board mounted at `/admin/queues`, behind admin auth
- [ ] Prometheus `/metrics` endpoint exposing BullMQ metrics
- [ ] Grafana Cloud (or similar) scraping the endpoint
- [ ] Pre-built BullMQ Grafana dashboard imported
- [ ] DLQ created for each queue
- [ ] `OnWorkerEvent('failed')` moves exhausted-retry jobs to DLQ
- [ ] Winston logs include `queue`, `job_name`, `job_id`, `attempt`, `request_id`
- [ ] Slack webhook alert when DLQ count > 0
- [ ] Slack alert when failed > 50 in any queue
- [ ] Sentry capture in `OnWorkerEvent('failed')` (we should already have Sentry — extend it)
- [ ] Document runbook: "what to do when X queue is stuck"

## What I'd do for MotionHive (in order)

1. **Day 1 with first processor**: Bull Board mounted under `/admin/queues`, auth-gated. (1–2 hours.)
2. **Day 1**: per-queue DLQ + `OnWorkerEvent('failed')` to push exhausted jobs there. (2–3 hours.)
3. **Week 1**: Slack webhook cron alert on DLQ > 0 and failed > 50. (1 hour.)
4. **Month 1**: BullMQ Prometheus endpoint + Grafana Cloud Free + the community dashboard. (Half a day.)
5. **Later**: Taskforce.sh **only if** Grafana feels insufficient.

Total upfront: **1 day of focused work** to be confidently observable.

## Cost summary

| Tool | Cost |
|---|---|
| Bull Board | $0 |
| Built-in Prometheus | $0 |
| Grafana Cloud Free (10k series, 50GB logs) | $0 |
| Slack webhook | $0 |
| Sentry (existing) | $0 (free tier) or $26/mo (Team) |
| Taskforce.sh (optional) | ~$25/mo |
| **Total recommended** | **$0/mo** |

Observability is one of the rare areas where open-source/free-tier tools genuinely match the paid ones for our scale.

## Sources

- [Bull Board GitHub](https://github.com/felixmosh/bull-board)
- [Bull Board npm](https://www.npmjs.com/package/@bull-board/ui)
- [Taskforce.sh](https://taskforce.sh/)
- [Arena GitHub](https://github.com/bee-queue/arena)
- [BullMQ metrics docs](https://docs.bullmq.io/guide/metrics)
- [BullMQ Prometheus integration](https://docs.bullmq.io/guide/metrics/prometheus)
- [bullmq-exporter (3rd party)](https://github.com/ron96g/bullmq-exporter)
- [bullmq-prometheus (3rd party)](https://github.com/igrek8/bullmq-prometheus)
- [Grafana dashboard: Bull Queue Prometheus](https://grafana.com/grafana/dashboards/14278-bull-queue-prometheus/)
- [Grafana dashboard: Bull All Queues](https://grafana.com/grafana/dashboards/14538-all-queues/)
- [BullMQ stalled jobs docs](https://docs.bullmq.io/guide/workers/stalled-jobs)
- [How to Implement DLQ in BullMQ — OneUptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-dead-letter-queue/view)
- [Bull Board NestJS integration — DEV](https://dev.to/ronak_navadia/level-up-your-nestjs-app-with-bullmq-queues-dlqs-bull-board-5hnn)
