-- 028_drop_blanket_instructor_client_unique.sql
--
-- Fix: re-inviting a previously archived client failed with
-- SequelizeUniqueConstraintError because the blanket UNIQUE
-- (instructor_id, client_id) from migration 007 still existed.
--
-- The intended constraint is the PARTIAL unique index from migration
-- 012 (`idx_instructor_client_unique`, only WHERE status = 'ACTIVE').
-- That allows multiple historical rows per pair as long as at most one
-- is ACTIVE — exactly what the service layer's `assertNoActiveRelationship`
-- already enforces.
--
-- Migration 012 layered the partial index on top but never dropped the
-- old blanket constraint, so both lived side by side.

ALTER TABLE instructor_client
  DROP CONSTRAINT IF EXISTS uk_instructor_client;
