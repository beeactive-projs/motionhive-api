-- 074: one photo per finished workout.
--
--   * photo_public_id — the Cloudinary public id of the photo, stored as
--                       an `authenticated` asset. Cloudinary serves those
--                       only through signed URLs, which do not expire, so
--                       the URL never leaves the API: it checks who is
--                       asking (the owner, or a coach the workout's
--                       visibility allows) and streams the bytes itself.
--   * photo_version   — Cloudinary's version of the current file, so the
--                       apps can tell a replaced photo from a cached one.
--
-- The file is stripped of EXIF/XMP/IPTC by the API before it is stored
-- (and re-encoded by the app before that), so no location travels with
-- it. Account erasure deletes the person's photo folder along with the
-- workout rows (migration 069 flow).
--
-- Existing workouts have no photo, so NULL is their true value.
--
-- Idempotent: IF NOT EXISTS.

BEGIN;

ALTER TABLE workout_log
  ADD COLUMN IF NOT EXISTS photo_public_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS photo_version INTEGER NULL;

COMMENT ON COLUMN workout_log.photo_public_id IS
  'Private (authenticated) Cloudinary asset; served only through the API after an access check.';

COMMIT;
