-- =========================================================
-- Migration 023: Seed payment demo data (SUPERSEDED BY 026)
-- =========================================================
-- Original content used hand-written IDs like
-- `demo0001-prod-0000-0000-000000000001` that fail UUID v4
-- validation — notably breaking the `showOnProfile` toggle on
-- subscription products because ParseUUIDPipe rejected them.
--
-- Content moved to `026_reseed_demo_data.sql` using
-- `gen_random_uuid()`. This file is a no-op so migration
-- history stays append-only.
-- =========================================================

SELECT 1;  -- no-op
