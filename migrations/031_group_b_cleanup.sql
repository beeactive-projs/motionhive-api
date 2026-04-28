-- 031_group_b_cleanup.sql
--
-- Group B schema cleanup — drops two unused/dangerous columns on `group`
-- and migrates `group_member.is_owner BOOLEAN` to `role group_member_role`
-- (ENUM: MEMBER | MODERATOR | OWNER).
--
-- Changes:
--
--   1. group.settings JSON DROP
--      No code reads this column. It existed as a future-looking JSON bag
--      with declared but unused keys (allowMemberInvites, requireApproval,
--      etc). When real per-group settings are needed, they will be modeled
--      as concrete columns with constraints — not a free-form JSON bag.
--
--   2. group.member_count INTEGER DROP
--      Denormalized counter incremented/decremented in 8 service sites,
--      with no reconciliation job. Drift was already possible. Member
--      count is now computed at read time via a correlated subquery on
--      group_member. The API still exposes a `memberCount` field; the
--      query plan changes, the contract does not.
--
--   3. group_member.is_owner BOOLEAN -> role group_member_role ENUM
--      The boolean cannot represent moderators or co-owners. Replaced
--      with an enum (MEMBER | MODERATOR | OWNER). Backfill is
--      deterministic: TRUE -> OWNER, FALSE -> MEMBER. A partial unique
--      index enforces "at most one OWNER per group".
--
--      `is_owner` is kept for one release as a generated column derived
--      from `role`, so any existing callers reading the column see the
--      same value. The next migration (after the FE has switched to
--      `role`) drops the generated column and any lingering reads.
--
-- All statements are idempotent and wrapped in a transaction.

BEGIN;

-- ------------------------------------------------------------
-- 1) group.settings DROP
-- ------------------------------------------------------------
ALTER TABLE "group"
  DROP COLUMN IF EXISTS settings;

-- ------------------------------------------------------------
-- 2) group.member_count DROP
-- ------------------------------------------------------------
ALTER TABLE "group"
  DROP COLUMN IF EXISTS member_count;

-- ------------------------------------------------------------
-- 3) group_member.is_owner -> role
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE group_member_role AS ENUM ('MEMBER', 'MODERATOR', 'OWNER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add the new column nullable so the backfill can populate it before
-- we mark it NOT NULL.
ALTER TABLE group_member
  ADD COLUMN IF NOT EXISTS role group_member_role NULL;

-- Backfill from is_owner. Idempotent: only writes rows that haven't been
-- migrated yet.
UPDATE group_member
   SET role = CASE WHEN is_owner = TRUE THEN 'OWNER'::group_member_role
                   ELSE 'MEMBER'::group_member_role END
 WHERE role IS NULL;

ALTER TABLE group_member
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN role SET DEFAULT 'MEMBER';

-- Drop the OLD is_owner column and replace with a generated column that
-- derives from `role`. This keeps any not-yet-migrated read sites
-- functional during the FE transition window.
--
-- Postgres won't let us swap a regular column for a generated column with
-- the same name in one ALTER, so we do it in three steps inside this txn.
ALTER TABLE group_member DROP COLUMN IF EXISTS is_owner;

ALTER TABLE group_member
  ADD COLUMN is_owner BOOLEAN
  GENERATED ALWAYS AS (role = 'OWNER'::group_member_role) STORED;

-- Enforce: at most one OWNER per group. Active members only (left_at IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uk_group_member_one_owner
  ON group_member (group_id)
  WHERE role = 'OWNER' AND left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_group_member_role
  ON group_member (group_id, role)
  WHERE left_at IS NULL;

COMMIT;
