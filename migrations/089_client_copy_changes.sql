-- 089_client_copy_changes.sql
-- Title: A coach's changes to one client's copy of a plan are dated, so the client is told once.
--
-- Why: a coach can now edit one client's copy of a plan (its days not
-- started yet): change sets, swap, add, remove or reorder exercises, put
-- an exercise back to the program's values, or move a day to another date.
-- The client gets one "your coach adjusted your plan" notification when
-- the coach taps Done, naming the day that changed, and never one per tap.
-- Nothing stored when a day was changed, or when the client was last told,
-- so neither "which days changed" nor "since the last notice" could be
-- answered.
--
-- Changes:
--   - assigned_workout.coach_changed_at: when the coach last changed this
--     day of the client's copy (its exercises, their sets, or its date).
--     Null for a day the coach never changed, and for every row written
--     before this migration.
--   - program_assignment.coach_changes_notified_at: when the client was
--     last told about the coach's changes. Done notifies about the days
--     changed after it, then moves it on. Null until the first notice.
--
-- Safe to run twice.

BEGIN;

ALTER TABLE assigned_workout
  ADD COLUMN IF NOT EXISTS coach_changed_at TIMESTAMPTZ NULL;

ALTER TABLE program_assignment
  ADD COLUMN IF NOT EXISTS coach_changes_notified_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN assigned_workout.coach_changed_at IS
  'When the coach last changed this day of the client''s copy (exercises, sets or date). Null when never changed.';

COMMENT ON COLUMN program_assignment.coach_changes_notified_at IS
  'When the client was last told about the coach''s changes to their copy. Done notifies about days changed after it.';

COMMENT ON COLUMN assigned_exercise.is_modified_from_master IS
  'True once the coach changed, replaced or added this exercise in the client''s copy. Back to the program''s values clears it.';

COMMIT;
