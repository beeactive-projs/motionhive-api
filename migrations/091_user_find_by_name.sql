-- 091: "Let people find me by name" (owner, 2026-11-20).
--
-- People search (`GET /users/search`: the new-message picker, a coach
-- inviting someone they know) matches a person's name and handle only while
-- this is on. The whole email address still finds anyone, so an invitation
-- by email keeps working. On by default for everyone (owner's call); a
-- person turns it off in Privacy. See
-- docs/research/messaging/WHO_CAN_MESSAGE.md §2 (GDPR Art. 25(2)).
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS find_by_name BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
