-- 088_assignment_status_change.sql
-- Title: A plan remembers its last status change: when, by whom, and the coach's message.
--
-- Why: a coach can pause, resume, finish or cancel a client's plan, and the
-- client is now told each time, with the coach's optional message. The
-- client's plan card says "Paused since 19 Nov" or "cancelled on 12 Nov"
-- and quotes that message, and resuming moves the days left open since
-- the pause began, so the pause start has to be known. None of that was
-- stored: the status was the only trace of the change.
--
-- Changes:
--   - program_assignment.status_changed_at: when the status last changed
--     (a coach's change, or the plan finishing on its own). Null for a plan
--     whose status never changed since it was assigned, and for every row
--     written before this migration.
--   - program_assignment.status_changed_by: the account that changed it.
--     Null when the system did (a plan finishing on its own), and once that
--     account is erased.
--   - program_assignment.status_message: the message the coach sent with
--     the change, as written (text a person wrote, never translated). Null
--     when they sent none; every later change replaces it.
--
-- Safe to run twice.

BEGIN;

ALTER TABLE program_assignment
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS status_changed_by CHAR(36) NULL
    REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_message TEXT NULL;

COMMENT ON COLUMN program_assignment.status_changed_at IS
  'When the status last changed. While PAUSED it is when the pause began: resuming moves the open days scheduled since then forward by whole weeks.';

COMMENT ON COLUMN program_assignment.status_changed_by IS
  'Who changed the status last: the coach, or null when the plan finished on its own.';

COMMENT ON COLUMN program_assignment.status_message IS
  'The message the coach sent the client with the last status change, as written. Replaced on every change.';

COMMENT ON COLUMN program_assignment.notes IS
  'The coach''s note for the client, written when the plan is assigned. The client reads it on the plan.';

COMMIT;
