# 04 — Multi-Channel Notification System Architectures

> Research date: **2026-04-25**.
>
> Scope: how to deliver email + web push + in-app + (eventually) SMS to MotionHive users. SaaS options vs self-built. Reference architectures.

## TL;DR

- **Build it ourselves** — the DIY pattern is well-understood, our needs are modest, and the SaaS pricing models punish cost-sensitive teams.
- The reference architecture (Novu's open-source approach) is **6 small concepts**: workflows, subscribers, channels, providers, preferences, and an in-app feed.
- Our existing `NotificationService.notify()` stub is the right entry point; we need to extend it with channel routing + preferences.
- Two SaaS options worth knowing: **Novu Cloud free tier** (10k events/mo) and **Knock developer plan** (per-message at $0.005). Both are escape hatches if DIY becomes too much, neither is right to start with.

## The build-vs-buy decision

### When SaaS makes sense
- You ship to a non-technical team that needs a UI to author messages.
- You need **i18n + localization** out of the box.
- You're a marketing-heavy SaaS where notification flows are a competitive surface.
- You need **deep analytics** (open rates, A/B test variants, click-through funnels).

### When build makes sense (us)
- We're a small dev team; the SaaS UIs help non-devs we don't have.
- Our notifications are **transactional, not marketing** — the templates rarely change.
- We're cost-sensitive; SaaS pricing scales linearly with users in a way self-built doesn't.
- We already have the building blocks: BullMQ for delivery workers, Resend for email, Postgres for state.

For MotionHive: **build.** Estimated effort: 2–3 weeks for a robust v1 (email + in-app + web push), another week to add SMS later.

## Reference: Novu's architecture (open-source canonical)

**Repo**: <https://github.com/novuhq/novu> (~37k stars, MIT-licensed core)
**Docs**: <https://docs.novu.co>

Novu is the reference implementation worth understanding even if we don't deploy it. Their architecture decomposes into:

### 1. Workflow
A named, versioned definition of "what happens when X occurs". E.g. `invoice.paid` workflow → email + in-app + push. Contains steps with delay/digest/conditions.

### 2. Subscriber
A "user" in the notification system. Has a `subscriberId` (we'd use our `user_id`), email, phone, push tokens, locale, timezone.

### 3. Channel
The kind of message: `email`, `sms`, `push`, `in_app`, `chat` (Slack/Discord). Each channel has its own template + provider.

### 4. Provider
The actual delivery service per channel. `email` channel → Resend. `sms` channel → Twilio. `push` channel → web-push (VAPID) or FCM/APNS.

### 5. Preferences
Per-subscriber, per-workflow, per-channel toggles. "User X has muted `daily_summary` on email but kept it on in-app."

### 6. In-app feed
A persistent inbox for in-app notifications, with read/unread state. Powers a bell icon in the UI.

These six concepts are roughly **5 tables + 1 stream consumer**. We can model them in our existing Sequelize stack.

### Novu's runtime topology
```
[ API ]      ← receive trigger events
   ↓ (queue)
[ Worker ]   ← run workflow steps, fan out to channels
   ↓
[ Providers ] ← Resend / Twilio / web-push
[ WS server ] ← realtime in-app feed delivery
```

This is exactly what we'd build. The good news: with NestJS + BullMQ + Postgres + Resend we already have ~70% of it.

## The DIY pattern (recommended for us)

### Schema (5 tables)

```
notification_workflow
  id, key, name, description, default_channels[], active, created_at

notification_template
  id, workflow_id, channel ('email'|'push'|'sms'|'in_app'),
  locale, subject, body_html, body_text, body_markdown, vars_schema (json)

notification (the in-app feed entity)
  id, user_id, workflow_key, title, body, action_url,
  metadata (json), read_at, created_at

user_channel_subscription
  user_id, channel, identifier (email/phone/push_endpoint),
  verified_at, active, created_at
  ── for push: also store p256dh + auth (VAPID keys)

user_notification_preference
  user_id, workflow_key, channel, enabled
  ── unique on (user_id, workflow_key, channel)

notification_delivery (audit/observability)
  id, notification_id, channel, provider, status, provider_message_id,
  attempted_at, delivered_at, failed_at, error
```

### Module API

```ts
// What callers see (NotificationService)
notificationService.notify({
  workflowKey: 'invoice.paid',
  userId,
  data: { invoiceId, amount, currency },
  // Optional overrides
  channels: ['email', 'in_app'],  // skip push for this one
  locale: 'ro',
});

notificationService.notifyMany({
  workflowKey: 'session.reminder',
  userIds: [...],
  data: { sessionId, startsAt },
});
```

### Internal flow

```
1. NotificationService.notify()
   ├─ load workflow (cached)
   ├─ load user prefs + channel subscriptions
   ├─ resolve channels = (workflow.defaults ∪ overrides) ∩ user.enabled
   ├─ render template per (channel, locale)
   ├─ for in_app: insert notification row + emit WS event
   └─ for each remote channel: enqueue notifications.<channel>_send job

2. notifications queue worker
   ├─ email_send → Resend API
   ├─ push_send → web-push library
   ├─ sms_send → Twilio API
   └─ on success: write to notification_delivery
   └─ on failure: BullMQ retries, then DLQ
```

### Template engine
Use **Handlebars** or **MJML + Handlebars** for email. Both are tiny dependencies, Handlebars works for HTML/text/SMS bodies. MJML compiles to email-safe HTML (handles the Gmail/Outlook table-soup nightmare).

For MotionHive v1: just Handlebars. Add MJML when an email looks broken in Outlook.

### Workflow definition: code or DB?

Two valid approaches:

**Code-defined**: workflows live in TypeScript files, version-controlled, deployed with the app. Simpler. No admin UI needed. Recommended for us.

**DB-defined**: workflows live in a table, edited via admin UI. Lets non-devs change templates. Required if you have a marketing team. Not us today.

Recommended: **code-defined workflows + DB-stored templates**. Workflow = "what fires when, on what channels, with what conditions" (code). Template = "the actual subject/body" (DB, editable). Best of both worlds — devs control flow, ops can fix typos.

## SaaS options (for context / escape hatch)

### Novu Cloud / Self-hosted

**Site**: <https://novu.co> · **Pricing**: <https://novu.co/pricing>

**Pros**:
- Open source (MIT) — can self-host the same product.
- Drop-in React `<Inbox>` component for in-app.
- Good template editor.
- Visual workflow builder.

**Cons**:
- **Self-hosted requires 6 services**: API, Worker, WebSocket, Dashboard, MongoDB, Redis. ([Novu deployment](https://railway.com/deploy/novu-notification))
- Cloud free tier: 10k events/mo (last checked 2026-04, may have shifted).
- Adds a new database (MongoDB) we don't run today.
- Significant integration work — we'd push events to Novu, not own the delivery directly.

**Cost (checked 2026-04-25)**:
- Cloud Free: 10k events/mo, 30k subscribers
- Cloud Business: $250/mo
- Self-hosted: $0 + your infra

**Recommendation**: **Don't use yet.** The self-hosted version is more infra than building it ourselves. Cloud free tier works but locks us in.

### Knock

**Site**: <https://knock.app> · **Pricing**: <https://knock.app/pricing>

**Pros**:
- Best-in-class **workflow builder UI**.
- Drop-in React `<NotificationFeed>` component.
- Excellent docs.
- Per-message pricing is honest (no surprise bills).

**Cons**:
- **No free tier for production use** — Developer plan is for dev only.
- Per-message at $0.005 = $5 per 1000 messages. At 10k notifications/day across email + in-app + push = 30k messages/day = $150/day = **$4,500/mo**. Untenable for us at scale.
- Closed source.

**Cost (checked 2026-04-25)**:
- Developer: free for dev environments
- Starter: $250/mo minimum (prepaid usage at $0.005/msg)
- Enterprise: custom

**Recommendation**: **No.** Pricing punishes the high-volume in-app channel where messages are essentially free to send.

### Courier

**Site**: <https://www.courier.com> · **Pricing**: <https://www.courier.com/pricing>

**Pros**:
- Single API for all channels with provider routing.
- Includes preferences / unsubscribe management.
- Good template editor.

**Cons**:
- Per-message pricing similar to Knock.
- We still pay for the underlying providers (Resend, Twilio).
- Lock-in: once templates live in Courier, migrating off is painful.

**Recommendation**: **No.** Same per-message economics as Knock.

### MagicBell

**Site**: <https://magicbell.com>

**Pros**:
- **Drop-in in-app inbox component** is genuinely excellent.
- React/Vue/JS components require almost no code.
- MAU-based pricing might fit better than per-message.

**Cons**:
- Per-MAU pricing: $99/mo for 2k users, $199/mo for 5k users. ([MagicBell pricing](https://www.magicbell.com/pricing))
- Adds a third party for in-app — but in-app is the channel that's *easiest* to build ourselves.
- Still need separate Resend/Twilio for email/SMS.

**Recommendation**: **No.** Pricing kicks in too early; in-app is the channel cheapest to DIY.

### OneSignal

**Site**: <https://onesignal.com>

**Pros**:
- Excellent **push notification infrastructure** (multi-platform).
- Generous free tier for push: unlimited mobile push.
- Email + SMS + in-app on paid tiers.

**Cons**:
- **Marketing-platform DNA**: optimized for broadcasts, not transactional.
- Past privacy controversies (data sharing). Worth checking current posture.
- Lock-in for push subscriptions: tokens are stored in OneSignal, not by you.

**Cost (checked 2026-04-25)**:
- Free: unlimited mobile push, 10k web push
- Growth: $19/mo + per-channel usage
- Pro/Enterprise: custom

**Recommendation**: **Maybe for push-only later.** If we have iOS/Android native apps, OneSignal is the easy answer. For web push, the `web-push` library is fine and cheaper.

### Customer.io

**Site**: <https://customer.io> · **Pricing**: <https://customer.io/pricing>

**Cost**: Essentials starts at $100/mo (5k profiles, 1M emails). Premium at $1k/mo.

**Recommendation**: **No.** Marketing-automation product, not a transactional notification API. Wrong shape for us.

### Resend Broadcasts

**Pros**:
- We already use Resend.
- Broadcasts come "free" with a marketing tier subscription.

**Cons**:
- Email-only.
- Marketing/newsletter-shaped, not transactional fan-out.

**Recommendation**: **Use for newsletters only**, not for transactional notifications. Our `NotificationService` should not depend on Broadcasts.

## Comparison table

| Option | Channels | Free tier | Pricing model | Lock-in | Best for |
|---|---|---|---|---|---|
| **DIY** | All | n/a | $0 + provider costs | None | Us |
| Novu self-hosted | All | $0 | Self-hosted ops | Low (MIT) | Mid-size product team |
| Novu Cloud | All | 10k events/mo | Per event | Medium | Quick start, ok with cloud |
| Knock | All | dev only | $0.005/msg | High | Marketing-driven SaaS |
| Courier | All | 10k msg/mo | Per message | High | Multi-provider routing |
| MagicBell | In-app, email, push | 100 MAU | Per MAU | Medium | Need fast in-app UI |
| OneSignal | Push, email, SMS | Unlimited mobile push | Per channel | Medium | Mobile-app push |
| Customer.io | All marketing | n/a | Per profile | High | Marketing automation |

## The DIY architecture in detail

### Component map

```
┌─────────────────────────────────────────────────────────────┐
│  Domain code (controllers, services, webhook handlers)      │
│  └── notificationService.notify({ workflowKey, userId, data}) │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  NotificationService                                        │
│  ├── workflow registry (in-code)                            │
│  ├── preference resolver (DB)                               │
│  ├── template renderer (Handlebars)                         │
│  └── dispatcher → BullMQ jobs                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  notifications queue (BullMQ)                               │
│  ├── email_send  → ResendProvider                           │
│  ├── push_send   → WebPushProvider                          │
│  ├── sms_send    → TwilioProvider                           │
│  └── in_app_create → DB insert + WS push                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  notification_delivery (audit log)                          │
└─────────────────────────────────────────────────────────────┘
```

### Channel adapter interface

Every channel implements the same contract:

```ts
interface ChannelAdapter<TPayload> {
  channel: NotificationChannel;
  send(payload: TPayload, ctx: ChannelContext): Promise<DeliveryResult>;
  validate?(payload: TPayload): void;  // optional pre-flight check
}
```

This makes it trivial to add a new channel (e.g. Slack, Discord) — write an adapter, register in the channel registry. The dispatcher doesn't need to know what channels exist.

### Workflow definition (TypeScript)

```ts
export const invoicePaidWorkflow: NotificationWorkflow<{
  invoiceId: string;
  amountCents: number;
  currency: string;
}> = {
  key: 'invoice.paid',
  name: 'Invoice paid',
  defaultChannels: ['email', 'in_app'],
  templates: {
    email: { subject: 'Payment received', body: 'invoice-paid.email.hbs' },
    in_app: { title: 'Payment received', body: 'invoice-paid.in-app.hbs' },
  },
  // Optional: dynamic channel resolution
  resolveChannels: ({ data, user }) => {
    // e.g. only push for users with > $X owed
    return ['email', 'in_app'];
  },
};
```

### Preferences resolution
```
final_channels =
   workflow.defaultChannels
   ∩ user_channel_subscription.active
   - user_notification_preference.disabled (per workflow.channel)
```

### In-app realtime delivery
- On `in_app_create` job: insert row → publish to a Redis pub/sub channel `user:${userId}:notifications`.
- WebSocket gateway subscribes to the channel for connected users.
- Disconnected users see the row next time they hit `/notifications`.

See file 06 for full realtime architecture.

## Deployment effort estimate

| Phase | Effort | Includes |
|---|---|---|
| Phase 1: in-app + email | 1.5 weeks | Schema, NotificationService, workflow registry, Handlebars templates, Resend adapter, in-app endpoint |
| Phase 2: web push | 0.5 week | VAPID setup, push subscription endpoint, web-push adapter |
| Phase 3: realtime in-app | 0.5 week | WebSocket gateway, Redis pub/sub fan-out |
| Phase 4: SMS (when needed) | 0.5 week | Twilio adapter, phone verification flow |
| Phase 5: preferences UI | 1 week | Preferences API + frontend toggles |

Total to "production-ready DIY notification system": **~3.5 weeks of focused work**.

For comparison: integrating Novu Cloud or Knock = 1–2 weeks of work, then ongoing $/month forever.

## Recommendation

Build it. The DIY pattern is well-understood, fits our stack, and saves significant ongoing cost. Reference Novu's design but don't deploy Novu.

Three decisions to make in the design:
1. **Code-defined or DB-defined workflows?** → Recommend code. (See workflow section above.)
2. **One queue for all channels or per-channel queue?** → One `notifications` queue with named jobs. Simpler observability.
3. **Realtime in-app: WebSocket or SSE?** → See file 06.

## Sources

- [Novu repo](https://github.com/novuhq/novu)
- [Novu architecture](https://novu.co/blog/inside-the-open-source-novu-notification-engine)
- [Novu Railway deploy template](https://railway.com/deploy/novu-notification)
- [Novu vs Knock vs Courier 2026](https://www.pkgpulse.com/blog/novu-vs-knock-vs-courier-notification-infrastructure-2026)
- [Knock pricing](https://knock.app/pricing)
- [Knock alternatives 2026](https://www.sequenzy.com/alternatives/knock-alternatives)
- [Courier vs MagicBell vs OneSignal](https://www.courier.com/integrations/compare/magicbell-vs-onesignal-push)
- [Top 12 push notification platforms](https://www.courier.com/blog/top-push-notification-platforms)
- [Customer.io pricing](https://customer.io/pricing)
- [Designing a notification system — Tan Nguyen](https://tannguyenit95.medium.com/designing-a-notification-system-1da83ca971bc)
- [Notification service design with diagrams](https://www.pingram.io/blog/notification-service-design-with-architectural-diagrams)
- [Building a notification system — MagicBell blog](https://www.magicbell.com/blog/building-notification-system-ruby-on-rails-database-design)
- [Resend pricing](https://resend.com/pricing)
