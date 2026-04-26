# 01 — Job Queue / Workflow Engine Landscape

> Research date: **2026-04-25**. All pricing checked on this date and may drift; treat as a snapshot.
>
> Scope: choosing the queue/workflow runtime for MotionHive (NestJS 11 + Postgres + planned Redis on Railway). Cost-sensitive small team, must scale from 1 instance to multi-worker without rewrite.

## TL;DR ranking for our context

| Rank | Tool | Why it ranks here |
|---|---|---|
| 1 | **BullMQ** | NestJS first-class, free/self-hosted, scales linearly, every Stack Overflow answer is for it |
| 2 | **pg-boss** | Compelling if we want to defer Redis entirely; ceiling ~10k jobs/min is fine for our scale |
| 3 | **Inngest** | Best DX of the SaaS options; free tier covers MVP; lock-in risk |
| 4 | **Trigger.dev v3** | Comparable to Inngest; long-running tasks shine; pricier above free |
| 5 | **Hatchet** | Postgres-only and self-hostable, but young (v1 GA 2025); good escape hatch from BullMQ |
| 6 | **Temporal** | Overkill at our scale; cost can balloon (action-multiplication trap) |
| - | Bull (legacy) | Skip — EOL by end of 2026, BullMQ is the successor |
| - | BetterQueue | In-process, no persistence beyond SQLite — wrong tool for us |
| - | Quirrel | Effectively dead; founder went to Netlify |

## 1. Bull (legacy) vs BullMQ

**Bull** was the de facto Node Redis queue 2017–2022. The same author (Manuel Astudillo / Taskforce) built **BullMQ** as a TypeScript-first, architecturally cleaner rewrite. As of 2026 Bull is in maintenance mode (bug fixes only); BullMQ is where all features land. NestJS ships **both** packages (`@nestjs/bull` and `@nestjs/bullmq`), but the docs and examples increasingly default to BullMQ.

Key differences ([oneuptime comparison](https://oneuptime.com/blog/post/2026-01-21-bullmq-vs-bull/view), [pocketlantern brief](https://pocketlantern.dev/briefs/bull-vs-bullmq-node-job-queue-performance-2026)):

- **Architecture**: BullMQ separates `Queue`, `Worker`, and `QueueEvents` into distinct classes. Bull was monolithic.
- **Connection**: BullMQ requires explicit ioredis connection; Bull accepted a URL string.
- **TypeScript**: BullMQ has first-class types; Bull's types were community-maintained.
- **Flows**: BullMQ has `FlowProducer` (parent/child jobs) — Bull has nothing equivalent.
- **NestJS decorators**: Bull allows multiple `@Process()` methods per class. BullMQ requires extending `WorkerHost` and implementing a single `process()` method with a name discriminator.
- **Migration**: not a drop-in. Job payloads are not guaranteed to be readable across versions; plan a parallel-drain migration.

We currently have **Bull v3** imported but no processors. Verdict: **migrate to BullMQ before writing the first processor.** Cost of switch is near-zero since we have no processors yet.

## 2. BullMQ

**Repo**: <https://github.com/taskforcesh/bullmq>  (~7k stars, ~5M weekly downloads as of 2026-04)
**Docs**: <https://docs.bullmq.io>
**NestJS module**: `@nestjs/bullmq` — <https://docs.nestjs.com/techniques/queues>

### What it is
A distributed job queue and message broker built on Redis. Supports delayed jobs, repeatable/cron jobs, prioritization, rate limiting, retries with exponential backoff, parent/child flows, and sandboxed processors (separate Node processes for CPU-bound work).

### Pros
- **Free** and Apache-2.0 licensed.
- Excellent **NestJS integration** (decorators: `@Processor`, `@OnWorkerEvent`).
- **Scales horizontally**: just run more worker processes.
- **Mature**: powers Spotify Backstage, Open Web Analytics, hundreds of mid-size SaaS.
- **Sandboxed processors** for CPU-heavy jobs (image transcode, PDF) without blocking the event loop.
- **Built-in Prometheus metrics** (since v5) — see file 07.
- **FlowProducer** lets us model "send invoice" as parent + N email/SMS child jobs with shared completion semantics.

### Cons
- **Requires Redis**. That's the whole conversation — it's a real piece of infra to manage. Persistence config (AOF vs RDB) matters; if Redis loses memory, in-flight job state is gone.
- **No native Postgres mode**. If we want to avoid Redis we must change library.
- **Bull Board UI is community-maintained** (not by Taskforce); Taskforce.sh is the paid official UI.
- Learning curve for advanced features (Flows, rate limit groups, debounce/throttle dedup modes).

### Cost
- Library: $0.
- Runtime: cost = Redis hosting (see file 03) + worker compute. On Railway Hobby ($5 credit), a small Redis + a worker dyno fits inside ~$10/mo.
- Optional: Taskforce.sh dashboard (paid, see file 07) ~$25/mo for hosted; Bull Board is free.

### Recommendation for us
**Yes, default choice.** Migrate `@nestjs/bull` → `@nestjs/bullmq` in the same PR that introduces the first processor.

## 3. pg-boss

**Repo**: <https://github.com/timgit/pg-boss> (~3k stars, ~230k weekly downloads as of 2026-04)
**Docs**: <https://www.npmjs.com/package/pg-boss>

### What it is
A queue that uses PostgreSQL as the broker. Built on `SELECT ... FOR UPDATE SKIP LOCKED` (Postgres 9.5+). Supports retries, scheduled jobs, cron, fan-out/fan-in workflows, and pub/sub.

### Pros
- **Zero new infra**: uses our existing Neon Postgres.
- **Exactly-once delivery semantics** (Postgres atomicity).
- **Transactional enqueue**: enqueue a job *in the same transaction* as a domain write. No outbox pattern needed for the basic case. This is huge for our Stripe webhook flow.
- **Cheap operationally**: no Redis to monitor.
- **Good NestJS adapters exist** (community: e.g. `@nestjs-pg-boss/core`).

### Cons
- **Throughput ceiling**: ~100–200 jobs/sec per Postgres instance before lock contention. Graphile-Worker pushes higher (~200k/sec on a beefy Postgres) but pg-boss is more conservative.
- **Adds load to Postgres**: every poll is a query. On Neon (serverless Postgres) this can wake compute and inflate cost if poll interval is too aggressive.
- **No native NestJS module from `@nestjs/*`** — community packages only.
- **Less ecosystem**: Bull Board doesn't speak pg-boss. Monitoring is DIY.
- **No FlowProducer-equivalent yet**.

### Cost
- Library: $0.
- Runtime: $0 incremental if we already pay for Postgres. **Caveat**: on Neon's autosuspend tier, a polling worker keeps the compute warm and prevents suspension — that's a real cost (potentially $5–20/mo).

### Recommendation
**Strong consider for v1** if we want to avoid Redis entirely until traffic justifies it. Migration path BullMQ→pg-boss or pg-boss→BullMQ is roughly a week of work either direction (job shape is similar enough). At our scale (<10k jobs/day MVP) pg-boss is plenty.

## 4. Inngest

**Site**: <https://www.inngest.com> · **Pricing**: <https://www.inngest.com/pricing> · **Repo**: <https://github.com/inngest/inngest>

### What it is
A managed durable workflow platform. You write functions in your codebase decorated with event triggers; Inngest invokes them via HTTP. Step functions, automatic retries, fan-out, and a hosted dashboard come for free. Self-hosted version available (Apache 2.0) but the cloud is the intended path.

### Pros
- **Best DX in the category**. Functions are plain TypeScript — no special runtime.
- **Step-based durability**: each `step.run()` checkpoints. Handler crash mid-flow → resumes from last checkpoint.
- **Free tier is generous**: 50k executions/month + 1–5M events/day at $0 (per pricing page checked 2026-04-25).
- **No Redis to operate**.
- **Built-in dashboard, replay, traces**.
- **Open source** — exit option exists.

### Cons
- **Vendor lock-in** for the cloud version. Migrating off later is a meaningful refactor.
- **HTTP invocation model** means cold-start latency matters; not great if our workers run on a sleeping Hobby dyno.
- **Pricing climbs fast** above free: Pro is $25/mo + $50/M executions. At 1M executions/mo that's $75/mo.
- **NestJS integration is "use the SDK from a controller"** — works but not idiomatic.

### Cost (checked 2026-04-25)
- Hobby: $0 (50k executions/mo)
- Pro: $25/mo + $50 per million additional executions
- Self-hosted: $0 + your infra

### Recommendation
**Defer.** Inngest is a great option if we hit a wall with BullMQ (e.g. need durable multi-step workflows with replay UI). Lock-in risk and cost trajectory don't justify starting here.

## 5. Trigger.dev v3

**Site**: <https://trigger.dev> · **Pricing**: <https://trigger.dev/pricing>

### What it is
Comparable to Inngest. v3 (open access from 2024) moved execution from your serverless functions to dedicated long-running compute managed by Trigger.dev — so jobs can run for minutes/hours without serverless timeout limits. SDK-based, TypeScript-first.

### Pros
- **Long-running jobs are first-class** (good for video transcoding, PDF generation, AI workflows).
- **Generous free tier**: $0/mo + $5 free monthly usage, 10 concurrent runs (checked 2026-04-25).
- **Open source** (Apache 2.0).
- **Better for AI/agent workflows** than BullMQ.

### Cons
- **Same lock-in concerns as Inngest**.
- **Jumps to $50/mo (Pro)** quickly past free tier.
- **NestJS integration ad-hoc**.
- **Less mature than Inngest** in terms of community examples.

### Cost (checked 2026-04-25)
- Free: $0 ($5 of usage)
- Hobby: $10/mo
- Pro: $50/mo
- Enterprise: custom

### Recommendation
**Defer.** Same logic as Inngest — keep in pocket if/when we need long-running durable workflows.

## 6. Temporal

**Site**: <https://temporal.io> · **Pricing**: <https://temporal.io/pricing>

### What it is
The 800-pound gorilla of workflow orchestration. Born at Uber (Cadence), now the de facto standard at AWS Step Functions–scale problems. Workflows are written as code with strong durability guarantees.

### Pros
- **Best-in-class durability semantics**.
- **Polyglot SDKs** (Go, Java, TS, Python, .NET).
- **Battle-tested at huge scale**.
- **Open source**, can self-host.

### Cons
- **Massively over-engineered for our scale**. Self-hosting requires Cassandra or Postgres + Elasticsearch + multiple Temporal services.
- **Cloud pricing scales with "actions"** which multiply unexpectedly. 13k workflows = $500 reported in community discussions. ([Temporal action multiplication](https://temporal.io/blog/estimating-the-cost-of-temporal-cloud))
- **Steep learning curve** (workflow vs activity, deterministic constraints, replay).
- **No NestJS-idiomatic story**.

### Cost (checked 2026-04-25)
- Dev: free
- Essentials: $100/mo
- Growth: $200/mo (1M actions included)
- Business: ~$2,000/mo
- Self-hosted: $0 + ops cost (which is high)

### Recommendation
**No.** Revisit only if we ever need complex multi-day saga orchestration with strong correctness requirements (e.g. payments reconciliation across 10 systems). Even then, Hatchet is the lighter alternative.

## 7. Hatchet

**Site**: <https://hatchet.run> · **Pricing**: <https://hatchet.run/pricing> · **Repo**: <https://github.com/hatchet-dev/hatchet>

### What it is
YC W24 startup. Open-source task orchestration platform built on **Postgres** (no Kafka/Redis dependency). v1 GA'd in 2025. Goal: Temporal's durability, pg-boss's simplicity. Cloud + self-hosted (MIT).

### Pros
- **Postgres-only** — fits our existing stack.
- **Durable workflows** with DAG orchestration (better than BullMQ flows).
- **MIT licensed**, fully self-hostable.
- **Generous cloud free tier**: 100k task runs included.
- **Modern**: built knowing what BullMQ/Temporal/Inngest got right and wrong.

### Cons
- **Young** — v1 only ~1 year old. Smaller community.
- **No NestJS-idiomatic adapter yet** (SDK is plain TS).
- **Self-hosting requires Hatchet engine + Postgres** — more moving parts than pg-boss.
- **Less Stack Overflow surface** than BullMQ.

### Cost (checked 2026-04-25)
- Cloud: $10 per 1M task runs, first 100k included
- Self-hosted: $0

### Recommendation
**Watch.** If pg-boss hits its ceiling and we don't want to add Redis, Hatchet is the natural next step. Not v1 material — too young.

## 8. BetterQueue

**Repo**: <https://github.com/diamondio/better-queue>

### What it is
An in-process Node queue with optional SQLite persistence. Simple API.

### Recommendation
**No.** Not a distributed queue — single-process only. Wrong tool for anything that needs to survive a restart on a separate worker. Mentioned only because it appears in npm-trends comparisons.

## 9. Quirrel

**Repo**: <https://github.com/quirrel-dev/quirrel>

### What it is
Was a managed queue for Vercel/Netlify serverless functions. Founder joined Netlify in 2022; functionality folded into Netlify Functions Background. Project is in maintenance mode — no new features.

### Recommendation
**No.** Dead-end. Inngest is the obvious replacement.

## 10. Other PG-based options worth knowing

- **graphile-worker** ([repo](https://github.com/graphile/worker)) — Postgres queue, ~196k jobs/sec on a 4-worker pool, LISTEN/NOTIFY-based, by the PostGraphile author. Smaller community than pg-boss but objectively faster. Worth a look if pg-boss feels limiting.
- **River** (Go) — not relevant for Node, but the design influences are visible in newer libs.

## Decision matrix for MotionHive

| Concern | BullMQ | pg-boss | Inngest | Hatchet |
|---|---|---|---|---|
| Cost at MVP (<10k jobs/day) | $5–10/mo (Redis) | $0 | $0 | $0 |
| Cost at growth (100k jobs/day) | $15–30/mo | $0–10 (DB load) | $50–100/mo | $0 (self-host) |
| NestJS integration quality | Excellent (`@nestjs/bullmq`) | Community only | Manual SDK | Manual SDK |
| Lock-in | None (Apache 2.0) | None (MIT) | High (cloud) | Low (MIT) |
| Throughput ceiling | Very high | ~10k/min | Whatever you pay for | Very high |
| Multi-step workflows | FlowProducer | Limited | Best-in-class | Excellent |
| Operational complexity | Low–Med (Redis) | Lowest | Lowest (SaaS) | Medium |
| Maturity | Very high | High | Medium-high | Low |
| Recommended for v1 | **Yes** | **Yes (alt)** | No | No |

## Two-option shortlist

1. **BullMQ + Redis** (default). Industry standard, no lock-in, scales as far as we'll ever need. Costs ~$5–10/mo of Redis.
2. **pg-boss** (alt). Defer Redis entirely. Plenty of headroom for our scale. Migrate to BullMQ later if/when ops complexity is justified.

The "right" answer depends on whether you'd rather pay $5–10/mo to dodge a class of operational problems (BullMQ's choice gives us mature tooling and Bull Board) or save that money and let Postgres handle it (pg-boss).

## Sources

- [BullMQ official docs](https://docs.bullmq.io)
- [BullMQ vs Bull comparison — OneUptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-vs-bull/view)
- [Bull vs BullMQ vs Resque — PocketLantern (2026)](https://pocketlantern.dev/briefs/bull-vs-bullmq-node-job-queue-performance-2026)
- [NestJS BullMQ guide](https://docs.bullmq.io/guide/nestjs)
- [pg-boss GitHub](https://github.com/timgit/pg-boss)
- [pg-boss vs RabbitMQ vs Redis discussion](https://github.com/timgit/pg-boss/issues/94)
- [Postgres Is All You Need — DEV](https://dev.to/shayy/postgres-is-all-you-need-3pgb)
- [Inngest pricing](https://www.inngest.com/pricing)
- [Inngest GitHub](https://github.com/inngest/inngest)
- [Trigger.dev pricing](https://trigger.dev/pricing)
- [Trigger.dev v3 launch](https://trigger.dev/blog/v3-open-access)
- [Temporal pricing](https://temporal.io/pricing)
- [Temporal Cloud cost estimation](https://temporal.io/blog/estimating-the-cost-of-temporal-cloud)
- [Hatchet GitHub](https://github.com/hatchet-dev/hatchet)
- [Hatchet pricing](https://hatchet.run/pricing)
- [Hatchet HN launch](https://news.ycombinator.com/item?id=43572733)
- [Quirrel status discussion](https://github.com/quirrel-dev/quirrel/discussions/1169)
- [graphile-worker GitHub](https://github.com/graphile/worker)
- [graphile-worker performance](https://worker.graphile.org/docs/performance)
