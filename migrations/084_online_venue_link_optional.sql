-- 084_online_venue_link_optional.sql
-- Title: an online place no longer needs a meeting link.
--
-- Why: coaches add where they work from the welcome flow and their coaching
-- profile, and "I coach online, on Zoom" is a place in its own right. Most
-- send a fresh link per session (sessions carry their own), so asking for a
-- standing link up front only stopped them saying it. The link was never
-- shown publicly (the profile lists kind, name and area only), and nothing
-- else reads it. An active online venue is still what makes a coach "Online"
-- on Discover.
--
-- Changes:
--   - venue: drop CHECK venue_online_xor_physical (027), which required
--     meeting_url on every online row. VenueService now leaves the link and
--     the platform optional, and keeps no address on an online place.
--
-- Safe to run twice. Nothing else changes: rows that have a link keep it.

BEGIN;

ALTER TABLE venue DROP CONSTRAINT IF EXISTS venue_online_xor_physical;

COMMENT ON COLUMN venue.meeting_url IS
  'Optional standing meeting link of an online place (since 084). Never shown publicly.';

COMMIT;
