-- 024_invoice_stripe_id_nullable.sql
--
-- Make invoice.stripe_invoice_id nullable.
--
-- Why: InvoiceService.createOneOff inserts the local row BEFORE the Stripe
-- API call so it can use the local id as a stable idempotency key and so
-- the Stripe network round-trip happens outside any open DB transaction.
-- Until the Stripe call returns, we don't know the Stripe invoice id yet.
--
-- The original schema set stripe_invoice_id to NOT NULL + UNIQUE, and the
-- service inserted an empty string '' as a placeholder. Postgres UNIQUE
-- sees '' as a real value, so the SECOND draft invoice ever created hit
-- a unique-constraint violation and poisoned the transaction.
--
-- Fix: allow NULL. Postgres UNIQUE treats NULLs as distinct, so any number
-- of draft rows can coexist with a NULL placeholder. Once the Stripe call
-- succeeds, the service sets the real id and UNIQUE does its job on real
-- Stripe invoice ids.

ALTER TABLE invoice
  ALTER COLUMN stripe_invoice_id DROP NOT NULL;

-- One-time cleanup: any rows left over with the '' placeholder from the
-- buggy path go to NULL so they match the new convention. These are
-- already VOID status (the service marks them that way when Stripe fails)
-- so no live flow depends on them.
UPDATE invoice
  SET stripe_invoice_id = NULL
  WHERE stripe_invoice_id = '';
