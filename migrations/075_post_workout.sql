-- 075: a group post can carry a finished workout.
--
--   * post.workout_log_id — the workout shared into the group. The feed
--                           shows it as a card built from the same safe
--                           summary as a profile (name, date, duration,
--                           sets, records, the share message): never the
--                           private note, weights or the photo. Sharing to
--                           a group is a deliberate act, so the group sees
--                           that summary whatever the workout's own level.
--                           ON DELETE SET NULL: the post stays with its text
--                           if the workout goes.
--
-- Existing posts carry no workout, so NULL is their true value.
--
-- Idempotent: IF NOT EXISTS, and the constraint guarded by name.

BEGIN;

ALTER TABLE post
  ADD COLUMN IF NOT EXISTS workout_log_id CHAR(36) NULL;

DO $$ BEGIN
  ALTER TABLE post
    ADD CONSTRAINT fk_post_workout_log FOREIGN KEY (workout_log_id)
    REFERENCES workout_log (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_post_workout_log ON post (workout_log_id)
  WHERE workout_log_id IS NOT NULL;

COMMIT;
