-- 087_refresh_token_family.sql
-- Title: Refresh tokens remember the sign in they came from, and what replaced them.
--
-- Why: a refresh token is rotated on every use, but a rotated token coming
-- back was only refused. A stolen token kept rotating for as long as the
-- thief used it, while the person it belonged to was simply signed out.
-- With the sign in (the family) and the replacement known, a rotated token
-- that comes back after a short grace window ends the whole family: the
-- thief and the person are both signed out, and only a fresh sign in (the
-- password) gets back in.
--
-- Changes:
--   - refresh_token.family_id: the id of the first token of the sign in.
--     Nullable, so a token written by the previous build during a deploy
--     still saves; the code reads a missing family as the token's own id.
--   - refresh_token.replaced_by_id: the token this one was rotated into.
--     Null for a live token and for one revoked by signing out.
--   - Backfill: every existing token is its own family.
--   - Index on family_id, for ending a family in one update.
--
-- Safe to run twice.

BEGIN;

ALTER TABLE refresh_token
  ADD COLUMN IF NOT EXISTS family_id CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_id CHAR(36) NULL;

COMMENT ON COLUMN refresh_token.family_id IS
  'Id of the first refresh token of this sign in; every rotation keeps it. A rotated token reused after the grace window revokes the whole family.';
COMMENT ON COLUMN refresh_token.replaced_by_id IS
  'The refresh token this one was rotated into. Null while live, and when revoked by signing out.';

UPDATE refresh_token SET family_id = id WHERE family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_token_family_id ON refresh_token (family_id);

COMMIT;
