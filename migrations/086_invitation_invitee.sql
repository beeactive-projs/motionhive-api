-- 086_invitation_invitee.sql
-- Title: A group invitation made for an account remembers that account.
--
-- Why: the in-app group invitations a coach sends to their clients
-- (POST /invitations/bulk) are made for chosen accounts and sent by no
-- email. They were matched to people by email alone, so answering them in
-- the app now needs a verified address, which locked out real clients who
-- had not clicked their verification link yet (and every Facebook
-- account, whose address Facebook never vouches for). Matching them by the
-- account they were made for needs no proof of the address: the coach
-- picked that account.
--
-- Changes:
--   - invitation.invitee_id: the account an in-app invitation was made for
--     (nullable: an invitation by email has none until accepted).
--   - Backfill, for pending invitations only, where the invited address's
--     account existed when the invitation was made AND is either verified
--     or an ACTIVE client of the inviter. An account that merely typed
--     someone else's address at sign up gets neither.
--
-- Safe to run twice.

BEGIN;

ALTER TABLE invitation
  ADD COLUMN IF NOT EXISTS invitee_id CHAR(36) NULL
    REFERENCES "user"(id) ON DELETE CASCADE;

COMMENT ON COLUMN invitation.invitee_id IS
  'The account an in-app invitation was made for (POST /invitations/bulk); it answers the invitation in the app without a verified email. Null for an invitation sent by email.';

CREATE INDEX IF NOT EXISTS idx_invitation_invitee_pending
  ON invitation (invitee_id)
  WHERE accepted_at IS NULL AND declined_at IS NULL;

UPDATE invitation i
SET invitee_id = u.id
FROM "user" u
WHERE i.invitee_id IS NULL
  AND i.accepted_at IS NULL
  AND i.declined_at IS NULL
  AND lower(i.email) = lower(u.email)
  AND u.created_at <= i.created_at
  AND u.deleted_at IS NULL
  AND (
    u.is_email_verified = TRUE
    OR EXISTS (
      SELECT 1 FROM instructor_client ic
      WHERE ic.instructor_id = i.inviter_id
        AND ic.client_id = u.id
        AND ic.status = 'ACTIVE'
    )
  );

COMMIT;
