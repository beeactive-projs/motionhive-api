-- 092: things sent into a chat as a card (share cards).
--
-- A message can carry a public thing: an open session, a public group, a
-- coach in the directory, a public exercise, a MotionHive starter. Only its
-- type and id are stored; each reader's card is drawn from the live row, so
-- it is never stale and never keeps something that has since turned
-- private. See docs/research/messaging/SHARE_IN_MESSAGES.md.
--
--   * message_attachment: one row per thing on a message (position orders
--     several, for later). No FK on target_id: it points at a different
--     table per type, and a missing row reads as "No longer available".
--     The (target_type, target_id) index answers "where was this shared".
--   * conversation.last_message_attachment_type: the chat list says
--     "Session · ..." for a share, in the reader's language.
--
-- A new type is one value in chk_message_attachment_type.
--
-- Idempotent: IF NOT EXISTS, and the CHECK is added once.

BEGIN;

CREATE TABLE IF NOT EXISTS message_attachment (
  id           CHAR(36)     NOT NULL DEFAULT gen_random_uuid()::char(36),
  message_id   CHAR(36)     NOT NULL,
  target_type  VARCHAR(24)  NOT NULL,
  target_id    CHAR(36)     NOT NULL,
  position     SMALLINT     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT fk_message_attachment_message FOREIGN KEY (message_id)
    REFERENCES message (id) ON DELETE CASCADE,
  CONSTRAINT uq_message_attachment_position UNIQUE (message_id, position)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_message_attachment_type'
  ) THEN
    ALTER TABLE message_attachment
      ADD CONSTRAINT chk_message_attachment_type
      CHECK (target_type IN ('SESSION', 'GROUP', 'COACH', 'EXERCISE', 'PROGRAM'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_message_attachment_target
  ON message_attachment (target_type, target_id);

ALTER TABLE conversation
  ADD COLUMN IF NOT EXISTS last_message_attachment_type VARCHAR(24) NULL;

COMMIT;
