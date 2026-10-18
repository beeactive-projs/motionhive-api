-- 068: let a reader mark a conversation as unread.
--
-- "Mark as unread" is a reminder to come back to a thread, not a statement
-- about which messages were read. It can't be expressed by moving
-- last_read_at back: that does nothing when the reader sent the last
-- message (only the other side's messages count as unread), and the other
-- participant sees their own read receipt go back, because one side's
-- last_read_at is the other side's "read" tick.
--
--   * marked_unread — set by PATCH /messaging/conversations/:id/unread,
--                     cleared by mark-read (opening the thread clears it).
--
-- Existing rows were never marked, so FALSE is their true value.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE conversation_participant
  ADD COLUMN IF NOT EXISTS marked_unread BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
