# 09 — Cost Analysis at Three Scales

> Research date: **2026-04-25**. All vendor pricing checked on this date.
>
> Scope: real monthly cost projections for the jobs + notification stack at MVP, Growth, and Scale. Honest about hidden costs.

## TL;DR

| Scale | Self-hosted (Railway) | Inngest | Knock | Hybrid (recommended) |
|---|---|---|---|---|
| MVP (<1k users, <10k jobs/day) | **$0–10/mo** | $0–25/mo | n/a (paid only) | **$0–10/mo** |
| Growth (10k users, 100k jobs/day) | **$30–50/mo** | $75–150/mo | $1,500/mo+ | **$40–80/mo** |
| Scale (100k users, 1M jobs/day) | **$150–300/mo** | $500–1,200/mo | $15,000/mo+ | **$200–400/mo** |

Self-hosting on Railway is 3–10x cheaper than SaaS at every scale. The cost crossover where SaaS becomes attractive is **never**, for our use case.

The pattern that drops out of the data: **own the queue, lean on cheap vendors for delivery (Resend/Twilio/web-push)**. Don't pay for the orchestration layer.

## Workload assumptions

For each scale, what generates the jobs?

### MVP (1k MAU, 10k jobs/day)
- Active users: ~1k MAU, ~100 DAU
- Notifications per active user/day: ~10 (session reminders, bookings, payments)
- Stripe webhook events: ~50/day
- Email sends: ~500/day (transactional), ~0 marketing
- Web push: ~500/day
- In-app notifications: ~3,000/day
- SMS: ~0
- **Total job volume: ~10k/day = 300k/month**

### Growth (10k MAU, 100k jobs/day)
- ~10k MAU, ~1k DAU
- Notifications per active user/day: ~15
- Stripe webhook events: ~500/day
- Email sends: ~5,000/day
- Web push: ~5,000/day
- In-app: ~30,000/day
- SMS: ~100/day (verifications, urgent alerts)
- **Total job volume: ~100k/day = 3M/month**

### Scale (100k MAU, 1M jobs/day)
- ~100k MAU, ~10k DAU
- ~1.5x notifications per user (heavy users dominate)
- Stripe webhooks: ~5,000/day
- Email sends: ~50,000/day
- Web push: ~50,000/day
- In-app: ~300,000/day
- SMS: ~1,000/day
- **Total job volume: ~1M/day = 30M/month**

These are realistic mid-volume SaaS numbers, not "Twitter scale."

## Self-hosted on Railway: full cost breakdown

### Components
1. **API dyno(s)** — NestJS handling HTTP requests
2. **Worker dyno(s)** — BullMQ workers
3. **Postgres** — Neon (existing) or Railway addon
4. **Redis** — Railway addon
5. **Email provider** — Resend
6. **SMS provider** — Twilio (when relevant)
7. **Push** — Self-hosted with `web-push` (free)
8. **Observability** — Grafana Cloud Free
9. **Sentry** — existing, included

### MVP pricing breakdown

| Component | Spec | Cost |
|---|---|---|
| Railway Hobby plan | $5 monthly credit | $5/mo |
| API dyno (combined w/ worker) | ~512MB RAM, light CPU | within credit |
| Postgres (Neon) | Existing, free tier | $0 |
| Redis (Railway addon) | 256MB RAM | within credit (~$1/mo) |
| Resend | Free tier (3k emails/mo, 100/day) | $0 |
| web-push | Self-hosted, free | $0 |
| Twilio | n/a at MVP | $0 |
| Grafana Cloud Free | 10k series | $0 |
| **Total** | | **~$5–10/mo** |

A typical MVP fits inside Railway's $5 Hobby credit. ~$10/mo only if email volume edges past Resend's free tier.

### Growth pricing breakdown

| Component | Spec | Cost |
|---|---|---|
| Railway Pro | $20 base + usage | $20–35/mo |
| API dyno | 1GB RAM, ~1 vCPU | ~$10–15/mo (within Pro credit) |
| Worker dyno (separate) | 512MB RAM | ~$5/mo |
| Postgres (Neon Scale) | 1.5x compute | ~$10–20/mo |
| Redis (Railway addon) | 1GB RAM | ~$5–10/mo |
| Resend Pro | 50k emails/mo | $20/mo |
| web-push | Self-hosted, free | $0 |
| Twilio | ~3k SMS/mo @ $0.0083 | ~$25/mo |
| Grafana Cloud Free | still fits | $0 |
| Sentry Team | optional | $0–26/mo |
| **Total** | | **~$60–120/mo** |

### Scale pricing breakdown

| Component | Spec | Cost |
|---|---|---|
| Railway Pro + extra usage | high usage | $80–150/mo |
| API dynos (2–3) | 1GB each | ~$30/mo |
| Worker dynos (2–3 specialized) | 1GB each | ~$30/mo |
| Postgres (Neon Pro or moved off Railway) | meaningful compute | $50–100/mo |
| Redis (1–2GB w/ HA) | upgraded | ~$20–40/mo |
| Resend Scale | 100k emails/mo | $35/mo (overage to ~$100/mo possible) |
| web-push | Self-hosted, free | $0 |
| Twilio | ~30k SMS/mo | ~$250/mo |
| Grafana Cloud Pro | over free tier | ~$30/mo |
| Sentry Business | upgrade likely | $80/mo |
| **Total** | | **~$300–500/mo** |

Twilio dominates at scale. Worth re-quoting against Plivo (~37% cheaper, $0.005/SMS vs $0.0083) for ~$100/mo savings.

## Hidden costs to watch

### Redis memory growth
BullMQ stores completed/failed jobs forever unless `removeOn*` is set. Without this, a 1k jobs/day load fills 256MB Redis in ~3 weeks. **Always set `removeOnComplete: { count: 1000, age: 24 * 3600 }` and similar for failed.**

### Postgres connection pool
Neon's Scale tier charges per active compute hour. Polling workers (LISTEN/NOTIFY or pg-boss) keep compute warm 24/7. **Could double Neon bill** vs request-driven traffic. Mitigation: poll less frequently, or use Redis-backed queue (BullMQ) that doesn't touch Postgres on idle.

### Egress / bandwidth
Railway charges $0.10/GB egress over 100GB/mo on Hobby. Notification payloads are small (~1KB), so 1M notifications = ~1GB. Negligible.

### Sentry quota
Sentry's free tier is 5k errors/mo. A buggy retry loop in BullMQ can chew through this in a day. **Set Sentry's `beforeSend` to dedupe by job_name + error fingerprint.**

### Cold-start tax
Railway's Hobby plan keeps services warm. Pro is the same. No cold-start tax for traditional dyno hosting, unlike Vercel/Netlify functions.

### Bull Board memory
Bull Board is fine for ~10 queues. With more, the JS UI gets sluggish. Not a cost concern, but a UX one.

## SaaS comparison: Inngest

**Pricing checked 2026-04-25**: $0 (Hobby, 50k executions/mo) → $25/mo Pro + $50/M extra executions.

### MVP
- 300k executions/mo → $25 + (250k × $0.05/k) = $25 + $12.50 = **~$38/mo**
- Plus all our underlying providers (Resend, Twilio, etc.): ~$25/mo
- **Total: ~$60/mo** (vs Railway $5–10)

### Growth
- 3M executions/mo → $25 + (2.95M × $0.05/k) = $25 + $147 = **~$170/mo**
- Plus providers: ~$50/mo
- **Total: ~$220/mo** (vs Railway $60–120)

### Scale
- 30M executions/mo → $25 + (29.95M × $0.05/k) = $25 + $1497 = **~$1,500/mo**
- Plus providers: ~$400/mo
- **Total: ~$1,900/mo** (vs Railway $300–500)

Inngest is genuinely usable. But 4–5x more expensive at every scale, and you're locked in.

## SaaS comparison: Knock

**Pricing checked 2026-04-25**: $250/mo starter minimum, prepaid messages at $0.005 each.

A "message" = one delivery to one user on one channel. So one `invoice.paid` going to email + in-app + push = 3 messages.

### MVP
- 10k jobs/day × ~2 channels avg = 20k msgs/day = 600k/mo
- Cost: $250 + (350k × $0.005) = $250 + $1,750 = **~$2,000/mo**

### Growth
- 100k jobs/day × 2.5 channels = 250k/day = 7.5M/mo
- Cost: 7.5M × $0.005 = **~$37,500/mo**

### Scale
- 1M jobs/day × 3 channels = 3M/day = 90M/mo
- Cost: **~$450,000/mo**

Knock's pricing model makes the in-app channel — which is essentially free to build ourselves — extremely expensive. Untenable for us.

## SaaS comparison: Trigger.dev

**Pricing checked 2026-04-25**: Free ($5 usage), Hobby $10/mo, Pro $50/mo + per-run.

Their pricing is similar shape to Inngest. Roughly:

### MVP: ~$0–10/mo (within free + Hobby)
### Growth: ~$50–100/mo
### Scale: ~$500–1000/mo

Comparable to Inngest. Both have the lock-in concern.

## SaaS comparison: Novu Cloud

**Pricing checked 2026-04-25**: Free (10k events/mo), Business $250/mo.

### MVP
- 300k events/mo, way over 10k → forced to Business
- Cost: **~$250/mo**

### Growth & Scale
- Custom enterprise pricing (likely $1k+/mo at scale)

Novu Cloud is priced for product-led companies that want to ship a notification system fast. Not us.

### Novu self-hosted
- $0 software cost
- BUT: 6 services to run (API, Worker, WS, Dashboard, MongoDB, Redis)
- Add ~$30–50/mo of Railway resources just to keep Novu running
- Plus: a *new* MongoDB to manage

Novu self-hosted is **more infra than building it ourselves with our existing stack.**

## Resend cost detail

Resend is what we actually pay for outbound email regardless of queue choice.

**Pricing checked 2026-04-25**:
- Free: 3k emails/mo, 100/day cap
- Pro: $20/mo, 50k emails/mo + $0.90/1000 overage
- Scale: $90/mo, 100k emails/mo
- Enterprise: custom

For our scales:
- MVP: free tier sufficient ($0)
- Growth: Pro $20/mo + ~50k emails extra at $45 overage = ~$65/mo (or upgrade to Scale at $90)
- Scale: Scale $90/mo + 1.5M emails extra at $1350 overage = **upgrade to higher tier or move to Postmark/SES**

**At ~50k+ emails/day, evaluate moving to AWS SES** (~$0.10 per 1000 emails = $5 per 50k = $150/mo for 1.5M/mo). 10x cheaper but more setup work.

## Twilio cost detail (SMS, when we add it)

**Pricing checked 2026-04-25**:
- US SMS: $0.0083 per segment + carrier surcharge
- Romania SMS: ~$0.06 per message (Romania is expensive!)
- Phone number: $1/mo (US long code), various for EU

For MotionHive (Romania-focused):
- 100 SMS/day × €0.06 × 30 = €180/mo at growth scale
- 1k SMS/day × €0.06 × 30 = €1,800/mo at scale

**Romania SMS is expensive globally.** Consider:
- **Plivo**: cheaper but still expensive for RO
- **MessageBird/Bird.com**: similar pricing
- **Local Romanian SMS gateway**: research SMSLink, Vodafone Business, Orange Business

For SMS specifically: defer until business case is clear. €1,800/mo at scale is a real number.

## The hybrid recommendation

Don't pay for orchestration. Do pay for delivery.

```
[ MotionHive on Railway ]   ← own the queue + workflows ($)
        ↓
  ┌─────┼─────┬─────┐
  ↓     ↓     ↓     ↓
Resend  web-push  Twilio  In-app
  ↓     ↓     ↓     ↓
($)    ($0)  ($$)  ($0)
```

This is what nearly every well-engineered mid-size SaaS converges on:
- BullMQ for orchestration (free).
- Resend for email (cheap).
- web-push for push (free).
- Twilio for SMS (necessary evil).
- Postgres + WebSocket/SSE for in-app (free, leverages existing infra).

Total: $5–10/mo at MVP, scaling to ~$300–500/mo at 100k MAU.

## Five-year cost scenario (rough)

Assume MotionHive grows MVP → Growth → Scale over 3 years.

### Cumulative cost (jobs + notifications stack only)

| Year | Stage | Monthly | Annual |
|---|---|---|---|
| Y1 H1 | MVP | $10 | $60 |
| Y1 H2 | Late MVP | $30 | $180 |
| Y2 H1 | Growth ramp | $80 | $480 |
| Y2 H2 | Growth | $120 | $720 |
| Y3 H1 | Late growth | $200 | $1,200 |
| Y3 H2 | Early scale | $350 | $2,100 |
| **Total** | **Self-hosted** | | **~$4,740** |

vs. Knock from day 1 at growth/scale rates: **$30k–$1M+ over the same period**. Not even close.

## Decision-tree summary

```
Are we a small team that can run Redis + a worker dyno?
├── Yes → Self-host with BullMQ. ~$5–10/mo. (Us.)
└── No → Inngest/Trigger.dev cloud. ~5x more $.

Do we need a marketing-grade notification UI for non-devs?
├── Yes → Customer.io ($100+/mo) or Knock ($250+/mo)
└── No → DIY workflows in code. (Us.)

Are notifications a competitive product surface?
├── Yes → Maybe Knock for the embedded inbox component
└── No → DIY in-app feed. (Us.)
```

## What would I do different at scale?

If/when MotionHive is at 1M users (this isn't soon):

- Move email to **AWS SES** (10x cheaper than Resend at volume).
- SMS via local Romanian provider (potentially 50% cheaper than Twilio).
- BullMQ stays.
- Add **dedicated worker dynos per queue** (one for media, one for payments).
- Possibly migrate Postgres queue (if any pg-boss work exists) entirely to BullMQ.
- Add a **second Redis** if memory becomes constraint.
- Self-host on dedicated hardware (Hetzner) instead of Railway → another 3–5x cost reduction.

Until then: Railway is the right answer.

## Sources

- [Railway pricing](https://railway.com/pricing)
- [Railway docs pricing plans](https://docs.railway.com/pricing/plans)
- [Resend pricing](https://resend.com/pricing)
- [Inngest pricing](https://www.inngest.com/pricing)
- [Trigger.dev pricing](https://trigger.dev/pricing)
- [Knock pricing](https://knock.app/pricing)
- [Novu pricing](https://novu.co/pricing)
- [Customer.io pricing](https://customer.io/pricing)
- [Twilio SMS pricing comparison 2026](https://www.buildmvpfast.com/api-costs/sms)
- [SMS pricing comparison Plivo vs Twilio](https://www.plivo.com/blog/twilio-alternative-comparison/)
- [Email API pricing comparison 2026](https://www.buildmvpfast.com/api-costs/email)
- [Hatchet pricing](https://hatchet.run/pricing)
- [Temporal cost estimation](https://temporal.io/blog/estimating-the-cost-of-temporal-cloud)
- [Grafana Cloud free tier](https://grafana.com/products/cloud/)
