-- Sprint 3: Auth Hardening
-- Adds password_changed_at column to user table for token invalidation

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
