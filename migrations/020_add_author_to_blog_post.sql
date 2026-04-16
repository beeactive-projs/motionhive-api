-- =========================================================
-- Migration 020: Add author_user_id to blog_post
-- =========================================================
-- Adds an author FK so we can enforce "only the writer who
-- created a post, or an admin, can edit/delete it".
-- Nullable: existing seeded posts have no author and will be
-- editable only by ADMIN/SUPER_ADMIN.
-- =========================================================

ALTER TABLE blog_post
  ADD COLUMN IF NOT EXISTS author_user_id CHAR(36) NULL;

ALTER TABLE blog_post
  DROP CONSTRAINT IF EXISTS blog_post_author_user_id_fkey;

ALTER TABLE blog_post
  ADD CONSTRAINT blog_post_author_user_id_fkey
  FOREIGN KEY (author_user_id) REFERENCES "user"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_blog_post_author_user_id
  ON blog_post (author_user_id);
