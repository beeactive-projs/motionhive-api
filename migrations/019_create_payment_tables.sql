-- ============================================================
-- Migration 019: Payments & Invoicing (Stripe Connect)
-- ============================================================
-- Creates all local mirror tables for Stripe resources used by
-- the Payments feature. Stripe remains the source of truth; these
-- tables exist so reads are instant and so we can run filters /
-- aggregations in SQL without round-tripping to Stripe's API.
--
-- Tables created (9 total):
--   1. stripe_account      — one per instructor (Connect Express)
--   2. stripe_customer     — one per paying user OR external guest
--   3. product             — instructor's reusable price list
--   4. subscription        — active recurring billing
--   5. invoice             — every invoice (one-off OR from subscription)
--   6. payment             — PaymentIntent outcomes (one invoice can
--                            have multiple attempts: fail → retry → ok)
--   7. webhook_event       — idempotency log: Stripe retries webhooks
--                            and we must process each event exactly once
--   8. payment_consent     — EU Consumer Rights Directive audit log
--                            (Romanian OUG 34/2014 — mandatory waiver of
--                            14-day cooling-off period at checkout)
--
-- Conventions (match existing migrations):
--   - PK: CHAR(36) with gen_random_uuid()::TEXT default
--   - Status columns are VARCHAR (app-level enum validation), NOT
--     PostgreSQL native ENUM types (see 007_create_client_tables.sql)
--   - Timestamps: TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
--   - All CREATE statements use IF NOT EXISTS
--   - Index naming: idx_<table>_<column>
-- ============================================================

-- ------------------------------------------------------------
-- 1. stripe_account — one Connect Express account per instructor
-- ------------------------------------------------------------
-- Why: lets us answer "is this instructor ready to receive money?"
-- in a single indexed query without calling Stripe on every render
-- of the instructor dashboard. Updated by webhooks on account.updated.
-- platform_fee_bps defaults to 0 (no commission today); switching to
-- 100 (1%) per instructor is a data change, not a code change.
CREATE TABLE IF NOT EXISTS stripe_account (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  user_id CHAR(36) NOT NULL,
  stripe_account_id VARCHAR(255) NOT NULL,
  charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  country VARCHAR(2),
  default_currency VARCHAR(3),
  platform_fee_bps INTEGER NOT NULL DEFAULT 0,
  disabled_reason VARCHAR(255),
  requirements_currently_due JSONB,
  onboarding_completed_at TIMESTAMP,
  disconnected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_stripe_account_user FOREIGN KEY (user_id)
    REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_account_user_id
  ON stripe_account (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_account_stripe_id
  ON stripe_account (stripe_account_id);
CREATE INDEX IF NOT EXISTS idx_stripe_account_charges_enabled
  ON stripe_account (charges_enabled);

-- ------------------------------------------------------------
-- 2. stripe_customer — paying user (registered OR external guest)
-- ------------------------------------------------------------
-- Why: one row per BeeActive user so saved cards are reused across
-- instructors. user_id is NULLABLE so an instructor can invoice a
-- walk-in / friend-of-a-friend by email only. If that guest later
-- registers with the same email, the registration flow links their
-- new user_id onto this row (see customer.service.ts#linkGuestToUser).
CREATE TABLE IF NOT EXISTS stripe_customer (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  user_id CHAR(36),
  stripe_customer_id VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  default_payment_method_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- SET NULL on delete: we retain the stripe_customer row for its
  -- 5-year fiscal retention window even if the user is erased. PII
  -- on this row is anonymized separately by the GDPR erasure flow.
  CONSTRAINT fk_stripe_customer_user FOREIGN KEY (user_id)
    REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_customer_stripe_id
  ON stripe_customer (stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_customer_user_id
  ON stripe_customer (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_customer_email
  ON stripe_customer (email);

-- ------------------------------------------------------------
-- 3. product — instructor's reusable price list
-- ------------------------------------------------------------
-- Why: instructors define "10-pack €400" once and reuse it on many
-- invoices. type = ONE_OFF or SUBSCRIPTION. For subscriptions, the
-- interval / interval_count columns are required.
-- Money is stored in the SMALLEST CURRENCY UNIT (cents / bani) to
-- avoid float rounding. €10.50 → amount_cents = 1050, currency = EUR.
CREATE TABLE IF NOT EXISTS product (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  instructor_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL,  -- ONE_OFF | SUBSCRIPTION
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'RON',
  interval VARCHAR(10),             -- day | week | month | year
  interval_count INTEGER,           -- e.g. every 2 months → 2
  stripe_product_id VARCHAR(255),
  stripe_price_id VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_product_instructor FOREIGN KEY (instructor_id)
    REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_instructor_id
  ON product (instructor_id);
CREATE INDEX IF NOT EXISTS idx_product_type
  ON product (type);
CREATE INDEX IF NOT EXISTS idx_product_is_active
  ON product (is_active);

-- ------------------------------------------------------------
-- 4. subscription — active recurring billing
-- ------------------------------------------------------------
-- Why: powers "My Subscriptions" UI without calling Stripe on every
-- page load. Always webhook-driven; never poll Stripe.
-- status values map 1:1 with Stripe subscription statuses:
--   trialing | active | past_due | canceled | unpaid |
--   incomplete | incomplete_expired | paused |
--   incomplete_payment_failed
CREATE TABLE IF NOT EXISTS subscription (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  instructor_id CHAR(36) NOT NULL,
  client_id CHAR(36),               -- NULL if guest (user_id is NULL on stripe_customer)
  stripe_customer_id VARCHAR(255) NOT NULL,
  product_id CHAR(36),              -- NULL if ad-hoc subscription w/o our product row
  stripe_subscription_id VARCHAR(255) NOT NULL,
  stripe_price_id VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at TIMESTAMP,
  canceled_at TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  trial_start TIMESTAMP,
  trial_end TIMESTAMP,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_subscription_instructor FOREIGN KEY (instructor_id)
    REFERENCES "user" (id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_client FOREIGN KEY (client_id)
    REFERENCES "user" (id) ON DELETE SET NULL,
  -- RESTRICT on product delete: a soft-deactivated product (is_active
  -- = false) must still resolve for historical subscriptions. Hard
  -- delete is blocked to prevent orphaned billing rows.
  CONSTRAINT fk_subscription_product FOREIGN KEY (product_id)
    REFERENCES product (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_stripe_id
  ON subscription (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_instructor_id
  ON subscription (instructor_id);
CREATE INDEX IF NOT EXISTS idx_subscription_client_id
  ON subscription (client_id);
CREATE INDEX IF NOT EXISTS idx_subscription_status
  ON subscription (status);

-- ------------------------------------------------------------
-- 5. invoice — every invoice we know about
-- ------------------------------------------------------------
-- Why: one row per Stripe invoice. Includes subscription-generated
-- invoices (subscription_id set) AND one-off invoices (NULL).
-- hosted_invoice_url / invoice_pdf come straight from Stripe and are
-- what we iframe/link from the UI — we do NOT generate our own PDF.
--
-- paid_out_of_band: TRUE when the instructor marked the invoice paid
-- manually (cash / bank transfer). Stripe's API supports this natively
-- via `pay` with `paid_out_of_band=true` — no fees, invoice flips to
-- paid, no PaymentIntent created.
--
-- requires_immediate_access_waiver + waiver_accepted_at: Romanian EU
-- Consumer Rights Directive (OUG 34/2014). If TRUE, client must tick
-- the waiver checkbox at checkout and the consent is logged in
-- payment_consent.
CREATE TABLE IF NOT EXISTS invoice (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  instructor_id CHAR(36) NOT NULL,
  client_id CHAR(36),               -- NULL if guest
  stripe_customer_id VARCHAR(255) NOT NULL,
  subscription_id CHAR(36),         -- NULL for one-off invoices
  stripe_invoice_id VARCHAR(255) NOT NULL,
  number VARCHAR(100),              -- Stripe-assigned invoice number
  status VARCHAR(30) NOT NULL,      -- draft | open | paid | void | uncollectible
  amount_due_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  amount_remaining_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL,
  application_fee_cents INTEGER NOT NULL DEFAULT 0,
  due_date TIMESTAMP,
  finalized_at TIMESTAMP,
  paid_at TIMESTAMP,
  voided_at TIMESTAMP,
  hosted_invoice_url TEXT,
  invoice_pdf TEXT,
  paid_out_of_band BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  metadata JSONB,
  requires_immediate_access_waiver BOOLEAN NOT NULL DEFAULT FALSE,
  waiver_accepted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- RESTRICT on instructor delete: fiscal law requires 5-year retention
  -- of invoices, so we cannot cascade-delete them with the user. The
  -- GDPR erasure flow anonymizes PII but keeps the row.
  CONSTRAINT fk_invoice_instructor FOREIGN KEY (instructor_id)
    REFERENCES "user" (id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoice_client FOREIGN KEY (client_id)
    REFERENCES "user" (id) ON DELETE SET NULL,
  CONSTRAINT fk_invoice_subscription FOREIGN KEY (subscription_id)
    REFERENCES subscription (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_stripe_id
  ON invoice (stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_instructor_id
  ON invoice (instructor_id);
CREATE INDEX IF NOT EXISTS idx_invoice_client_id
  ON invoice (client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_subscription_id
  ON invoice (subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoice_status
  ON invoice (status);
CREATE INDEX IF NOT EXISTS idx_invoice_created_at
  ON invoice (created_at);

-- ------------------------------------------------------------
-- 6. payment — PaymentIntent outcomes
-- ------------------------------------------------------------
-- Why: one invoice can have many payment attempts (failed → retried
-- → succeeded). Earnings dashboard aggregates from this table.
-- status values: pending | succeeded | failed | refunded | partially_refunded
CREATE TABLE IF NOT EXISTS payment (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  invoice_id CHAR(36),              -- NULL if direct charge without invoice
  instructor_id CHAR(36) NOT NULL,
  client_id CHAR(36),               -- NULL if guest
  stripe_payment_intent_id VARCHAR(255) NOT NULL,
  stripe_charge_id VARCHAR(255),
  amount_cents INTEGER NOT NULL,
  amount_refunded_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL,
  application_fee_cents INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  payment_method_type VARCHAR(50),  -- card | sepa_debit | ...
  failure_code VARCHAR(100),
  failure_message TEXT,
  paid_at TIMESTAMP,
  refunded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_payment_invoice FOREIGN KEY (invoice_id)
    REFERENCES invoice (id) ON DELETE SET NULL,
  -- RESTRICT: earnings history must survive user deletion (fiscal law).
  CONSTRAINT fk_payment_instructor FOREIGN KEY (instructor_id)
    REFERENCES "user" (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_client FOREIGN KEY (client_id)
    REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_stripe_intent_id
  ON payment (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoice_id
  ON payment (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_instructor_id
  ON payment (instructor_id);
CREATE INDEX IF NOT EXISTS idx_payment_client_id
  ON payment (client_id);
CREATE INDEX IF NOT EXISTS idx_payment_status
  ON payment (status);
CREATE INDEX IF NOT EXISTS idx_payment_paid_at
  ON payment (paid_at);

-- ------------------------------------------------------------
-- 7. webhook_event — idempotency log
-- ------------------------------------------------------------
-- Why: Stripe retries webhook deliveries aggressively (up to 3 days).
-- Without a dedup log we would double-process events and e.g. send
-- "invoice paid" notifications twice.
--
-- Flow:
--   1. Webhook arrives
--   2. Verify signature
--   3. INSERT INTO webhook_event (stripe_event_id, type, payload, status='processing')
--      — if insert conflicts on stripe_event_id UNIQUE, another
--        handler already ran it, return 200 immediately
--   4. Run the handler inside a transaction
--   5. On success: UPDATE webhook_event SET status='processed', processed_at=NOW()
--   6. On failure: UPDATE webhook_event SET status='failed', error=<msg>
--
-- Note: payload is stored for debugging ONLY and MUST NOT be logged
-- to stdout/Winston — it contains PII (name, email, last4).
CREATE TABLE IF NOT EXISTS webhook_event (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  stripe_event_id VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  api_version VARCHAR(20),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'processing',
  error TEXT,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_stripe_event_id
  ON webhook_event (stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_event_type
  ON webhook_event (type);
CREATE INDEX IF NOT EXISTS idx_webhook_event_status
  ON webhook_event (status);
CREATE INDEX IF NOT EXISTS idx_webhook_event_received_at
  ON webhook_event (received_at);

-- ------------------------------------------------------------
-- 8. payment_consent — EU Consumer Rights Directive audit log
-- ------------------------------------------------------------
-- Why: Romanian OUG 34/2014 implements EU Directive 2011/83/EU. For
-- digital services with immediate access, the consumer has a 14-day
-- cooling-off right UNLESS they explicitly waive it. We must show the
-- waiver text at checkout AND keep an auditable log of the consent
-- (timestamp + IP + user_agent + exact text shown).
-- Never deleted — even under GDPR erasure requests (legal obligation
-- override, GDPR Art. 6(1)(c) / Art. 17(3)(b)).
CREATE TABLE IF NOT EXISTS payment_consent (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  invoice_id CHAR(36) NOT NULL,
  user_id CHAR(36),                 -- NULL if guest
  consent_type VARCHAR(50) NOT NULL,  -- e.g. IMMEDIATE_ACCESS_WAIVER
  consent_text TEXT NOT NULL,       -- exact wording shown at the time
  ip_address VARCHAR(45),           -- IPv6 safe
  user_agent TEXT,
  given_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- RESTRICT on invoice delete: consent is a legal audit record and
  -- must outlive any invoice row cleanup.
  CONSTRAINT fk_payment_consent_invoice FOREIGN KEY (invoice_id)
    REFERENCES invoice (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_consent_user FOREIGN KEY (user_id)
    REFERENCES "user" (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_consent_invoice_id
  ON payment_consent (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_consent_user_id
  ON payment_consent (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_consent_given_at
  ON payment_consent (given_at);
