-- 071: let a coach import their client list.
--
-- An import turns each row of a coach's spreadsheet into a normal
-- INSTRUCTOR_TO_CLIENT invitation, so everything after it (signup by
-- token, linking by email, accept, decline, resend) is the flow that
-- already exists. What the spreadsheet carries beyond an email had
-- nowhere to live, and the invite email itself moves to the job queue:
--
--   * invited_first_name,
--     invited_last_name — the name the coach typed. An email-only invite
--                         used to have nothing but the address, so an
--                         imported list showed up as a column of emails.
--                         Also prefills the signup form.
--   * coach_note        — the coach's private note from the sheet ("knee
--                         injury, wants to lose 8 kg"). Copied into
--                         instructor_client.notes when the invite is
--                         accepted; never shown to the client.
--   * email_status      — QUEUED when the invite email is handed to the
--                         queue, SENT when Resend took it, FAILED after
--                         the last retry. NULL for invites sent the old
--                         way, which never tracked it.
--   * imported_at       — set on every invite an import created or sent
--                         again. Marks the row as imported and backs the
--                         per-coach daily sending cap.
--
-- Existing rows were never imported, so NULL is their true value.
--
-- Idempotent: duplicate_object guard on the type, IF NOT EXISTS elsewhere.

BEGIN;

DO $$ BEGIN
  CREATE TYPE enum_client_request_email_status AS ENUM (
    'QUEUED', 'SENT', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE client_request
  ADD COLUMN IF NOT EXISTS invited_first_name VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS invited_last_name VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS coach_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS email_status enum_client_request_email_status NULL,
  -- TIMESTAMP, not TIMESTAMPTZ: matches expires_at / created_at on this
  -- table, which the daily-cap query compares against.
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP NULL;

-- The daily cap counts one coach's imported invites over the last 24 hours.
CREATE INDEX IF NOT EXISTS idx_client_request_imported
  ON client_request (from_user_id, imported_at)
  WHERE imported_at IS NOT NULL;

COMMIT;
