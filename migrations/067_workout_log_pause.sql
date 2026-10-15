-- 067: let a workout in progress be paused.
--
-- Leaving the logger used to mean one thing: the session kept running, so a
-- workout put down for lunch came back with an hour on its clock and saved
-- that hour as its duration. Pausing stops the clock instead.
--
--   * paused_at      — when the current pause began; NULL while running.
--   * paused_seconds — every finished pause, summed. Resuming folds the
--                      current pause into it and clears paused_at.
--
-- The workout's duration is then completed_at - started_at - paused_seconds,
-- and the live clock is (paused_at or now) - started_at - paused_seconds.
-- Existing rows were never paused, so 0 and NULL are their true values.
--
-- Idempotent: IF NOT EXISTS on both columns.

BEGIN;

ALTER TABLE workout_log
  ADD COLUMN IF NOT EXISTS paused_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paused_seconds INTEGER     NOT NULL DEFAULT 0;

COMMIT;
