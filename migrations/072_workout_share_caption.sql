-- 072: the message a person puts on a workout they share.
--
-- Sharing a finished workout draws a story card on the phone; the one
-- line of text on it ("First 100! The knee held.") is kept with the
-- workout so sharing again reuses it, and later public views can show it
-- as the caption:
--
--   * share_caption — at most 80 characters, so it fits the card. Separate
--                     from `notes` on purpose: the note is private (you,
--                     and a coach you share with) and is never put on a
--                     card unless the person copies it there themselves.
--
-- Existing workouts were never shared, so NULL is their true value.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE workout_log
  ADD COLUMN IF NOT EXISTS share_caption VARCHAR(80) NULL;

COMMENT ON COLUMN workout_log.share_caption IS
  'The line of text on the shared story card, max 80 chars. Not the private note.';

COMMIT;
