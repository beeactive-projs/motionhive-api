# 10 — Recommendations Summary

> Research date: **2026-04-25**.
>
> This is the synthesis: what we'd recommend for **THIS project at THIS stage**, ranked options for the live decisions, and an explicit list of things that are cheap to defer.

## The shape of what's coming

After reading files 01–09, the shape of the system is:

```
┌────────────────────────────────────────────────┐
│ NestJS API (Railway)                           │
│  ├─ business code calls notify()               │
│  └─ webhook handlers write outbox + commit     │
└────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────┐
│ BullMQ on Redis (Railway addon)                │
│  ├─ notifications queue                        │
│  ├─ payments queue                             │
│  ├─ sessions queue                             │
│  ├─ media queue                                │
│  ├─ analytics queue                            │
│  ├─ auth queue                                 │
│  └─ maintenance queue                          │
└────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────┐
│ Workers (same dyno → eventually separate)       │
│  ├─ email_send → Resend                        │
│  ├─ push_send  → web-push lib (VAPID)          │
│  ├─ sms_send   → Twilio (when needed)          │
│  └─ in_app_create → Postgres + Redis pub/sub   │
│                            ↓                    │
│                       SSE stream → frontend     │
└────────────────────────────────────────────────┘
```

Cost: ~$5–10/mo at MVP, ~$60–120/mo at growth, ~$300–500/mo at scale.

## The three decisions that matter most

These shape the next 1–2 years. Get them right.

### Decision 1: BullMQ vs pg-boss

The choice between **Redis + BullMQ** and **Postgres-only + pg-boss**.

**Recommend: BullMQ.**

Why this matters more than it looks:
- The mature ecosystem (Bull Board, Prometheus support, Stack Overflow density) is BullMQ.
- NestJS first-class integration (`@nestjs/bullmq`) is significantly nicer than community pg-boss adapters.
- ~$1–5/mo of Redis is a price worth paying for "the path everyone walks."
- pg-boss caps at ~10k jobs/min — fine for us forever, but BullMQ's ceiling is way higher and we don't have to think about it.

The case for pg-boss:
- "No new infra" is real. Neon is already there.
- Transactional enqueue is built-in (no outbox needed for the simple case).
- One fewer thing to monitor.

If we choose pg-boss, the most likely outcome is "this works, but in 18 months we wish we'd picked BullMQ." If we choose BullMQ, the most likely outcome is "this works, and the $5/mo is invisible in the bill."

**Pick BullMQ. Migrate the existing `@nestjs/bull` import to `@nestjs/bullmq` in the same PR.**

### Decision 2: DIY notification system vs SaaS

The choice between **building the workflow + delivery layer ourselves** and **using Novu/Knock/Inngest**.

**Recommend: DIY.**

Why:
- Cost analysis (file 09): SaaS is 4–10x more expensive at every scale, with lock-in.
- Our needs are transactional, not marketing — the surface area is small (5 tables, 1 module, 4 channel adapters).
- We already have 70% of the infrastructure (Resend, Postgres, soon Redis).
- Effort estimate: ~3.5 weeks of focused work for production-ready DIY (file 04).
- "Build vs buy" calculus is "buy" only when the build cost > 2x ongoing run cost. At our scale build is a one-time ~3 week investment vs $250–2000/mo forever.

When this choice could flip:
- We hire a PM/marketer who needs a no-code workflow editor.
- We hit a notification reliability bug we can't diagnose.
- A founder change of heart on "should we be building infrastructure?"

None of these apply today. **Build it.**

### Decision 3: Realtime in-app — when, and what transport

Two sub-decisions:
- **When**: now (with the notification system) or later (after polling proves insufficient)?
- **What**: SSE or Socket.IO?

**Recommend: ship polling first, add SSE in phase 2 when the lag is felt.**

Reasoning:
- Polling at 30s interval is "good enough" for almost all notification UX.
- SSE is ~1 week of work; deferring it lets us ship the rest of the system sooner.
- SSE > Socket.IO for our notification-only use case (lower memory, cleaner code, NestJS first-class). If we add chat/live coaching later, add Socket.IO **alongside** SSE.

The cost of getting this wrong:
- Picking Socket.IO upfront when we don't need bidirectional → carry overhead forever.
- Not building any realtime → users complain about "slow" notifications. Survivable.
- Building SSE before we ship the rest → delayed launch with no clear win.

**Ship polling now. SSE when users notice.**

## Live options ranked

For each major component, the credible options ranked, with reasoning.

### Queue runtime

1. **BullMQ + Redis (Railway)** ⭐ recommended
2. **pg-boss** — viable alt if avoiding Redis matters more than ecosystem
3. **Hatchet (self-hosted)** — too young for v1, watch for v2 release
4. ~~Inngest / Trigger.dev~~ — too pricey + lock-in
5. ~~Temporal~~ — overkill
6. ~~Bull v3~~ — going EOL

### Redis hosting

1. **Railway addon** ⭐ recommended (lives next to the API, ~$1/mo at our scale)
2. **Redis Cloud Essentials** — backup option ($5/mo, off-Railway)
3. **Self-hosted Hetzner** — only when spend > $20/mo justifies the ops burden
4. ~~Upstash~~ — wrong shape for BullMQ workload
5. ~~Render~~ — wrong cloud for us

### Notification system architecture

1. **DIY** ⭐ recommended (3.5 weeks, ~$0/mo runtime)
2. **Novu Cloud free tier** — only if we want a fast start and 10k events/mo is enough
3. **Knock** — only if we hire a PM who wants a no-code editor
4. ~~Customer.io / OneSignal~~ — wrong product shape (marketing-oriented)
5. ~~Self-hosted Novu~~ — more infra than DIY (6 services + MongoDB)

### Realtime transport

1. **30s polling** ⭐ recommended for MVP (zero infra)
2. **SSE on NestJS** — phase 2, ~1 week of work
3. **Socket.IO on NestJS** — phase 3, only when bidirectional needed
4. ~~Pusher / Ably~~ — only above 5k+ concurrent connections
5. ~~Supabase Realtime~~ — would require switching DB to Supabase

### Email provider

1. **Resend** ⭐ recommended (already integrated, free tier covers MVP)
2. **AWS SES** — migration target at scale (~10x cheaper, more setup)
3. **Postmark** — premium alternative if Resend reliability ever disappoints
4. ~~SendGrid~~ — pricier, free tier removed in 2024

### SMS provider (when we add it)

1. **Twilio** — default if simple
2. **Plivo** — ~37% cheaper US/EU
3. **Local Romanian SMS gateway** — research before going wide on RO

### Push provider

1. **Self-hosted `web-push` lib** ⭐ recommended ($0)
2. ~~OneSignal~~ — only if we ever ship native iOS/Android apps

### Observability / dashboard

1. **Bull Board (free)** ⭐ recommended
2. **Grafana Cloud Free + BullMQ Prometheus** — add when we want trends/alerts
3. **Taskforce.sh** — paid, defer until Bull Board feels limiting

## What's cheap to defer

Things that are tempting to design upfront but are easy to retrofit later:

- **DLQ implementation**: build for the first queue, copy-paste the pattern when adding more. Don't over-abstract early.
- **Per-channel queue separation**: start with one `notifications` queue, named jobs. Split if you ever need different concurrency or rate limits per channel.
- **Workflow editor UI**: code-defined workflows are fine for the next year+.
- **Multi-locale templates**: build the schema with `locale` column from day 1, populate only `en` (or `ro`) until needed.
- **Web push**: ~½ week of work; can add after launch.
- **SMS**: defer until business case is clear; expensive in Romania.
- **Realtime in-app (SSE)**: ship polling first.
- **Sandboxed processors**: only when we add CPU-bound jobs (PDF gen).
- **FlowProducer**: only when a workflow has > 3 dependent steps.
- **LISTEN/NOTIFY for outbox relay**: 1s polling is fine; LISTEN/NOTIFY is a sub-ms optimization.
- **Cluster Redis / multi-region**: never for our scale.

## What's expensive to defer

Things that are cheap *now* and expensive *later*:

- **Set `removeOnComplete` and `removeOnFail` on day 1.** Forgetting this fills Redis in weeks.
- **Use custom `jobId` from day 1.** Backfilling idempotency keys later is awful.
- **Mount Bull Board on day 1.** Debugging without it is misery.
- **Wire correlation IDs through async boundaries.** Adding it later means re-instrumenting every job.
- **Configure `WORKER_ENABLED` env var pattern** (file 02) so we can split worker dynos with no code change.
- **Outbox pattern for Stripe webhook → notification.** Tiny addition now; eliminates a whole class of bugs later.
- **DLQ + Slack alert** (~1 hour of work). Way better than discovering a stuck queue from a user.

## A 30-day implementation plan

If we wanted a concrete sequence:

### Week 1: foundation
- Migrate `@nestjs/bull` → `@nestjs/bullmq`
- Add Railway Redis addon
- Create `JobsModule` with `BullModule.forRoot` and shared connection config
- Define 7 queues (file 02 layout)
- Set up Bull Board mounted at `/admin/queues` with admin auth
- Add per-queue DLQ pattern + `OnWorkerEvent('failed')` handler
- Cron-based Slack alert when DLQ count > 0

### Week 2: notification system core
- Create schema: `notification_workflow`, `notification_template`, `notification`, `user_channel_subscription`, `user_notification_preference`, `notification_delivery`
- Build `NotificationService.notify()` and `notifyMany()` with workflow registry, preference resolver, template renderer (Handlebars)
- Implement `email_send` channel adapter using existing Resend integration
- Implement `in_app_create` channel adapter (DB insert)
- REST endpoints: `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`
- Wire two existing notification points (e.g. `invoice.paid`, `session.reminder`) to the new service

### Week 3: web push + outbox
- Generate VAPID keys, add to env validation
- `push_subscription` table + endpoints
- Frontend: service worker + subscribe UI (or hand off to FE team)
- `push_send` channel adapter using `web-push` lib
- `outbox_event` table + relay job
- Refactor Stripe webhook handler to write to outbox

### Week 4: hardening
- BullMQ Prometheus metrics → Grafana Cloud dashboard
- User preferences API + frontend toggles (or partial — backend ready, FE follows)
- Migrate remaining notification points to `NotificationService`
- Documentation: notification module README, runbook for stuck queues
- Optional: SSE realtime if there's bandwidth

After 30 days: production-grade jobs + notification system.

## Commit-on points (decisions to lock now)

These should be settled in the design doc, not litigated mid-build:

1. **Queue runtime**: BullMQ on Railway Redis addon.
2. **Architecture**: per-domain queues (file 02), named jobs within each.
3. **Workflow definition**: code-defined (TS files), templates in DB.
4. **Channel adapter pattern**: every channel implements `ChannelAdapter` interface.
5. **Idempotency**: custom `jobId` everywhere, format `<workflow>:<entity>:<discriminator>`.
6. **Observability**: Bull Board + Grafana Cloud Free + Slack webhook for DLQ.
7. **Outbox**: yes for Stripe webhook → notification, no for non-critical fan-outs.
8. **Realtime**: polling at MVP, SSE in phase 2, Socket.IO only if bidirectional features arrive.

## Decisions to defer (don't pre-litigate)

These can wait for evidence:

- Whether to add Sentry's premium tier.
- Whether to move email to AWS SES (only when Resend bill > $50/mo).
- Whether to use Plivo or local SMS gateway (only when SMS is on the roadmap).
- Whether to introduce Hatchet (only if BullMQ ever hits a real ceiling).
- Whether to add Taskforce.sh (only if Bull Board limits us).
- Whether to add MongoDB-backed Novu (probably never).

## The single most important takeaway

**Own the orchestration. Lean on cheap delivery vendors.**

That single sentence captures the architecture and the cost discipline. Every SaaS option in this category violates one or both halves of it.

## Open questions for design discussion

Things this research can't answer; the team should discuss:

1. **Are there workflows that should fan out > 3 deep?** If yes, FlowProducer is worth designing in. If no, skip it.
2. **Do we want users to opt-in to workflows by default, or opt-out?** Different default has product implications.
3. **What's our Stripe webhook → email SLA?** If "must arrive in < 1s" then no outbox; otherwise outbox is recommended.
4. **Do we plan to ship native mobile apps?** If yes, OneSignal becomes attractive for the unified push story.
5. **Who maintains email templates?** If devs only, code-defined is fine. If non-devs touch them, we need a tiny admin UI even if templates live in DB.
6. **What's the expected SMS use case?** OTP/2FA only, or marketing? Different cost profile, different provider choice.

## Sources

This document synthesizes files 01–09 in this directory. Primary external references:

- [BullMQ docs](https://docs.bullmq.io)
- [NestJS Queues](https://docs.nestjs.com/techniques/queues)
- [Novu — open-source notification reference](https://github.com/novuhq/novu)
- [Knock pricing](https://knock.app/pricing)
- [Railway pricing](https://railway.com/pricing)
- [Resend pricing](https://resend.com/pricing)
- [Web Push at web.dev](https://web.dev/articles/push-notifications-web-push-protocol)
- [Transactional Outbox — Decodable](https://www.decodable.co/blog/revisiting-the-outbox-pattern)
