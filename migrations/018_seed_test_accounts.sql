-- =========================================================
-- Migration 018: Seed Test Accounts (SUPERSEDED BY 026)
-- =========================================================
-- Original content generated users with hand-written 36-char
-- IDs like `test0001-0000-0000-0000-000000000001`. Those are
-- UUID-shaped but NOT valid UUID v4 (they fail the version
-- nibble check), which breaks every endpoint using
-- ParseUUIDPipe in NestJS.
--
-- Content moved to `026_reseed_demo_data.sql` where every ID
-- is produced by `gen_random_uuid()`. This file is now a
-- no-op kept in place so the migration history stays
-- append-only.
-- =========================================================

SELECT 1;  -- no-op
