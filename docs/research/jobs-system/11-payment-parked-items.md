# 11 — Payment items parked for the jobs sprint

> Last updated: **2026-04-28**.
>
> Output of the pre-ship Stripe audit. These are the items that depend
> on the jobs/notifications module being built (or that fit naturally
> into its first sprint). Do NOT bundle them into pre-jobs cleanup PRs
> — they need a worker, a queue, or the notification system to be
> meaningfully done.

## How this file fits

Read in order with [00-INDEX.md](./00-INDEX.md):

1. The architecture in files 01–10 explains *what* the jobs system is.
2. This file explains *what specific work is queued* for it from the
   payment audit.

When the jobs sprint starts, this becomes Phase 1 acceptance criteria.

## Status legend

- 🔴 — must ship in jobs sprint Phase 1 (before payment gates open to real users at scale)
- 🟡 — can ship in Phase 2 (during jobs hardening)
- 🟢 — opportunistic, ship when convenient

---

## 🔴 P1 — orphaned webhook reconciliation

**Origin:** audit finding B3.
**State after migration 032:** the documented `webhook_event.status='orphaned'` value is reserved. No code writes it yet — the audit-flagged fix (write `orphaned` instead of returning silently for unmatched `payment_intent.succeeded` / `charge.refunded`) is queued for the immediate next BE PR but the *reconciliation* belongs here.

**What the jobs sprint needs to do:**

1. Cron job (or BullMQ repeatable) every 5 minutes:
   - SELECT unprocessed `webhook_event` WHERE `status='orphaned'` AND `received_at > NOW() - 24h`.
   - For each, retry the matching service handler (the originating local row may have committed by now).
   - On success → flip status to `'processed'`.
   - On still-no-match after 24h → flip to `'failed'` with reason 'orphan_aged_out' AND emit a high-severity alert (Slack? email to platform support?).
2. Operator surface: `/admin/payments/orphans` route returning the current list with filters (type, age, instructor).
3. Daily summary email to platform admin if any orphans were created in the last 24h.

**Why it has to be this sprint:** without reconciliation, money collected by Stripe goes invisible on the platform. Today the only artefact is a Winston `warn` line.

---

## 🔴 P1 — deauthorized Connect: client + per-sub notifications

**Origin:** audit finding B1.
**State after pre-jobs PRs:** the cancel-at-period-end + stripe_account row deletion is shipped. On `account.application.deauthorized` the handler now:
- Calls `cancelAllActiveAtPeriodEndForInstructor` on SubscriptionService — every active/trialing/past_due sub gets `cancel_at_period_end=true` on Stripe (idempotency-keyed) and locally.
- Deletes the local `stripe_account` row so reconnect works cleanly (`getOrCreateAccount` short-circuits on existing rows; deleting frees the path).
- Notifies the instructor via `NotificationService` (logger stub today).

**What the jobs sprint must add:**
1. Per-affected-client notification — `SUBSCRIPTION_CANCELED` notify + email "your subscription was canceled because the trainer disconnected from Stripe" (current copy doesn't cover this case).
2. Email template variant on the existing `STRIPE_ACCOUNT_RESTRICTED` notification (the existing copy is for "account restricted by Stripe", not deauthorization).
3. Optional but recommended: a status banner in the FE for the deauthorized instructor explaining their billing has stopped and how to reconnect.

---

## 🔴 P1 — `payout.failed` notification

**Origin:** audit finding I17.
**Source:** [webhook-handler.service.ts:296-303](../../../src/modules/payment/services/webhook-handler.service.ts#L296)
currently logs and ACK's; no instructor notification.

**Why it has to be this sprint:** `payout.failed` is the most actionable instructor-facing event in the whole Stripe surface. It means money got stuck on its way to their bank. Without a notification, the instructor has no way to know — and Stripe doesn't email instructors directly when the platform is the one that controls their account.

**What to do:**
- In the `payout.failed` handler, call `NotificationService.notify({ userId: instructorId, type: PAYOUT_FAILED, ... })`.
- Email template "your payout failed" with the exact `failure_message` Stripe provided + a link to update bank details via the Stripe Dashboard.

**Note:** `PAYOUT_FAILED` is not yet in the `NotificationType` enum at
[notification.service.ts:9-37](../../../src/modules/notification/notification.service.ts#L9). Add it.

---

## 🔴 P1 — `webhook_event.payload` PII retention purger

**Origin:** audit finding C6 / I8.
**State:** `webhook_event.payload` (JSONB) stores card last4, billing email, name, etc. forever. GDPR Art 5(1)(e) violation — the fiscal-law retention exemption applies to invoices/payments, not to a debug audit log.

**What to do:**
1. Migration: add `webhook_event.payload_purged_at TIMESTAMP NULL`.
2. Cron job (daily): for each row WHERE `received_at < NOW() - 90 days` AND `payload_purged_at IS NULL` AND `status IN ('processed','failed')`:
   - Set `payload = NULL`, set `payload_purged_at = NOW()`.
3. Keep the row itself indefinitely for `stripe_event_id` UNIQUE / replay protection — only the payload bag is purged.
4. Document the 90-day window in `SECURITY_NOTES.md`.

**Open product call:** 90 days vs 180 days. 90 covers the typical
dispute window (60–120 days for cards) plus a safety margin. Pick.

---

## 🔴 P1 — `linkGuestToUser` lifecycle (already wired in pre-jobs PR, but worker watches)

**Origin:** audit finding C7.
**State:** the function exists at [customer.service.ts:145-158](../../../src/modules/payment/services/customer.service.ts#L145) but is never called. The next BE PR wires it into `AuthService.register` and OAuth registration paths.

**What the jobs sprint should add:** a one-time backfill worker that scans existing `stripe_customer` rows with `user_id IS NULL` AND email matching a registered user, and links them. Run once after deploy, then disable.

**Note:** this is interdependent with item 10 (per-Connect scoping). When that lands, the linker has to update all rows for the email, not just one — and only if instructor B doesn't already have a linked customer for that user.

---

## 🟡 P2 — invoice due-soon / overdue / dunning reminders

**Origin:** existing `project_jobs_module_pending.md` memory + CLAUDE.md known-issues.
**Why P2:** quality-of-life for instructors and recovery of late receivables. Not blocking, but high impact.

**Work items:**
- 24h-before-due: reminder email to client.
- 7-days-after-due: reminder email + INVOICE_OVERDUE notification to instructor.
- Dunning: configurable retry schedule on `payment_intent.payment_failed` (today Stripe Smart Retries handles it; we just don't surface it).
- Card-expiring-soon: 30 days out, email client to update payment method.

All four NotificationType enum values exist already (`INVOICE_DUE_SOON`, `INVOICE_OVERDUE`, `PAYMENT_FAILED`).

---

## 🟡 P2 — multi-currency earnings dashboard

**Origin:** audit finding I5.
**Source:** [earnings.service.ts:189-204](../../../src/modules/payment/services/earnings.service.ts#L189) — Stripe balance call assumes single-currency.

**What to do:** when an instructor accepts payments in more than one currency, show all balances. Today the dashboard hides anything that isn't `account.defaultCurrency`. With the jobs system it becomes natural to:
- Cache `balance.retrieve` for 60s in Redis.
- Iterate `available[]` and `pending[]` arrays — they already split by currency.
- Render per-currency rows in the FE.

Not jobs-dependent for the multi-currency display itself, but the
caching layer is, so it slots here.

---

## 🟡 P2 — invoice / refund / subscription email-delivery via queue

**Origin:** existing memory + CLAUDE.md.
**State today:** auth, session, and payment services call `EmailService.sendX()` synchronously inside the request path, blocking response by 200–800ms.

**What to do:** every email send becomes a `notifications` queue job. Failure paths use BullMQ retries. The receipt-side latency disappears.

Affected sites (already enumerated in [00-INDEX.md](./00-INDEX.md) §A):
- Auth: register, password reset, email verification (3 blocking).
- Session: cancellation, deletion fan-out (2 blocking).
- Payment: subscription setup, invoice send-with-override, collaboration-ended (4 blocking).

This is one of the best ROI items in the whole sprint.

---

## 🟡 P2 — auth ownership 403 → 404 sweep

**Origin:** smoke test for migration 032 (this audit) — the assumption was wrong: every payment-service ownership check throws `ForbiddenException` with messages like "You cannot access this invoice." That's an info leak (lets attackers enumerate IDs).

**Affected sites** (grep `ForbiddenException` under
`src/modules/payment/services/`):

- [invoice.service.ts:577,604,1039](../../../src/modules/payment/services/invoice.service.ts#L577)
- [subscription.service.ts:426,517,567](../../../src/modules/payment/services/subscription.service.ts#L426)
- [product.service.ts:309](../../../src/modules/payment/services/product.service.ts#L309)
- [refund.service.ts:42,54](../../../src/modules/payment/services/refund.service.ts#L42)
- [checkout.service.ts:74](../../../src/modules/payment/services/checkout.service.ts#L74)

**What to do:** use `assertOwned(entity, principalId, ..., { policy: 'hide' })` from [src/common/utils/ownership.utils.ts](../../../src/common/utils/ownership.utils.ts) so cross-tenant reads return 404 instead of 403.

**Why P2 not P1:** the JWT guard already enforces "you must be authenticated", and RBAC enforces "you must be an instructor" — so a random outsider can't enumerate at all. The leak is between two authenticated instructors. Real but not catastrophic.

**This is independent of the jobs system** — could be done as a small sweep PR before, alongside, or after the jobs sprint. Slotted here because it came out of the same audit and we need somewhere to track it.

---

## 🟡 P2 — Subscription waiver UX (B2 follow-up)

**Origin:** audit finding C2.
**State after pre-jobs PRs:** the `markPaidOutOfBand` loophole is closed — invoices flagged `requiresImmediateAccessWaiver=true` cannot be marked paid out-of-band without a waiver. Subscription invoices, however, never set the flag (`createInvoiceRowFromSubscription` hardcodes `false` at [invoice.service.ts:1165](../../../src/modules/payment/services/invoice.service.ts#L1165)). So today there is no compliance gap on the subscription path because no subscription invoice triggers the waiver requirement.

**What's queued for later:** if/when product decides "membership programs need an explicit waiver too" (e.g. paid digital coaching content with immediate access), build:

1. `product.requiresImmediateAccessWaiver BOOLEAN` column (per-product flag).
2. `CreateSubscriptionDto.clientWaiverAcknowledged: boolean` field (or a separate "client signs waiver" UX before sub creation — design call).
3. FE: client-attests-via-checkbox flow before subscription create (Option A from the design discussion). The instructor cannot create a subscription whose product requires the waiver without the client's tick.
4. `payment_consent` row written with `subscriptionId` (XOR check + FK + index already exist via migration 032).
5. `createInvoiceRowFromSubscription` propagates `requiresImmediateAccessWaiver` from the parent product onto each renewal invoice.

This is a feature decision, not a bug fix — the BE schema is already ready (migration 032 added `payment_consent.subscription_id` + XOR).

---

## 🟡 P2 — composite index for earnings queries

**Origin:** audit finding I16.
**Source:** [earnings.service.ts:88-93](../../../src/modules/payment/services/earnings.service.ts#L88) +
[019:294-301](../../../migrations/019_create_payment_tables.sql#L294)

**What to do:** add `payment(instructor_id, status, paid_at)` composite index. Today only `(paid_at)` is indexed; the dashboard query filters on all three.

Schema change, not jobs-dependent. Slot here for prioritization.

---

## 🟢 P3 — opportunities

These are low-stakes opportunities surfaced by the audit. Batch into a "polish" PR during the jobs sprint or after.

- **Timestamp types** — every payment column is `TIMESTAMP` not `TIMESTAMPTZ`. Migrate when convenient (no urgency; all servers are UTC).
- **Currency canonicalization** — pick lowercase (Stripe convention) and normalize at every write boundary. Today some sites uppercase locally and lowercase at Stripe call. ([invoice.service.ts:244](../../../src/modules/payment/services/invoice.service.ts#L244) writes uppercase.)
- **`product.currency DEFAULT 'RON'`** — pre-multi-country default. Drop and require explicit currency at insert.
- **`formatAmount` hardcodes 2 decimals** — breaks JPY (zero-decimal). Use `Intl.NumberFormat` with the column's currency. ([invoice.service.ts:776-780](../../../src/modules/payment/services/invoice.service.ts#L776))
- **`paymentMethodType` snapshot reads wrong field** — should read `charge.payment_method_details.type`, not the configured-types array. ([invoice.service.ts:1287-1289](../../../src/modules/payment/services/invoice.service.ts#L1287))
- **`onboardingCompletedAt`** — rename to `firstChargesEnabledAt` for clarity (Stripe can flip charges_enabled later in the lifecycle).
- **No webhook handler for `customer.updated`** — `stripe_customer.default_payment_method_id` goes stale after the client edits their default card in the Stripe Customer Portal. Add a handler.
- **`EarningsService` has no caching** — every dashboard render hits Stripe's API. Cache for 60s once Redis is in.
- **FE in `payments.ts` swallows `getSummary()` errors** — silent failure. Surface to a logger when one is wired.
- **Subscription detail returns full `stripe_*` IDs to FE** — filter to public shape so FE can't accidentally call Stripe directly. ([subscription.service.ts:392-414](../../../src/modules/payment/services/subscription.service.ts#L392))
- **`InvoiceService.list()` FE sends params BE silently strips** — sync the contract: either add `clientId/fromDate/toDate` to BE DTO or remove from FE. ([list-invoices.query.dto.ts](../../../src/modules/payment/dto/list-invoices.query.dto.ts))

---

## What's NOT in this file

These are tracked separately:

- **Item 10 — `stripe_customer` per-Connect scoping.** Its own dedicated sprint; not pre-jobs work and not jobs sprint work. Backfill plan needed.
- **Item 13 — `stripe_customer.user_id` GDPR erasure rework.** Parked — needs holistic GDPR design (memory: `project_gdpr_erasure_pending.md`). Don't touch the FK or related anonymization flow until that design lands.
- **The B2 EU waiver gap** (audit C2/I7) — service code lands in the next pre-jobs PR, not this sprint. Schema is already in place (migration 032).
- **The B5 subscription empty-string UNIQUE bug** — fixed in pre-jobs PR + migration 032.

## Cross-references

- [00-INDEX.md](./00-INDEX.md) — full jobs system research index
- [04-notification-system-architectures.md](./04-notification-system-architectures.md) — notification module design (workflows, channels, providers)
- [08-idempotency-and-reliability.md](./08-idempotency-and-reliability.md) — outbox pattern, dedup, poison-message handling — directly relevant to orphaned-webhook reconciliation
- [10-recommendations-summary.md](./10-recommendations-summary.md) — synthesis + the 3 architecture decisions
- [/PAYMENTS_OVERVIEW.md](../../../PAYMENTS_OVERVIEW.md) — current Stripe Connect surface
- [/SECURITY_NOTES.md](../../../SECURITY_NOTES.md) — security rationale for current decisions

## Source of truth

The full audit ranking (🔴 critical / 🟡 important / 🟢 opportunities / ✅ verified) was produced 2026-04-28 by a deep-dive agent across the BE + FE payment surface. This file extracts only items that depend on the jobs/notifications system. Everything else from that audit ships as pre-jobs PRs.
