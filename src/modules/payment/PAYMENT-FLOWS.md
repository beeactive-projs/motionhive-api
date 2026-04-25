# Payment Flows

This document describes every flow in the Payments & Invoicing feature.
It lives alongside the code so you never have to dig through the plan
file to remember why something works the way it does.

**Companion docs:**
- `/Users/ionutbutnaru/.claude/plans/fluffy-painting-scroll.md` — the approved plan
- `/Users/ionutbutnaru/.claude/plans/fluffy-painting-scroll-frontend.md` — the Angular frontend plan
- `migrations/019_create_payment_tables.sql` — the schema

---

## Glossary

| Term | Meaning |
|---|---|
| **Connect Express account** | A Stripe account owned by an instructor, onboarded via a Stripe-hosted form. BeeActive never sees banking info. |
| **Destination charge** | A charge made on the platform account that routes funds to a connected account. Allows `application_fee_amount`. |
| **Platform fee** | Our cut, in basis points. 0 today (0%). Stored on `stripe_account.platform_fee_bps`. |
| **Hosted Invoice Page** | Stripe-hosted, fully branded invoice page. We iframe it — we never build our own PDF. |
| **Paid out of band** | An invoice marked paid manually (cash / bank transfer). Stripe supports this natively, no fees. |
| **Webhook** | Server-to-server notification from Stripe. We must ack with HTTP 200 in <30s. |
| **Idempotency key** | Deterministic key passed to Stripe on write operations so retries never duplicate. |

---

## Flow 1 — Webhook reception

```
Stripe         BeeActive API              Postgres
  │                 │                        │
  │  POST /webhooks/stripe                   │
  │   (raw body + stripe-signature)          │
  ├────────────────▶│                        │
  │                 │                        │
  │                 │ 1. express.raw preserves Buffer
  │                 │ 2. WebhookHandler.handleIncomingEvent
  │                 │ 3. stripe.webhooks.constructEvent
  │                 │    (signature verify)  │
  │                 │                        │
  │                 │ 4. INSERT webhook_event (stripe_event_id UNIQUE)
  │                 ├───────────────────────▶│
  │                 │◀───────────────────────┤ ok / conflict
  │                 │                        │
  │                 │ 5. dispatchHandler(event) — run in transaction
  │                 │                        │
  │                 │ 6. UPDATE webhook_event status='processed'
  │                 ├───────────────────────▶│
  │                 │                        │
  │  200 { received, duplicate }             │
  │◀────────────────┤                        │
```

**Status codes:**
- `200` — event accepted (new or duplicate or ignored type)
- `400` — signature verification failed (tells Stripe to stop retrying — the secret is wrong or the request is forged)
- `500` — handler threw, Stripe will retry (backoff up to 3 days)

**Security rules:**
1. Raw body MUST be the original Buffer (preserved by `express.raw` in `main.ts`). Re-serializing the JSON breaks the signature.
2. Log `event.id` and `event.type` ONLY. `event.data.object` contains PII.
3. `webhook_event.stripe_event_id` has a UNIQUE index — this is the idempotency point.
4. DB writes go inside the transaction; emails + notifications go AFTER commit.

---

## Flow 2 — Instructor onboarding

```
Browser           API                 Stripe
  │                │                    │
  │ Click "Set up payments"             │
  ├───────────────▶│                    │
  │                │ 1. Create Connect Express account (if new)
  │                ├───────────────────▶│
  │                │◀───────────────────┤ acct_...
  │                │ 2. INSERT stripe_account (charges_enabled=false)
  │                │ 3. Create Account Link
  │                ├───────────────────▶│
  │                │◀───────────────────┤ https://connect.stripe.com/setup/e/...
  │ 200 { url }    │                    │
  │◀───────────────┤                    │
  │                │                    │
  │ Redirect to connect.stripe.com      │
  ├───────────────────────────────────▶│
  │ Fill in ID, IBAN, etc.              │
  │                                     │
  │ Stripe redirects to /instructor/payments/onboarding-complete
  │◀───────────────────────────────────┤
  │                │                    │
  │                │  ┌─ async ─────────┤ account.updated webhook
  │                │◀─┘ charges_enabled=true
  │                │ UPDATE stripe_account
  │                │ Notify instructor: STRIPE_ACCOUNT_READY
```

**Blocked invoice creation:** if `stripe_account.charges_enabled = false`, POST `/payments/invoices` returns 422 with `"Complete payment setup to issue invoices"`.

**Romanian KYC surface notes (show in UI):**
- "Upload BOTH sides of your Carte de Identitate"
- "If you are a PFA, your CUI is required (not your CNP)"
- "IBAN must start with RO and be exactly 24 characters"

---

## Flow 3 — Create a one-off invoice

```
Instructor       API              Stripe           Client
  │               │                 │                │
  │ POST /payments/invoices          │                │
  │ { clientUserId | guestEmail, lineItems, due, sendImmediately? }
  ├──────────────▶│                 │                 │
  │               │ 1. Check charges_enabled          │
  │               │ 2. [TX] Resolve stripe_customer   │
  │               │        - lookup by user_id        │
  │               │        - OR lazy-create (registered)
  │               │        - OR lazy-create (guest, user_id=null)
  │               │    [TX] INSERT invoice (status='draft', stripeInvoiceId=NULL)
  │               │    TX commits — stable local id for idempotency keys
  │               │ 3. Stripe: invoices.create (outside TX)
  │               ├────────────────▶│                 │
  │               │◀────────────────┤ in_...          │
  │               │ 4. Stripe: invoiceItems.create * N
  │               ├────────────────▶│                 │
  │               │ 5. UPDATE invoice.stripeInvoiceId = in_...
  │               │                 │                 │
  │               │ 6. If sendImmediately=true → call sendInvoice() (see below)
  │               │    Else → return DRAFT            │
  │               │                 │                 │
  │ 201 {...}     │                 │                 │
  │◀──────────────┤                 │                 │
```

**Key points:**
- Creation leaves the invoice in `DRAFT`. No finalize, no email. Stripe-hosted URL and PDF don't exist until finalization.
- If Stripe step 3 fails: local row is marked `VOID` (audit trail), never deleted. Reconciliation sweep can identify failed attempts by empty `stripeInvoiceId`.
- Idempotency keys are `invoice:<row.id>:create` and `invoice_item:<row.id>:line_<N>` — deterministic on the local id, safe to retry.

**Picker UX:** instructor can either pick a registered client (autocomplete from `instructor_client` JOIN `user`) or type an external email + name (guest flow).

### Flow 3b — Finalize & send an invoice

```
Instructor       API              Stripe / Resend
  │               │                 │
  │ POST /payments/invoices/:id/send { overrideEmail? }
  ├──────────────▶│                 │
  │               │ 1. Ownership check
  │               │ 2. If DRAFT → Stripe: invoices.finalizeInvoice
  │               │    → sets status='open', generates hosted_invoice_url + invoice_pdf
  │               │ 3. Determine email transport:
  │               │      - overrideEmail differs from on-file? → send via Resend (our transport)
  │               │      - otherwise → Stripe: invoices.sendInvoice (Stripe native send)
  │ 200 {...}     │                 │
  │◀──────────────┤                 │
```

Idempotent: calling on an already-`OPEN` invoice re-emails only (no double-finalize).

---

## Flow 4 — Client pays via Checkout

```
Client           API              Stripe
  │               │                 │
  │ Open invoice detail page        │
  │ Click "Pay now"                 │
  ├──────────────▶│                 │
  │               │ 1. Show waiver checkbox (EU OUG 34/2014) if required
  │               │ 2. Log payment_consent on accept
  │               │ 3. Create Checkout session (mode=payment)
  │               ├────────────────▶│
  │               │◀────────────────┤ cs_...
  │               │ 4. INSERT payment row (status=pending) BEFORE returning
  │               │                 │
  │ 200 { url }   │                 │
  │◀──────────────┤                 │
  │               │                 │
  │ Redirect to checkout.stripe.com │
  ├─────────────────────────────────▶
  │ Enter card, 3DS, submit         │
  │                                 │
  │◀────────────────────────────────┤ redirect to /invoices/:id?success=1
  │               │                 │
  │               │  ┌─ async ──────┤ payment_intent.succeeded
  │               │◀─┘ UPDATE payment status='succeeded'
  │               │    UPDATE invoice status='paid'
  │               │    Notify both: INVOICE_PAID
```

**Race-condition note (critical):** step 4 MUST insert the local `payment` row BEFORE returning the URL to the client. Otherwise the `payment_intent.succeeded` webhook can arrive before the originating API call commits, and the handler has nothing to update → marks event `orphaned`.

---

## Flow 5 — Mark invoice paid out of band

```
Instructor       API              Stripe
  │               │                 │
  │ POST /payments/invoices/:id/mark-paid
  ├──────────────▶│                 │
  │               │ 1. Ownership check
  │               │ 2. Reject if already paid
  │               │ 3. Stripe: invoices.pay({ paid_out_of_band: true })
  │               ├────────────────▶│
  │               │◀────────────────┤ status='paid'
  │               │ 4. UPDATE invoice status='paid', paid_out_of_band=true, paid_at=now()
  │               │ 5. Notify both parties
  │ 200 {...}     │                 │
  │◀──────────────┤                 │
```

No PaymentIntent is created, no fees charged, no card involved.
Instructor is responsible for having received the money out-of-band.

---

## Flow 6 — Subscription lifecycle

Statuses mirrored from Stripe (all 9):
```
trialing → active → past_due → unpaid → canceled
                             ↘
incomplete → incomplete_expired
           → incomplete_payment_failed
paused (not used in v1)
```

**Policies:**
- `proration_behavior = 'none'` — changes at next cycle
- `cancel_at_period_end = true` by default
- `trial_settings.end_behavior.missing_payment_method = 'cancel'`

**Webhooks we handle:**
- `customer.subscription.created/updated/deleted`
- `customer.subscription.trial_will_end`
- `invoice.created/finalized/paid/payment_failed` (subscription invoices flow through the same invoice handlers)

---

## Flow 7 — Refund

```
Instructor       API              Stripe
  │               │                 │
  │ POST /payments/refunds { paymentId, amount?, reason? }
  ├──────────────▶│                 │
  │               │ 1. Ownership check
  │               │ 2. Enforce 14-day window
  │               │ 3. Check instructor balance ≥ refund amount (platform absorbs otherwise)
  │               │ 4. Stripe: refunds.create
  │               ├────────────────▶│
  │               │◀────────────────┤ re_...
  │               │ 5. INSERT/UPDATE payment (status=refunded | partially_refunded)
  │               │ 6. Audit log
  │ 201 {...}     │                 │
  │◀──────────────┤                 │
  │               │                 │
  │               │  ┌─ async ──────┤ charge.refunded webhook
  │               │◀─┘ Confirm state, notify both parties
```

---

## Flow 8 — GDPR erasure / 5-year retention

Romanian Fiscal Code requires payment records to be kept **5 years minimum**. This overrides GDPR right-to-erasure per GDPR Art. 6(1)(c) / Art. 17(3)(b) (legal obligation).

**Erasure flow for a user:**
1. Anonymize PII on `stripe_customer`:
   - `email = '[deleted]@anon'`
   - `name = '[deleted]'`
2. RETAIN `stripe_customer_id` and all `payment` / `invoice` / `subscription` / `payment_consent` rows
3. Call `stripe.customers.del(stripe_customer_id)` — Stripe removes the Customer object's PII server-side but keeps transaction records.
4. Privacy policy must state this exception explicitly.

**GDPR export flow:**
- Extend the existing `/users/me/data-export` endpoint (Sprint 7) to include the user's `invoice`, `payment`, `subscription`, `payment_consent` rows.
- Export contains THEIR records only — not instructor-side aggregates they happen to appear in.

---

## Flow 9 — EU Consumer Rights Directive waiver

Romanian OUG 34/2014 implements EU Directive 2011/83/EU. For digital services that begin immediately on payment, the client has a 14-day cooling-off right UNLESS they explicitly waive it.

**UI requirement:** at every Checkout session where `invoice.requires_immediate_access_waiver = true`, show a mandatory checkbox:

> "Sunt de acord cu accesul imediat la serviciu și renunț la dreptul meu de retragere de 14 zile."
>
> (English: "I consent to immediate access to the service and waive my 14-day right of withdrawal.")

**Audit requirement:** on submit, INSERT a `payment_consent` row with:
- `invoice_id`, `user_id` (nullable for guests)
- `consent_type = 'IMMEDIATE_ACCESS_WAIVER'`
- `consent_text` = exact wording shown (so future text edits don't retroactively change the historical record)
- `ip_address` + `user_agent`
- `given_at` = now

Rows in `payment_consent` are NEVER deleted, including under GDPR erasure.

---

## Stripe event → local handler mapping

| Stripe event | Handler | Local effect |
|---|---|---|
| `account.updated` | ConnectService | Update `stripe_account` flags; notify on ready |
| `account.application.deauthorized` | ConnectService | Mark `disconnectedAt`, notify support |
| `capability.updated` | ConnectService | Update `requirementsCurrentlyDue` |
| `invoice.created` | InvoiceService | INSERT `invoice` (status=draft/open) |
| `invoice.finalized` | InvoiceService | Save `hosted_invoice_url`, `invoice_pdf`; notify |
| `invoice.paid` | InvoiceService | Mark paid, create `payment`, notify |
| `invoice.payment_failed` | InvoiceService | Mark past_due, notify with retry link |
| `invoice.voided` | InvoiceService | Mark voided |
| `customer.subscription.created` | SubscriptionService | INSERT `subscription` |
| `customer.subscription.updated` | SubscriptionService | UPDATE `subscription` |
| `customer.subscription.deleted` | SubscriptionService | Mark `canceled_at` |
| `customer.subscription.trial_will_end` | SubscriptionService | Notify client 3 days out |
| `payment_intent.succeeded` | PaymentService | Upsert `payment` (succeeded) |
| `payment_intent.payment_failed` | PaymentService | Upsert `payment` (failed) |
| `charge.refunded` | PaymentService | Update `payment.amount_refunded_cents` |
| `charge.dispute.created` | DisputeService | Flag + notify instructor |
| `payout.paid` | ConnectService | Optional — notify instructor |
| `payout.failed` | ConnectService | Alert instructor |

**All handlers must be idempotent.** First check `webhook_event.stripe_event_id`; if already seen, short-circuit with 200.

---

## Test card reference

| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0025 0000 3155` | Requires 3DS authentication |
| `4000 0000 0000 0341` | Attaches successfully, fails on charge |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0002` | Generic decline |

Any future expiry (e.g. `12/30`), any CVC (e.g. `123`), any ZIP.

---

## Local development workflow

```bash
# 1. Install Stripe CLI (one-time)
brew install stripe/stripe-cli/stripe
stripe login

# 2. Run migration
npm run migrate

# 3. Start the API
npm run start:dev

# 4. In a second terminal, forward webhooks to local:
stripe listen --forward-to localhost:3000/webhooks/stripe
# Copy the whsec_... secret into .env as STRIPE_WEBHOOK_SECRET

# 5. Trigger a test event:
stripe trigger account.updated
# Should see: webhook_event row with status='processed'
```
