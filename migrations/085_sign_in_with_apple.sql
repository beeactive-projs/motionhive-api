-- 085_sign_in_with_apple.sql
-- Title: Sign in with Apple keeps what it needs to be undone, and email
-- lookups stop caring about letter case.
--
-- Why: APPLE has been in enum_social_provider since 001, so no enum change.
-- 030 dropped the provider token columns because nothing ever called a
-- provider on a person's behalf. Apple is the exception: when an account is
-- deleted, Apple asks apps to revoke the person's Sign in with Apple grant,
-- and revoking takes the refresh token Apple handed out at sign-in, sent
-- with the client id it was issued to (the app's bundle id, or the web
-- Services ID). It is stored encrypted (AES-256-GCM with
-- TOKEN_ENCRYPTION_KEY, CryptoService.encrypt), never exported, and cleared
-- once revoked.
--
-- is_private_email records whether the address Apple shared is a Hide My
-- Email relay, read from Apple's own claim (not guessed from the domain,
-- since Apple is moving relay addresses to a new domain).
--
-- Email: sign in looks a person up by email ignoring case
-- (UserService.findByEmail), so a provider that sends "Ana@Example.com"
-- finds the account made as "ana@example.com" instead of making a second
-- one. The index keeps that lookup fast. It is not UNIQUE yet: existing
-- rows that differ only by case must be checked on production first.
--
-- Changes:
--   - social_account: refresh_token_enc, token_client_id, is_private_email
--     (all nullable; only Apple rows fill them)
--   - "user": index on lower(email)
--
-- Safe to run twice.

BEGIN;

ALTER TABLE social_account
  ADD COLUMN IF NOT EXISTS refresh_token_enc TEXT NULL,
  ADD COLUMN IF NOT EXISTS token_client_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS is_private_email BOOLEAN NULL;

COMMENT ON COLUMN social_account.refresh_token_enc IS
  'Apple only: the newest Sign in with Apple refresh token, AES-256-GCM encrypted. Used to revoke the grant when the account is deleted; cleared once revoked.';
COMMENT ON COLUMN social_account.token_client_id IS
  'Apple only: the client id the refresh token was issued to (bundle id or Services ID); revocation must send the same one.';
COMMENT ON COLUMN social_account.is_private_email IS
  'Apple only: provider_email is a Hide My Email relay address (Apple''s is_private_email claim).';

CREATE INDEX IF NOT EXISTS idx_user_email_lower ON "user" (lower(email));

COMMIT;
