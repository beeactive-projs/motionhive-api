-- 073: who sees a workout, per workout, with the same three levels as the
-- profile privacy settings.
--
--   * workout_log.visibility — ONLY_ME | COACHES_ONLY | PUBLIC. A coach
--     reads a client's workout when it came from that coach's own plan
--     (unchanged, whatever the level) or the client set it to
--     COACHES_ONLY or PUBLIC. PUBLIC is stored now and shown on the
--     person's profile later.
--   * user.privacy_settings.workouts — the level new workouts start at.
--     Missing means ONLY_ME (app-layer default, like every other key).
--
-- This replaces program_assignment.share_off_plan as the thing coach
-- reads consult. Nothing in the apps could ever set that flag (no
-- endpoint, no screen), so it is true only where someone set it by hand.
-- Those settings are carried over without exposing anything new:
--
--   * A workout that a sharing coach could read becomes COACHES_ONLY
--     only when no other ACTIVE coach of that person would newly see it.
--     Where one would, it stays ONLY_ME: someone who shared with one of
--     two coaches is not opened up to the other. The sharing coach can
--     lose sight of those few; privacy wins the tie.
--   * The same rule sets privacy_settings.workouts = COACHES_ONLY for a
--     person whose every ACTIVE coach was shared with.
--
-- share_off_plan stays (unread) for one release, so this can be undone.
--
-- Idempotent: duplicate_object guard on the type, IF NOT EXISTS on the
-- column, and both backfills only touch rows still at their default.

BEGIN;

DO $$ BEGIN
  CREATE TYPE workout_log_visibility AS ENUM ('ONLY_ME', 'COACHES_ONLY', 'PUBLIC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE workout_log
  ADD COLUMN IF NOT EXISTS visibility workout_log_visibility NOT NULL DEFAULT 'ONLY_ME';

COMMENT ON COLUMN workout_log.visibility IS
  'Who besides the owner sees it. The coach whose plan it came from always does.';

-- Workouts a coach saw only through share_off_plan, where opening them to
-- all coaches exposes them to nobody new.
UPDATE workout_log wl
SET visibility = 'COACHES_ONLY'
WHERE wl.visibility = 'ONLY_ME'
  AND EXISTS (
    SELECT 1 FROM program_assignment pa
    WHERE pa.client_id = wl.user_id
      AND pa.deleted_at IS NULL
      AND pa.share_off_plan
  )
  AND NOT EXISTS (
    -- An active coach who did not have it shared and does not own its plan.
    SELECT 1 FROM instructor_client ic
    WHERE ic.client_id = wl.user_id
      AND ic.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM program_assignment pa
        WHERE pa.instructor_id = ic.instructor_id
          AND pa.client_id = wl.user_id
          AND pa.deleted_at IS NULL
          AND pa.share_off_plan
      )
      AND (
        wl.program_assignment_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM program_assignment own
          WHERE own.id = wl.program_assignment_id
            AND own.instructor_id = ic.instructor_id
        )
      )
  );

-- The person's default, by the same rule: every active coach was shared with.
UPDATE "user" u
SET privacy_settings = u.privacy_settings || '{"workouts": "COACHES_ONLY"}'::jsonb
WHERE NOT (u.privacy_settings ? 'workouts')
  AND EXISTS (
    SELECT 1 FROM program_assignment pa
    WHERE pa.client_id = u.id AND pa.deleted_at IS NULL AND pa.share_off_plan
  )
  AND NOT EXISTS (
    SELECT 1 FROM instructor_client ic
    WHERE ic.client_id = u.id
      AND ic.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM program_assignment pa
        WHERE pa.instructor_id = ic.instructor_id
          AND pa.client_id = u.id
          AND pa.deleted_at IS NULL
          AND pa.share_off_plan
      )
  );

COMMENT ON COLUMN program_assignment.share_off_plan IS
  'Superseded by workout_log.visibility (migration 073); no longer read. Drop after one release.';

COMMIT;
