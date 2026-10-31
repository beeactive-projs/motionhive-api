-- 078: a coach decides whether clients may name them outside the app.
--
-- A client sharing a finished workout from a coach's plan can put an
-- optional coach line on the Full share card ("Plan by Alex").
-- That card leaves MotionHive (stories, chats, anywhere), so naming the
-- coach there is the coach's call, not the client's:
--
--   * allow_client_mentions — set by the coach on their coaching profile.
--                             Only when it is true does the owner's read
--                             of a finished plan workout carry
--                             `summary.mentionableCoach`; otherwise the
--                             card has no coach line to offer.
--
-- Off by default: no coach agreed to this before the setting existed, so
-- FALSE is every existing row's true value.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE instructor_profile
  ADD COLUMN IF NOT EXISTS allow_client_mentions BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN instructor_profile.allow_client_mentions IS
  'Whether clients may name this coach on a workout they share outside the app. Off by default.';

COMMIT;
