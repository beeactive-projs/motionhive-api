-- 076: reporting a workout someone shows on their profile, and taking it down.
--
--   * workout_report             — a person reports a workout they can see
--                                  on someone's profile. Same categories and
--                                  statuses as message_report (migration
--                                  042), so the admin queue reads one way.
--                                  One open report per reporter and workout.
--   * workout_log.taken_down_at  — set when staff take a reported workout
--                                  down. It leaves the profile and every
--                                  group card, drops to Only me, and can no
--                                  longer be made Public or shared again.
--                                  The owner keeps it in their history.
--
-- Reports go with the workout (ON DELETE CASCADE): erasure deletes a
-- person's workouts, and the reports they filed are deleted by the erasure
-- statements. No existing workout was taken down, so NULL is their value.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE workout_log
  ADD COLUMN IF NOT EXISTS taken_down_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS workout_report (
  id                CHAR(36)      NOT NULL DEFAULT gen_random_uuid()::char(36),
  reporter_id       CHAR(36)      NOT NULL,
  owner_id          CHAR(36)      NOT NULL,
  workout_log_id    CHAR(36)      NOT NULL,
  category          VARCHAR(32)   NOT NULL,
  notes             TEXT          DEFAULT NULL,
  status            VARCHAR(16)   NOT NULL DEFAULT 'OPEN',
  taken_down        BOOLEAN       NOT NULL DEFAULT FALSE,
  resolved_by_id    CHAR(36)      DEFAULT NULL,
  resolved_at       TIMESTAMPTZ   DEFAULT NULL,
  resolution_notes  TEXT          DEFAULT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT chk_workout_report_category
    CHECK (category IN ('SPAM','SCAM','HARASSMENT','IMPERSONATION','SEXUAL','OTHER')),
  CONSTRAINT chk_workout_report_status
    CHECK (status IN ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
  CONSTRAINT fk_wr_reporter FOREIGN KEY (reporter_id)
    REFERENCES "user" (id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_owner FOREIGN KEY (owner_id)
    REFERENCES "user" (id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_workout_log FOREIGN KEY (workout_log_id)
    REFERENCES workout_log (id) ON DELETE CASCADE,
  CONSTRAINT fk_wr_resolved_by FOREIGN KEY (resolved_by_id)
    REFERENCES "user" (id) ON DELETE SET NULL
);

-- One open report per reporter and workout: a second tap is a no-op, not
-- a second row in the queue.
CREATE UNIQUE INDEX IF NOT EXISTS uk_workout_report_open
  ON workout_report (reporter_id, workout_log_id)
  WHERE status IN ('OPEN','REVIEWING');

CREATE INDEX IF NOT EXISTS idx_workout_report_queue
  ON workout_report (created_at DESC)
  WHERE status IN ('OPEN','REVIEWING');

CREATE INDEX IF NOT EXISTS idx_workout_report_log
  ON workout_report (workout_log_id);

COMMIT;
