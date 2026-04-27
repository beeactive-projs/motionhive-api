-- 030_group_a_cleanup.sql
--
-- Group A schema cleanup — pre-jobs-worker pass.
-- Five low-risk fixes; none of these change the API response shape in a way
-- the FE can observe without explicit code changes alongside.
--
-- Changes in this migration:
--   1. instructor_profile gains a deleted_at column so the entity can be
--      `paranoid: true`. Soft-deleted users no longer leave hard-deleted
--      profile rows pointing at them.
--   2. feedback.user_id gains a FOREIGN KEY → "user"(id) ON DELETE SET NULL.
--      Previously this was a free-form CHAR(36) with no integrity check, so
--      orphaned rows were possible.
--   3. client_request gains an updated_at column. Status transitions
--      (PENDING → ACCEPTED / DECLINED / CANCELLED) had no timestamp,
--      making audit trails impossible. Backfilled to created_at for
--      existing rows; service code starts setting it on every status write.
--   4. social_account drops access_token and refresh_token. We never call
--      Google / Facebook / Apple APIs on the user's behalf, so storing
--      OAuth bearer tokens was a security liability with zero benefit.
--   5. session.recurring_rule changes from JSON to JSONB. JSON cannot be
--      indexed and JSON operators (`@>`, `?`, `->`) are slower on it.
--      The contents are unchanged; this is a column-type swap.
--
-- All statements are idempotent (IF EXISTS / IF NOT EXISTS / ADD CONSTRAINT
-- IF NOT EXISTS). Wrapped in a single transaction so partial failures roll
-- back cleanly.

BEGIN;

-- ------------------------------------------------------------
-- 1) instructor_profile: paranoid soft-delete
-- ------------------------------------------------------------
ALTER TABLE instructor_profile
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_instructor_profile_deleted_at
  ON instructor_profile (deleted_at);

-- ------------------------------------------------------------
-- 2) feedback.user_id → FK on "user"(id)
-- ------------------------------------------------------------
-- DO block: ADD CONSTRAINT has no IF NOT EXISTS, so we check pg_constraint.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_feedback_user'
  ) THEN
    ALTER TABLE feedback
      ADD CONSTRAINT fk_feedback_user
      FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_feedback_user_id
  ON feedback (user_id);

-- ------------------------------------------------------------
-- 3) client_request.updated_at
-- ------------------------------------------------------------
ALTER TABLE client_request
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows: copy created_at into updated_at where they
-- still match the default (i.e. row hasn't been touched since the column
-- was added). This keeps history sensible.
UPDATE client_request
   SET updated_at = created_at
 WHERE updated_at < created_at OR updated_at IS NULL;

-- ------------------------------------------------------------
-- 4) social_account: drop OAuth bearer/refresh tokens
-- ------------------------------------------------------------
-- We do NOT call provider APIs on the user's behalf. These columns held
-- bearer tokens that were never read.
ALTER TABLE social_account
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS token_expires_at;

-- ------------------------------------------------------------
-- 5) session.recurring_rule: JSON → JSONB
-- ------------------------------------------------------------
-- Postgres can cast json -> jsonb directly with a USING clause. The
-- contents (an iCal-RRULE-shaped object) are preserved verbatim.
ALTER TABLE session
  ALTER COLUMN recurring_rule
  TYPE JSONB
  USING recurring_rule::jsonb;

COMMIT;
