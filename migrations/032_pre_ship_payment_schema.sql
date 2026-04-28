-- 032_pre_ship_payment_schema.sql
--
-- Pre-ship Stripe schema fixes — Phase 1 of the payment audit punch list.
-- Schema-only. The corresponding service code changes ship in a follow-up
-- so this migration is safe to apply ahead of code.
--
-- Changes:
--
--   B5 — subscription.stripe_subscription_id: NOT NULL → NULL.
--        Mirrors the fix migration 024 applied to invoice.stripe_invoice_id.
--        SubscriptionService creates the local row before calling Stripe so
--        it can derive the idempotency key from the local id and avoid
--        holding a Postgres connection across the Stripe round-trip. Until
--        the Stripe call returns we don't know the real id, so the service
--        currently writes ''. Postgres UNIQUE treats '' as a real value, so
--        the SECOND in-flight subscription create collides on UNIQUE. The
--        same poison-the-transaction bug invoices used to have. Fix is the
--        same: allow NULL placeholders, the existing UNIQUE on real ids
--        keeps doing its job because Postgres treats NULLs as distinct.
--
--   B2 — payment_consent.invoice_id NOT NULL → NULL, plus a new
--        subscription_id CHAR(36) column and a CHECK that exactly one of
--        them is set.
--
--        Today the table only models one-off-invoice waivers. Subscription
--        activation invoices and direct-charge subscriptions never collect
--        the EU OUG 34/2014 / Directive 2011/83/EU waiver because there is
--        no invoice id at the moment of subscription create. Allowing
--        consent to point at a subscription closes that gap.
--
--        The XOR check enforces "exactly one of (invoice_id, subscription_id)"
--        — a single consent row can only attach to one billable artefact.
--
--   B3 — webhook_event.status documents a new 'orphaned' value.
--        No DDL change needed (status is VARCHAR(20)), but the documented
--        value set is broadened so the dispatcher can flag webhooks that
--        arrive for unknown invoices / charges / subscriptions and a
--        future jobs-system reconciliation worker can pick them up.
--        Documented here so future migrations don't accidentally narrow
--        the column to a CHECK or ENUM that excludes it.
--
-- All statements are idempotent and wrapped in a transaction.

BEGIN;

-- ------------------------------------------------------------
-- B5 — subscription.stripe_subscription_id nullable
-- ------------------------------------------------------------
ALTER TABLE subscription
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;

-- One-time cleanup: any rows with the '' placeholder from the buggy path
-- go to NULL so they match the new convention. These rows never finished
-- the Stripe round-trip; they're either incomplete drafts or orphaned
-- locals that webhook reconciliation never matched up.
UPDATE subscription
   SET stripe_subscription_id = NULL
 WHERE stripe_subscription_id = '';

-- ------------------------------------------------------------
-- B2 — payment_consent: subscription waivers
-- ------------------------------------------------------------
ALTER TABLE payment_consent
  ALTER COLUMN invoice_id DROP NOT NULL;

ALTER TABLE payment_consent
  ADD COLUMN IF NOT EXISTS subscription_id CHAR(36) NULL;

-- FK: same retention semantics as invoice — RESTRICT, since consent is a
-- legal audit record and must outlive any subscription cleanup.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_consent_subscription'
  ) THEN
    ALTER TABLE payment_consent
      ADD CONSTRAINT fk_payment_consent_subscription
      FOREIGN KEY (subscription_id) REFERENCES subscription (id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_consent_subscription_id
  ON payment_consent (subscription_id);

-- XOR: exactly one of (invoice_id, subscription_id) must be set.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_consent_target_xor'
  ) THEN
    ALTER TABLE payment_consent
      ADD CONSTRAINT payment_consent_target_xor
      CHECK (
        (invoice_id IS NOT NULL AND subscription_id IS NULL)
        OR
        (invoice_id IS NULL AND subscription_id IS NOT NULL)
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- B3 — webhook_event.status: documented value 'orphaned'
-- ------------------------------------------------------------
-- No DDL. status remains VARCHAR(20). Application code uses:
--   'processing' | 'processed' | 'failed' | 'orphaned'
-- A column comment documents this so the value set is discoverable.
COMMENT ON COLUMN webhook_event.status IS
  'Lifecycle: processing | processed | failed | orphaned. ''orphaned'' = '
  'event arrived for an entity (invoice / charge / subscription) we have '
  'no local mirror of, typically because the originating API call has not '
  'committed yet OR because the originating call never happened (Stripe-'
  'side activity outside the platform). A reconciliation worker (jobs '
  'sprint) sweeps these.';

COMMIT;
