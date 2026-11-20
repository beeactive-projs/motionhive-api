-- 090: message requests, archive, and "who can message you".
--
-- Anyone can still write to anyone, but a message from someone the
-- recipient isn't connected with (coaching, a recent booking, a group they
-- run or belong to with that person as owner or moderator) arrives as a
-- message request instead of a chat. See
-- docs/research/messaging/WHO_CAN_MESSAGE.md.
--
-- conversation_participant, per person in a chat:
--   * accepted_at  - when this person took the chat in. NULL means the chat
--                    is a message request waiting for them.
--   * request_at   - when the request to this person started. Set once, on
--                    the first message of the request; the sender's limit
--                    (3, or 10 to a coach taking clients) counts their
--                    messages from it, and the daily cap on new requests
--                    counts it.
--   * declined_at  - this person deleted the request. It leaves their
--                    requests and nothing tells the sender.
--   * archived_at  - this person archived the chat: out of the list, no
--                    push or email, stays archived when messages arrive.
--
-- "user".message_policy: EVERYONE (strangers land in chats), REQUESTS
-- (the default), CONNECTIONS (nobody else can start a chat).
--
-- Every chat that exists was accepted under the old rules, so the backfill
-- accepts them all. It runs only in the same step that adds accepted_at:
-- a re-run of this file must never accept requests made since.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversation_participant'
      AND column_name = 'accepted_at'
  ) THEN
    ALTER TABLE conversation_participant
      ADD COLUMN accepted_at TIMESTAMPTZ NULL;
    UPDATE conversation_participant
      SET accepted_at = COALESCE(joined_at, CURRENT_TIMESTAMP);
  END IF;
END $$;

ALTER TABLE conversation_participant
  ADD COLUMN IF NOT EXISTS request_at  TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- The daily cap reads the requests one person started in the last day.
CREATE INDEX IF NOT EXISTS idx_conversation_participant_request_at
  ON conversation_participant (request_at)
  WHERE request_at IS NOT NULL;

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS message_policy VARCHAR(16) NOT NULL DEFAULT 'REQUESTS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_message_policy'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT chk_user_message_policy
      CHECK (message_policy IN ('EVERYONE', 'REQUESTS', 'CONNECTIONS'));
  END IF;
END $$;

COMMIT;
