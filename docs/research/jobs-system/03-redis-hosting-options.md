# 03 — Redis Hosting Options for BullMQ

> Research date: **2026-04-25**.
>
> Scope: pick a Redis provider for MotionHive's BullMQ workload. Today we run on Railway. We're cost-sensitive, single-region (EU), and need TCP (not REST) for BullMQ.

## TL;DR

- **Start with Railway's managed Redis addon** ($0–5/mo at our scale, lives next to the API for low latency, one bill).
- **Don't use Upstash for BullMQ** unless you understand what you're signing up for — REST API does not work with BullMQ; their TCP option works but exists in a region/latency configuration that's not great for traditional servers.
- **Redis Cloud free tier (30MB, 30 connections)** is a viable backup if Railway has issues; predictable pricing at scale.
- **Self-hosted Redis on a $5 VPS** is the lowest possible cost but adds an SLA you have to honor.

## The TCP-vs-REST question

This is the load-bearing decision. **BullMQ requires a TCP Redis connection** — it uses `BRPOPLPUSH` and other blocking commands that aren't expressible over HTTP. ([BullMQ Upstash compatibility issue #1087](https://github.com/taskforcesh/bullmq/issues/1087), [Upstash BullMQ docs](https://upstash.com/docs/redis/integrations/bullmq))

This rules out:
- **Upstash REST API** (works with `@upstash/redis`, doesn't work with BullMQ)
- Cloudflare Workers KV / Durable Objects
- Any "serverless Redis" that exposes only HTTP

It still allows:
- **Upstash Redis with TCP endpoint** (yes, they have one)
- Redis Cloud
- Railway / Render / Fly.io managed Redis
- Self-hosted Redis

## Provider comparison

### Railway Redis (managed addon)

**Site**: <https://railway.com> · **Pricing**: <https://railway.com/pricing>

**What you get**: Managed Redis 7.x deployed in your Railway project. Same network as your API (sub-ms latency). Automatic backups depend on plan.

**Pros**:
- **Zero ops**: one click to provision.
- **Same project as API** → no egress charges, low latency.
- **Charged by usage**: small Redis with 256MB RAM ≈ $1–3/mo on Hobby's $5 credit.
- **No vendor switch needed** — already on Railway.

**Cons**:
- **Persistence config is opaque**: AOF/RDB defaults aren't documented as clearly as Redis Cloud.
- **No multi-region replication**.
- **Tied to Railway's overall reliability** (which has had a few rough patches in 2024–2025; check status page).
- **Backups quality varies by plan**.

**Cost (checked 2026-04-25)**:
- Hobby: included in $5/mo credit (typical small workload < $3/mo)
- Pro: $20/mo includes more headroom
- Per resource pricing: ~$0.000231/GB-hr RAM + ~$0.000463/vCPU-hr

A 256MB Redis instance running 24/7 ≈ 0.25 × 730 × 0.000231 ≈ **$0.04/mo for RAM**, plus minimal CPU. Effectively rounding error inside the Hobby credit.

**Recommendation**: **Default choice.** This is what we should use today.

### Redis Cloud (Redis Inc.)

**Site**: <https://redis.io/try-free/> · **Pricing**: <https://redis.io/pricing/>

**What you get**: Managed Redis OSS or Redis Stack from the company that makes Redis. Free 30MB tier with 30 connections.

**Pros**:
- **From the source**: most authoritative ops, fastest patches.
- **Free tier has no command limit** (just data + connection limits).
- **Persistence is configurable** with clear AOF/RDB options.
- **Multi-cloud / multi-region** support if we ever need it.
- **Stable pricing**: predictable monthly bill.

**Cons**:
- **30MB free tier is small** for a busy BullMQ — completed jobs accumulate fast. We must aggressively set `removeOnComplete`/`removeOnFail`.
- **30 connection limit on free tier** — BullMQ uses 3–5 per process, so 1 API + 1 worker process = ~10 connections, fine, but multi-worker hits the cap.
- **Network latency**: cross-cloud latency adds 5–20ms per Redis op vs. same-region Railway.
- **Cold-start fees on Essentials tier** above free.

**Cost (checked 2026-04-25)**:
- Essentials free: $0 (30MB, 30 connections)
- Essentials 250MB: ~$5/mo
- Essentials 1GB: ~$15/mo
- Pro plans scale up; a 5GB cluster is roughly $90/mo.

**Recommendation**: **Backup option** if we ever leave Railway, or if Railway Redis becomes a problem. Free tier is workable for a tiny MVP if we're disciplined about cleanup, but it's tight.

### Upstash Redis (with TCP, NOT REST)

**Site**: <https://upstash.com/> · **Pricing**: <https://upstash.com/pricing/redis>

**What you get**: Serverless Redis with two access modes — REST (over HTTP) and TCP. The product is sold as "pay per request" but the TCP endpoint behaves more like a normal Redis.

**Pros**:
- **Pay-per-command**: $0.20 per 100k commands, **first 500k/month free**.
- **No idle cost**: dormant project = $0.
- **Generous free tier** (500k commands + 200GB bandwidth/mo as of 2025 update).
- **Global replication** available.

**Cons**:
- **TCP mode lacks the serverless cost benefit**: if you keep connections open (which BullMQ does), you're paying the same shape of cost as managed Redis but with worse latency. The whole "serverless" pitch evaporates.
- **BullMQ's blocking commands consume commands continuously** — not a great fit for per-command pricing. Workers calling `BRPOPLPUSH` rack up commands constantly even when idle.
- **Latency varies by region**: if the Upstash region isn't co-located with our Railway region, expect 30–80ms RTT.
- **REST API does not work with BullMQ** (worth repeating).
- **Connection pooling for traditional servers is suboptimal** vs. their REST API.

**Cost (checked 2026-04-25)**:
- Free: 500k commands/mo, 200GB bandwidth, 256MB DB size
- Pay-as-you-go: $0.20 / 100k commands
- Regional + global tiers available

**Real-world cost estimate for BullMQ**: a single worker doing `BRPOPLPUSH` blocking calls every 5s = ~17k commands/day = 510k/mo from idle alone. We hit free tier ceiling on **idle workers**. This is a poor fit.

**Recommendation**: **Avoid for BullMQ.** Upstash is excellent for caching, rate limiting, session storage in serverless contexts. It's a poor fit for a continuously-polling job queue.

### Render Redis (managed)

**Site**: <https://render.com> · **Pricing**: <https://render.com/pricing>

**What you get**: Managed Redis on Render's infrastructure. Free tier with 25MB, paid starts at ~$10/mo for 256MB.

**Pros**:
- **Predictable pricing**: fixed monthly cost.
- **Same-region as Render-deployed apps** → low latency.
- **25MB free tier** (smaller than Redis Cloud's 30MB).

**Cons**:
- **Free tier evicts on idle**: services spin down after 15 min of inactivity. Fine for caches, **bad for BullMQ** because waking it adds 30–60s cold start.
- **Only useful if our API is on Render** (which it isn't — we're on Railway).

**Recommendation**: **Skip** unless we move the API to Render.

### Fly.io Redis (Upstash partnership)

Fly.io's "managed Redis" is actually Upstash under the hood. Same caveats as Upstash above.

**Recommendation**: **Skip** for BullMQ.

### Self-hosted Redis on a VPS

**Options**: Hetzner Cloud (€4.51/mo for CPX11, 2 vCPU + 2GB RAM), DigitalOcean ($4/mo droplet), Vultr ($2.50/mo).

**Pros**:
- **Cheapest at scale**: a $4.51/mo Hetzner box handles way more than Railway/Redis Cloud.
- **Full control** over persistence, eviction, version.
- **No vendor lock-in**.

**Cons**:
- **You're on call for it**: backups, patches, monitoring, OOM resolution.
- **Network latency**: Hetzner Falkenstein → Railway is 30–60ms RTT (Railway hosts in Europe-west via GCP — region-dependent).
- **Time tax**: estimated 2–4 hours/month of attention (security updates, backup verification, log review).
- **No managed UI** — `redis-cli` only.
- **Setup time**: ~2 hours to do well (TLS, AUTH, AOF, daily backup cron, monitoring).

**Cost (checked 2026-04-25)**:
- Hetzner CPX11: €4.51/mo (~$4.90)
- DigitalOcean basic droplet: $4/mo
- + your time

**Recommendation**: **Defer.** At our scale the savings (saving maybe $5/mo vs Railway's addon) don't justify the ops burden. Revisit at $50+/mo of Redis spend.

## Latency comparison (estimates)

For a BullMQ worker calling Redis from Railway (typical EU region), one-way latency to:

| Provider | Same Railway region | Cross-cloud (typical) |
|---|---|---|
| Railway addon | < 1ms | n/a |
| Redis Cloud (same region) | n/a | 5–15ms |
| Upstash global | n/a | 20–80ms |
| Self-hosted Hetzner | n/a | 20–40ms |

For BullMQ throughput: every job dispatch involves several round-trips. At 5ms RTT vs <1ms, throughput drops ~3–5x. Not catastrophic, but a real consideration.

## Persistence guarantees

BullMQ stores all job state in Redis. **If Redis loses memory, in-flight jobs are gone.** This is why persistence matters.

| Provider | Default persistence | Configurable |
|---|---|---|
| Railway addon | RDB snapshots | Limited |
| Redis Cloud | AOF + RDB | Yes (per-tier) |
| Upstash | AOF | No |
| Self-hosted | Whatever you configure | Full |

**Recommendation**: enable AOF (append-only file) wherever it's an option. Idempotency keys (file 08) cover the rest — but persistence is the first line of defense.

## BullMQ-specific Redis requirements

- **Redis 6.2.0+** required (BullMQ uses some recent commands).
- **Redis Cluster mode**: BullMQ works on Cluster but with caveats — all queue keys must hash to the same slot (use hash tags like `{queue-name}`). For our scale, **don't use Cluster**.
- **Memory eviction policy**: must be `noeviction` or `volatile-*`. **Never use `allkeys-lru`** — BullMQ doesn't expect keys to disappear, you'll lose jobs silently.
- **Sentinel / Replication**: BullMQ supports Redis Sentinel for HA. Overkill for v1.

Verify on whatever provider we choose:
```bash
redis-cli CONFIG GET maxmemory-policy
# Want: noeviction (or volatile-lru if you set TTLs explicitly)
```

## Migration path

Year 0 (MVP): **Railway Redis addon**. ~$1/mo inside our Hobby credit.

Year 1 (scale): if Railway Redis becomes a bottleneck or we need more reliability:
- **Redis Cloud Essentials 250MB** ($5/mo) — easy migration, just change connection string.
- **Self-hosted Hetzner with daily backups to S3/R2** — only if we're willing to own ops.

Year 2+ (serious scale): Redis Cloud Pro (HA, multi-zone) or DragonflyDB managed.

## Cost summary table

| Provider | MVP cost | Growth cost (~10k jobs/day) | Scale cost (~1M jobs/day) | Best for us? |
|---|---|---|---|---|
| Railway addon | ~$1/mo | ~$5/mo | ~$30/mo | ✅ default |
| Redis Cloud free | $0 | tight on size | n/a | ✅ backup |
| Redis Cloud paid | $5/mo (250MB) | $15/mo (1GB) | $90/mo (5GB) | ✅ alternative |
| Upstash | $0 | ~$10/mo | ~$200/mo+ | ❌ wrong shape |
| Render | $10/mo (paid) | $25/mo | $50+/mo | ❌ wrong cloud |
| Self-hosted | $5/mo | $5/mo | $20/mo | ⚠️ ops burden |

## Recommendation for MotionHive

1. **Today**: Railway Redis addon. Provision in the Railway dashboard, add to `.env`, done.
2. **If Railway Redis disappoints**: Redis Cloud Essentials 250MB ($5/mo).
3. **Never** use Upstash for BullMQ.
4. **Eventually** consider self-hosted Hetzner only after we're spending $20+/mo on Redis.

Configure on day 1:
- `maxmemory-policy: noeviction`
- AOF persistence enabled (where configurable)
- Daily snapshot backup retention (Railway/Cloud handle this)
- BullMQ connection: `maxRetriesPerRequest: null`, `enableReadyCheck: false`

## Sources

- [BullMQ Upstash compatibility issue](https://github.com/taskforcesh/bullmq/issues/1087)
- [Upstash BullMQ integration docs](https://upstash.com/docs/redis/integrations/bullmq)
- [Upstash pricing](https://upstash.com/pricing/redis)
- [Upstash vs Redis Cloud comparison](https://www.buildmvpfast.com/compare/upstash-vs-redis-cloud)
- [Switching from Upstash to Redis Cloud — Michael Evans](https://michaelrevans.me/blog/switching-from-upstash-to-redis-cloud/)
- [Railway pricing](https://railway.com/pricing)
- [Railway docs — pricing plans](https://docs.railway.com/pricing/plans)
- [Render Redis docs](https://render.com/docs/redis)
- [5 Cheap Ways to Host Redis — DEV](https://dev.to/code42cate/5-cheap-ways-to-host-redis-2njm)
- [Hosting Free Tier Comparison 2026](https://agentdeals.dev/hosting-free-tier-comparison-2026)
- [Render vs Railway 2026](https://render.com/articles/render-vs-railway)
- [Northflank Railway vs Render comparison](https://northflank.com/blog/railway-vs-render)
- [Hetzner Cloud pricing](https://www.hetzner.com/cloud)
- [BullMQ architecture docs](https://docs.bullmq.io/guide/architecture)
