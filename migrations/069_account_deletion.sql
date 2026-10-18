-- =============================================================================
-- 069 — account deletion: the request, its cooling-off, and the record we keep
-- =============================================================================
--
-- Why: Apple requires apps that create accounts to let people delete them in
-- the app (App Review 5.1.1(v)), and the published policy (website,
-- /legal/delete-account) promises deactivation within 72 hours, erasure within
-- 30 days, and a record that the account was deleted, kept for 3 years.
--
-- The old DELETE /users/me only soft-deleted the user row: no proof it was
-- the owner, nothing wound down (subscriptions kept billing, recurring
-- sessions kept generating), and every piece of personal data stayed.
--
-- One row here carries one deletion through its life:
--   PENDING_CODE  a code was emailed to the account address
--   SCHEDULED     the code was confirmed: the account is deactivated and will
--                 be erased at `scheduled_for` (29 to 30 days later) unless the
--                 person signs in and keeps it
--   CANCELLED     they signed in and kept the account
--   ERASED        the erasure ran; the row stays as the deletion record
--
-- The user row itself is never hard-deleted: posts, invoices, programs and
-- admin logs hold RESTRICT / NO ACTION keys to it. Erasure scrubs its personal
-- columns instead and keeps the id as an opaque key, so `user_id` here stays
-- valid for the life of the record.
--
-- Conventions: CHAR(36) PK with gen_random_uuid()::TEXT, snake_case
-- (underscored ORM). Times are TIMESTAMPTZ, as in the messaging tables: the
-- code expiry is compared in the app, and a plain TIMESTAMP read on a
-- machine outside UTC comes back shifted by its offset.
-- =============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE account_deletion_status AS ENUM (
    'PENDING_CODE', 'SCHEDULED', 'CANCELLED', 'ERASED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS account_deletion (
  id CHAR(36) NOT NULL DEFAULT gen_random_uuid()::TEXT,
  user_id CHAR(36) NOT NULL,
  status account_deletion_status NOT NULL DEFAULT 'PENDING_CODE',
  -- HMAC-SHA256 (hex) of the emailed 6-digit code, keyed with the app
  -- secret: a leaked table cannot be brute-forced offline. Cleared once
  -- confirmed.
  code_hash VARCHAR(64),
  code_expires_at TIMESTAMPTZ,
  code_attempts SMALLINT NOT NULL DEFAULT 0,
  -- When the code was confirmed and the account deactivated.
  requested_at TIMESTAMPTZ,
  -- When the erasure runs: the first daily run at least 29 days after
  -- requested_at, so always within the 30 days the policy promises.
  scheduled_for TIMESTAMPTZ,
  -- When everything involving other people finished winding down
  -- (subscriptions, sessions, groups, clients). NULL while a step still
  -- needs a retry; the daily sweep picks those up.
  wound_down_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  erased_at TIMESTAMPTZ,
  -- The language the person used, for the emails after their account is gone.
  locale VARCHAR(5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Never hard-deleted (see header); RESTRICT makes an accident loud.
  CONSTRAINT fk_account_deletion_user FOREIGN KEY (user_id)
    REFERENCES "user" (id) ON DELETE RESTRICT,
  CONSTRAINT chk_account_deletion_scheduled_dates CHECK (
    status IN ('PENDING_CODE')
    OR (requested_at IS NOT NULL AND scheduled_for IS NOT NULL)
  )
);

-- At most one open deletion per person.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_open
  ON account_deletion (user_id)
  WHERE status IN ('PENDING_CODE', 'SCHEDULED');

-- The daily erasure sweep reads due rows only.
CREATE INDEX IF NOT EXISTS idx_account_deletion_due
  ON account_deletion (scheduled_for)
  WHERE status = 'SCHEDULED';

COMMIT;
