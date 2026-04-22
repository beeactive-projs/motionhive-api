-- 025_add_user_avatar_url.sql
--
-- Add uploaded-avatar columns on `user`.
--
-- The legacy `avatar_id SMALLINT` column was part of a preset-picker flow
-- that never shipped to the UI; we keep it for backwards compatibility
-- so any in-flight migrations or seeds don't fail, but new uploads use
-- `avatar_url` + `avatar_public_id` instead.
--
--   avatar_url         → Cloudinary secure_url to render in the UI
--   avatar_public_id   → Cloudinary public id, needed to DELETE the old
--                         asset when the user re-uploads.
--
-- Both nullable: users keep the initials-badge fallback until they upload
-- a picture, and we never throw if Cloudinary is unreachable.

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS avatar_public_id VARCHAR(255) NULL;
