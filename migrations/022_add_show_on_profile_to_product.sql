-- =========================================================
-- Migration 022: Add show_on_profile flag to product
-- =========================================================
-- Lets an instructor choose which of their products are
-- visible on their public profile (listed under "Services").
-- Default false — existing products stay hidden until the
-- instructor explicitly toggles them on.
-- =========================================================

ALTER TABLE product
  ADD COLUMN IF NOT EXISTS show_on_profile BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_product_show_on_profile
  ON product (instructor_id, show_on_profile)
  WHERE show_on_profile = TRUE;
