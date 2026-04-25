# BeeActive Payments & Invoicing — Functionality Overview

## Architecture

Stripe Connect Express powers all money movement. Instructors onboard via Stripe-hosted KYC pages — BeeActive never sees banking info or card data (PCI SAQ A). Platform fee is 0% today, configurable per-instructor via `stripe_account.platform_fee_bps`.

**Module location:** `src/modules/payment/`

---

## Database Tables (8)

| Table | Purpose |
|---|---|
| `stripe_account` | 1 per instructor — Connect Express account mirror |
| `stripe_customer` | 1 per paying user OR guest — platform-level (cards shared across instructors) |
| `product` | Instructor price list items (one-off or subscription), mirrored to Stripe Product+Price |
| `subscription` | Recurring billing mirror — webhook-driven |
| `invoice` | Every invoice (one-off or subscription-generated) with hosted URL + PDF |
| `payment` | PaymentIntent outcomes (supports multiple attempts per invoice) |
| `webhook_event` | Idempotency log — UNIQUE on `stripe_event_id` |
| `payment_consent` | EU consumer rights audit trail — immutable, 5-year retention |

---

## Services (10)

| Service | Responsibility |
|---|---|
| `StripeService` | SDK wrapper, API version pin, startup assertions, `buildFeeParams()`, `buildIdempotencyKey()`, webhook signature verification |
| `WebhookHandlerService` | Single entry point for all webhooks — signature verify, idempotency, transaction-scoped dispatch |
| `ConnectService` | Instructor onboarding lifecycle — create account, Account Link, status, Express Dashboard link, webhook sync |
| `CustomerService` | Lazy create stripe_customer for registered users or guests, guest-to-user linking on registration |
| `ProductService` | CRUD with Stripe Product+Price mirroring, immutable price handling (new Price on amount change) |
| `InvoiceService` | Create one-off invoices, send/finalize, void, mark-paid (out-of-band), webhook sync for invoice.* events |
| `CheckoutService` | Hosted invoice payment URL, SetupIntent for card saving, Customer Portal link, EU waiver consent recording |
| `SubscriptionService` | Create subscriptions with trial support, cancel (immediate or at period end), webhook sync |
| `RefundService` | Full/partial refunds with 14-day window, charge.refunded webhook sync |
| `EarningsService` | Instructor earnings dashboard — totals, MTD, outstanding invoices, payment history |

---

## API Endpoints

### Instructor Endpoints (`@Roles('INSTRUCTOR')`)

#### Onboarding
| Method | Path | Description | Rate Limit |
|---|---|---|---|
| POST | `/payments/onboarding/start` | Create Connect account + return onboarding URL | 5/hr |
| GET | `/payments/onboarding/status` | Get local mirror of Stripe account state | default |
| POST | `/payments/onboarding/dashboard-link` | One-time Express Dashboard login link | 10/hr |

#### Products
| Method | Path | Description | Rate Limit |
|---|---|---|---|
| POST | `/payments/products` | Create product (one-off or subscription) | 30/hr |
| GET | `/payments/products` | List my products (paginated) | default |
| PATCH | `/payments/products/:id` | Update product (name, desc, amount, active) | default |
| DELETE | `/payments/products/:id` | Soft-deactivate product | default |

#### Invoices
| Method | Path | Description | Rate Limit |
|---|---|---|---|
| POST | `/payments/invoices` | Create one-off invoice (registered user or guest email). Leaves it in DRAFT unless `sendImmediately=true`. | 30/hr |
| GET | `/payments/invoices` | List invoices (filterable by status) | default |
| GET | `/payments/invoices/:id` | Invoice detail (includes hosted URL + PDF) | default |
| GET | `/payments/invoices/:id/line-items` | Fetch line items from Stripe on demand (not mirrored locally) | default |
| POST | `/payments/invoices/:id/send` | Finalize (if DRAFT) + email. Routes through Resend when `overrideEmail` differs from on-file email; otherwise Stripe native send. | 30/hr |
| POST | `/payments/invoices/:id/void` | Void (only OPEN/UNCOLLECTIBLE, never PAID) | default |
| POST | `/payments/invoices/:id/mark-paid` | Mark paid out-of-band (cash/bank transfer, no fees) | default |

#### Subscriptions
| Method | Path | Description | Rate Limit |
|---|---|---|---|
| POST | `/payments/subscriptions` | Create subscription for a client | 30/hr |
| GET | `/payments/subscriptions` | List my subscriptions | default |
| POST | `/payments/subscriptions/:id/cancel` | Cancel (default: at period end; `immediate=true` for now) | default |

#### Refunds & Earnings
| Method | Path | Description | Rate Limit |
|---|---|---|---|
| POST | `/payments/refunds` | Refund a payment (full or partial, 14-day window) | 5/hr |
| GET | `/payments/earnings` | Earnings dashboard (total, MTD, outstanding, currency) | default |
| GET | `/payments/payments` | Payment history (paginated) | default |

### Client Endpoints (`@Roles('USER')`)

| Method | Path | Description |
|---|---|---|
| GET | `/payments/my/invoices` | List my invoices (OPEN + PAID only) |
| GET | `/payments/my/invoices/:id` | Invoice detail (includes hosted URL + PDF) |
| GET | `/payments/my/invoices/:id/line-items` | Fetch line items from Stripe on demand |
| POST | `/payments/my/invoices/:id/pay` | Create Checkout session for invoice. Requires `immediateAccessWaiverAccepted` when `invoice.requiresImmediateAccessWaiver=true`. Inserts Payment row before returning URL (race-safe). |
| POST | `/payments/my/setup-intent` | Save a card via Stripe Elements |
| POST | `/payments/my/portal-link` | Open Stripe Customer Portal (manage cards, subs) |
| GET | `/payments/my/subscriptions` | List my subscriptions |
| GET | `/payments/my/counts` | Lightweight `{invoices: {total, open}, memberships: {total, active}}` for profile badges |

### Public Webhook

| Method | Path | Description |
|---|---|---|
| POST | `/webhooks/stripe` | Raw body, signature-verified, idempotent |

---

## Webhook Event Handling

| Stripe Event | Handler | Action |
|---|---|---|
| `account.updated` | ConnectService.syncAccountFromWebhook | Mirror charges_enabled, payouts_enabled, requirements. Notify on ready/restricted |
| `capability.updated` | ConnectService.syncAccountFromWebhook | Re-fetch full account, then same as above |
| `account.application.deauthorized` | ConnectService.handleDeauthorized | Mark disconnected, disable charges, notify |
| `invoice.created/finalized/paid/voided` | InvoiceService.syncFromStripeInvoice | Mirror status, amounts, hosted URL, PDF. Notify on paid |
| `invoice.payment_failed` | InvoiceService.handlePaymentFailed | Sync status, notify client |
| `payment_intent.succeeded/failed` | InvoiceService.syncPaymentFromIntent | Upsert Payment row |
| `customer.subscription.*` | SubscriptionService.syncFromWebhook | Mirror status, period dates, cancel state |
| `charge.refunded` | RefundService.syncRefundFromWebhook | Update refund amounts and status |
| `charge.dispute.created` | Logged only | Stub — future: notify instructor |
| `payout.paid/failed` | Logged only | Stub — future: notify instructor |

---

## Key Business Rules

1. **Cannot issue invoices** until `stripe_account.charges_enabled = true` (enforced in InvoiceService + SubscriptionService)
2. **Cannot void a PAID invoice** — must issue a refund instead
3. **Cannot edit a finalized invoice** — void and recreate
4. **Refund window: 14 days** from original charge (enforced in RefundService)
5. **`application_fee_amount = 0` is REJECTED by Stripe** — the helper OMITS it entirely when fee is 0
6. **Country & currency are driven by the instructor's `user.countryCode`** (46 Stripe Connect countries supported); ConnectService resolves the right currency per country. Platform fee is configurable per instructor via `stripe_account.platform_fee_bps` (default 0).
7. **EU Consumer Rights (OUG 34/2014)**: invoices flagged `requiresImmediateAccessWaiver=true` require the client to accept a cooling-off waiver before payment, logged in `payment_consent`
8. **Subscriptions default to `cancel_at_period_end`** — immediate cancellation is an explicit override
9. **Guest invoicing**: instructors can invoice external emails; if the guest later registers with that email, `CustomerService.linkGuestToUser` connects existing stripe_customer row
10. **Deauthorization**: if instructor revokes OAuth, charges/payouts disabled but active subscriptions NOT auto-canceled (platform-owned)

---

## Notification Types (Payment-Related)

| Type | When | Recipient |
|---|---|---|
| `STRIPE_ACCOUNT_READY` | charges_enabled flips false->true | Instructor |
| `STRIPE_ACCOUNT_RESTRICTED` | disabledReason appears or account deauthorized | Instructor |
| `INVOICE_PAID` | Invoice transitions to paid | Both |
| `PAYMENT_FAILED` | invoice.payment_failed webhook | Client |
| `SUBSCRIPTION_CREATED` | New subscription created | Client |
| `SUBSCRIPTION_CANCELED` | Subscription canceled or scheduled to cancel | Client |
| `REFUND_ISSUED` | Refund processed | Client |

---

## Pending / Future Work

- **Jobs module needed** for: orphaned webhook reconciliation, invoice due-soon reminders, dunning, card expiry reminders, monthly earnings summaries (see `project_jobs_module_pending.md`)
- **e-Factura / EU VAT** integration when instructors invoice businesses
- **Multi-currency / FX** when BeeActive expands beyond Romania
- **Stripe Tax** for automated VAT calculation
- **Payment Links** for share-to-WhatsApp one-time payment URLs
- **Admin overrides** for refund window, force-cancel subscriptions
- **Dispute response** workflow (currently logged only)
