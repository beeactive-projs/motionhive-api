-- 079: workouts round 2. Rest that was really taken, rest defaults in the
-- builders, the person's workout settings, exercises anyone can create, a
-- private note per exercise, and records that leave with their workout.
--
--   * exercise_source + 'USER'          — an exercise someone who is not a
--                                         coach created for themselves.
--                                         Always PRIVATE (CHECK below).
--   * logged_set.rest_source            — how the set's `rest_after_seconds`
--                                         was measured: TAP (the person
--                                         ended the rest), ESTIMATED (worked
--                                         out from the next tick) or BREAK
--                                         (they were away, no rest stored).
--                                         Since this round the column holds
--                                         the rest actually taken, no longer
--                                         the planned one. NULL on every
--                                         existing row: those were written
--                                         by the older logger.
--   * program.default_rest_seconds      — "Rest between sets" of a routine,
--                                         or a program's default.
--   * program_workout.default_rest_seconds
--                                       — a coach's rest for one day.
--                                         Both 0 to 600 seconds. Assigning
--                                         a plan writes them into the
--                                         assigned sets that have no rest,
--                                         so assigned_* need no column.
--   * user.workout_settings             — the person's logger settings
--                                         (default rest, sound, vibration,
--                                         ...). Same pattern as
--                                         privacy_settings: missing keys
--                                         resolve to defaults when read.
--   * one_rep_max.workout_log_id        — the finished workout an estimated
--                                         record came from, so deleting the
--                                         workout deletes its records.
--                                         Backfilled below the way the API
--                                         matches records to a workout: the
--                                         record is stamped with the
--                                         workout's completed_at.
--   * exercise_note                     — one private note per person and
--                                         exercise, shown only to its owner
--                                         (never to a coach).
--
-- Order: a new enum value cannot be used in the transaction that adds it,
-- so the value gets its own transaction first. The runner sends the whole
-- file as one query string; the explicit COMMIT ends that first part.
--
-- Idempotent: ADD VALUE IF NOT EXISTS, duplicate_object guard on the type,
-- IF NOT EXISTS on columns, table and indexes, constraints dropped and
-- added again, and the backfill only touches rows still unlinked.

BEGIN;

ALTER TYPE exercise_source ADD VALUE IF NOT EXISTS 'USER';

COMMIT;

BEGIN;

-- ─── Exercises anyone can create ──────────────────────────────────────

ALTER TABLE exercise DROP CONSTRAINT IF EXISTS exercise_user_source_private;
ALTER TABLE exercise ADD CONSTRAINT exercise_user_source_private
  CHECK (source <> 'USER' OR visibility = 'PRIVATE');

-- ─── Rest actually taken ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE rest_source AS ENUM ('TAP', 'ESTIMATED', 'BREAK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE logged_set
  ADD COLUMN IF NOT EXISTS rest_source rest_source NULL;

COMMENT ON COLUMN logged_set.rest_source IS
  'How rest_after_seconds was measured: TAP exact, ESTIMATED from the next tick, BREAK away (no rest stored). NULL on rows from the older logger, where rest_after_seconds was the planned rest.';

-- ─── Rest defaults in the builders ────────────────────────────────────

ALTER TABLE program
  ADD COLUMN IF NOT EXISTS default_rest_seconds INTEGER NULL;
ALTER TABLE program DROP CONSTRAINT IF EXISTS program_default_rest_range;
ALTER TABLE program ADD CONSTRAINT program_default_rest_range
  CHECK (default_rest_seconds IS NULL OR default_rest_seconds BETWEEN 0 AND 600);

ALTER TABLE program_workout
  ADD COLUMN IF NOT EXISTS default_rest_seconds INTEGER NULL;
ALTER TABLE program_workout DROP CONSTRAINT IF EXISTS program_workout_default_rest_range;
ALTER TABLE program_workout ADD CONSTRAINT program_workout_default_rest_range
  CHECK (default_rest_seconds IS NULL OR default_rest_seconds BETWEEN 0 AND 600);

-- ─── The person's workout settings ────────────────────────────────────

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS workout_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN "user".workout_settings IS
  'Logger settings (defaultRestSeconds, sound, vibration, lockScreen, askEffort, supersetJump, keepScreenOn). Missing keys resolve to defaults in the API.';

-- ─── Records leave with their workout ─────────────────────────────────

ALTER TABLE one_rep_max
  ADD COLUMN IF NOT EXISTS workout_log_id CHAR(36) NULL;

DO $$ BEGIN
  ALTER TABLE one_rep_max
    ADD CONSTRAINT fk_one_rep_max_workout_log FOREIGN KEY (workout_log_id)
    REFERENCES workout_log (id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_one_rep_max_workout_log
  ON one_rep_max (workout_log_id)
  WHERE workout_log_id IS NOT NULL;

-- Finishing a workout writes its estimated records with
-- recorded_at = the workout's completed_at, so that is an exact match.
UPDATE one_rep_max orm
SET workout_log_id = wl.id
FROM workout_log wl
WHERE orm.workout_log_id IS NULL
  AND orm.source = 'ESTIMATED_EPLEY'
  AND wl.user_id = orm.user_id
  AND wl.status = 'COMPLETED'
  AND wl.completed_at = orm.recorded_at;

-- Anything older the API still reads as the workout's by time window
-- (recorded between started_at and completed_at): link it to the workout
-- whose window holds it and which logged that exercise, the latest one
-- if windows overlap.
UPDATE one_rep_max orm
SET workout_log_id = (
  SELECT wl.id
  FROM workout_log wl
  WHERE wl.user_id = orm.user_id
    AND wl.status = 'COMPLETED'
    AND orm.recorded_at BETWEEN wl.started_at AND wl.completed_at
    AND EXISTS (
      SELECT 1 FROM logged_exercise le
      WHERE le.workout_log_id = wl.id
        AND le.exercise_id = orm.exercise_id
    )
  ORDER BY wl.completed_at DESC
  LIMIT 1
)
WHERE orm.workout_log_id IS NULL
  AND orm.source = 'ESTIMATED_EPLEY';

-- ─── A private note per exercise ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS exercise_note (
  id           CHAR(36)      NOT NULL DEFAULT gen_random_uuid()::char(36),
  user_id      CHAR(36)      NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  exercise_id  CHAR(36)      NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
  note         VARCHAR(280)  NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT uq_exercise_note_user_exercise UNIQUE (user_id, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_note_exercise
  ON exercise_note (exercise_id);

COMMENT ON TABLE exercise_note IS
  'One private note per person and exercise. Shown only to its owner, never to a coach.';

COMMIT;
