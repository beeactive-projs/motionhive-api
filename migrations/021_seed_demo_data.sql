-- =========================================================
-- Migration 021: Seed Demo Data (SUPERSEDED BY 026)
-- =========================================================
-- Original content used hand-written IDs like
-- `a0000001-0000-0000-0000-000000000001` /
-- `b0000001-0000-0000-0000-000000000001` etc. that look like
-- UUIDs but fail v4 validation, breaking ParseUUIDPipe across
-- every endpoint that accepts those rows.
--
-- Content moved to `026_reseed_demo_data.sql` which uses
-- `gen_random_uuid()` for every row. This file is a no-op so
-- migration history stays append-only.
-- =========================================================

SELECT 1;  -- no-op
