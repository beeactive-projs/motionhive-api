-- 034_posts.sql
--
-- Posts feature — V1 ships group posts, schema is forward-compatible
-- so V2 (personal/follower feed) and V3 (public posts) plug in by
-- adding new `audience_type` enum values, never new tables.
--
-- The model is one canonical `post` (author-owned) + a polymorphic
-- `post_audience` junction. Group posts are `post_audience(GROUP, group_id)`.
-- Engagement (comments, reactions) FK to `post`, not the audience —
-- so cross-group engagement is shared, matching FB/LinkedIn internals.
--
-- Tables:
--   1. post                  — paranoid; one row per authored post
--   2. post_audience         — paranoid junction (GROUP today; FOLLOWERS / PUBLIC later)
--   3. post_comment          — paranoid; flat with parent_comment_id (UI enforces 1 level)
--   4. post_reaction         — non-paranoid; UNIQUE(post, user); type swap-in-place
--
-- Plus on `group`:
--   5. member_post_policy ENUM (DISABLED | OPEN | APPROVAL_REQUIRED), default DISABLED.
--
-- Plus on `search_doc`:
--   6. CHECK constraint extended to allow entity_type='post'. Migration 029
--      hardcoded the allowed list; we drop and recreate it here.
--
-- All statements are idempotent and wrapped in a single transaction.

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- 1) post
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post (
  id          CHAR(36)  NOT NULL DEFAULT gen_random_uuid(),
  author_id   CHAR(36)  NOT NULL REFERENCES "user"(id),
  content     TEXT      NOT NULL,
  media_urls  JSON      DEFAULT NULL,  -- array of Cloudinary secure_url strings
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP DEFAULT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_post_author  ON post(author_id);
CREATE INDEX IF NOT EXISTS idx_post_deleted ON post(deleted_at);
CREATE INDEX IF NOT EXISTS idx_post_created ON post(created_at DESC);

-- ────────────────────────────────────────────────────────────────
-- 2) post_audience
-- ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE post_audience_type AS ENUM ('GROUP');
  -- V2 will ALTER TYPE post_audience_type ADD VALUE 'FOLLOWERS';
  -- V3 will ALTER TYPE post_audience_type ADD VALUE 'PUBLIC';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE post_audience_approval AS ENUM ('APPROVED', 'PENDING', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS post_audience (
  id              CHAR(36) NOT NULL DEFAULT gen_random_uuid(),
  post_id         CHAR(36) NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  audience_type   post_audience_type     NOT NULL,
  audience_id     CHAR(36) DEFAULT NULL,
  approval_state  post_audience_approval NOT NULL DEFAULT 'APPROVED',
  posted_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at      TIMESTAMP DEFAULT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uk_post_audience UNIQUE (post_id, audience_type, audience_id)
);

-- Hot path: per-group feed query — APPROVED & not deleted, newest first.
CREATE INDEX IF NOT EXISTS idx_post_audience_feed
  ON post_audience(audience_type, audience_id, posted_at DESC)
  WHERE deleted_at IS NULL AND approval_state = 'APPROVED';

-- Moderator approval queue — PENDING & not deleted.
CREATE INDEX IF NOT EXISTS idx_post_audience_pending
  ON post_audience(audience_type, audience_id)
  WHERE deleted_at IS NULL AND approval_state = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_post_audience_post ON post_audience(post_id);

-- ────────────────────────────────────────────────────────────────
-- 3) post_comment
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_comment (
  id                 CHAR(36) NOT NULL DEFAULT gen_random_uuid(),
  post_id            CHAR(36) NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  parent_comment_id  CHAR(36) DEFAULT NULL REFERENCES post_comment(id),
  author_id          CHAR(36) NOT NULL REFERENCES "user"(id),
  content            TEXT     NOT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at         TIMESTAMP DEFAULT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_post_comment_post
  ON post_comment(post_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_post_comment_parent ON post_comment(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_post_comment_author ON post_comment(author_id);

-- ────────────────────────────────────────────────────────────────
-- 4) post_reaction
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_reaction (
  id             CHAR(36)    NOT NULL DEFAULT gen_random_uuid(),
  post_id        CHAR(36)    NOT NULL REFERENCES post(id) ON DELETE CASCADE,
  author_id      CHAR(36)    NOT NULL REFERENCES "user"(id),
  reaction_type  VARCHAR(20) NOT NULL DEFAULT 'LIKE',
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT uk_post_reaction_one_per_user UNIQUE (post_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reaction_post ON post_reaction(post_id);

-- ────────────────────────────────────────────────────────────────
-- 5) group.member_post_policy
-- ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE group_member_post_policy AS ENUM ('DISABLED', 'OPEN', 'APPROVAL_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "group"
  ADD COLUMN IF NOT EXISTS member_post_policy group_member_post_policy
    NOT NULL DEFAULT 'DISABLED';

-- ────────────────────────────────────────────────────────────────
-- 6) search_doc.entity_type CHECK constraint extension
-- ────────────────────────────────────────────────────────────────
ALTER TABLE search_doc DROP CONSTRAINT IF EXISTS chk_search_doc_entity_type;
ALTER TABLE search_doc ADD CONSTRAINT chk_search_doc_entity_type
  CHECK (entity_type IN ('user', 'instructor', 'group', 'session', 'tag', 'post'));

COMMIT;
