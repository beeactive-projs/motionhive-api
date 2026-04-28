-- 033_blog_post_author_cleanup.sql
--
-- Item 11 from the pre-ship cleanup punch list.
--
-- Change:
--   blog_post drops `author_name`, `author_initials`, `author_role` and
--   adds `guest_author_name VARCHAR(100) NULL` plus a CHECK that
--   exactly one of (author_user_id, guest_author_name) is set.
--
-- Why:
--   `author_name` / `author_initials` / `author_role` were stored as
--   plain strings even when `author_user_id` pointed at a real user
--   row, duplicating data and drifting on user rename. The shape
--   conflated two cases — registered author vs guest contributor —
--   into one set of NOT NULL columns. After this migration:
--     - registered author → `author_user_id` set, name/initials joined
--       from `user` at read time
--     - guest contributor → `author_user_id` NULL, `guest_author_name`
--       holds the byline (no role, no initials — initials are derived
--       on the FE from the byline)
--
-- Backfill rules (idempotent):
--   - Rows with `author_user_id IS NULL` (today's seeded posts):
--       guest_author_name = author_name
--   - Rows with `author_user_id IS NOT NULL`:
--       guest_author_name = NULL (the user join supplies the name)
--   - The XOR CHECK enforces this at the DB level after backfill.
--
-- Idempotency:
--   - CHECK + column drop guarded with IF EXISTS / pg_constraint
--     lookups so re-running is a no-op.
--   - Backfill only writes rows where guest_author_name IS NULL
--     and a name source exists.
--
-- Wrapped in a single transaction.

BEGIN;

-- ------------------------------------------------------------
-- 1) Add guest_author_name nullable
-- ------------------------------------------------------------
ALTER TABLE blog_post
  ADD COLUMN IF NOT EXISTS guest_author_name VARCHAR(100) NULL;

-- ------------------------------------------------------------
-- 2) Backfill from author_name. Only fires while author_name still
--    exists (first run); on re-run the column is gone and the UPDATE
--    is a no-op. Use a DO block so the IF NOT EXISTS guard works
--    cleanly.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'blog_post' AND column_name = 'author_name'
  ) THEN
    EXECUTE $sql$
      UPDATE blog_post
         SET guest_author_name = author_name
       WHERE guest_author_name IS NULL
         AND author_user_id IS NULL
    $sql$;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3) Add the XOR CHECK. NB: existing rows MUST satisfy it before we
--    add the constraint. The backfill above guarantees:
--      - posts with author_user_id IS NOT NULL → guest_author_name IS NULL
--        (we never wrote a guest name when the user link was set)
--      - posts with author_user_id IS NULL     → guest_author_name set
--        from author_name
--    On a fresh DB created from scratch (000 → 033) the rule trivially
--    holds: every insert satisfies one branch.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'blog_post_author_xor'
  ) THEN
    ALTER TABLE blog_post
      ADD CONSTRAINT blog_post_author_xor
      CHECK (
        (author_user_id IS NOT NULL AND guest_author_name IS NULL)
        OR
        (author_user_id IS NULL AND guest_author_name IS NOT NULL)
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) Drop the old columns. Order doesn't matter — none of the three
--    are referenced by FKs or indexes.
-- ------------------------------------------------------------
ALTER TABLE blog_post
  DROP COLUMN IF EXISTS author_name,
  DROP COLUMN IF EXISTS author_initials,
  DROP COLUMN IF EXISTS author_role;

COMMIT;
