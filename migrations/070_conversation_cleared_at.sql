-- 070: let a participant delete a chat for themselves.
--
-- "Delete chat" works the way WhatsApp's does: the thread leaves the
-- caller's inbox and its history is gone for them, while the other
-- participant keeps theirs. Nothing is deleted. Messages stay for the other
-- side and for moderation (a report can still point at them), so this is a
-- per-participant floor, not a row delete.
--
--   * cleared_at — set by DELETE /messaging/conversations/:id. Messages at
--                  or before it are hidden from this participant and never
--                  count as unread. The conversation drops out of their
--                  inbox until a newer message arrives, which brings it
--                  back with only that message in it.
--
-- left_at can't carry this: it means "no longer a member", stops live
-- events, and a DM has no way back in.
--
-- Existing rows were never cleared, so NULL is their true value.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE conversation_participant
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ NULL;

COMMIT;
