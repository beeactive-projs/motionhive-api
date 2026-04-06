-- =========================================================
-- Migration 015: Add language column to blog_post
-- =========================================================

ALTER TABLE blog_post
  ADD COLUMN IF NOT EXISTS language CHAR(2) NOT NULL DEFAULT 'en';

-- Tag all existing posts as English
UPDATE blog_post SET language = 'en' WHERE language IS NULL OR language = '';

-- Index for filtering by language
CREATE INDEX IF NOT EXISTS idx_blog_post_language ON blog_post (language);

-- =========================================================
-- language column added to blog_post
-- =========================================================


-- =========================================================
-- Slug alone is no longer unique — the same slug can exist
-- in multiple languages. Uniqueness is (slug, language).
-- =========================================================

-- Drop the old single-column unique index
DROP INDEX IF EXISTS idx_blog_post_slug;

-- Add composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_post_slug_language ON blog_post (slug, language);
