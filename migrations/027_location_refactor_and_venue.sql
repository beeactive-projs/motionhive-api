-- 027_location_refactor_and_venue.sql
--
-- Location model refactor + introduce `venue` (where training happens).
--
-- Changes in this migration:
--   1. Drop `user_profile` table. It was a ghost — FitnessProfile fields
--      (DOB, height/weight, goals, medical, emergency contact) are not
--      consumed by any UI and have never shipped. If we revisit fitness
--      data, we'll design it intentionally.
--   2. Add `country_code` + `city` to `user`. This is the person's
--      location used for Stripe Connect onboarding and for display.
--      `country_code` is ISO 3166-1 alpha-2 (e.g. 'RO'), required before
--      Stripe onboarding but nullable in the DB so sign-up doesn't force
--      it. Service-layer validation enforces presence when it matters.
--   3. Drop `location_city` + `location_country` from `instructor_profile`.
--      The instructor's home address lives on `user`. Previously this
--      table duplicated it with a broken VARCHAR(5) country field.
--   4. Create `venue` — where an instructor delivers their service. 0..N
--      per instructor. Covers gyms, studios, parks, outdoor, client's
--      home, online. A session picks exactly one venue.
--   5. Add `venue_id` FK on `session`. Nullable for backwards
--      compatibility; existing free-text `session.location` column stays
--      so historical sessions keep displaying.

BEGIN;

-- 1) Drop user_profile (unused by FE, only backend plumbing)
DROP TABLE IF EXISTS user_profile;

-- 2) Person-level location on `user`
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS country_code CHAR(2) NULL,
  ADD COLUMN IF NOT EXISTS city         VARCHAR(100) NULL;

-- Belt-and-suspenders: country_code must be uppercase 2 letters if present.
ALTER TABLE "user"
  DROP CONSTRAINT IF EXISTS user_country_code_format;
ALTER TABLE "user"
  ADD CONSTRAINT user_country_code_format
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

-- 3) Strip location fields from instructor_profile (duplicate of `user`)
ALTER TABLE instructor_profile
  DROP COLUMN IF EXISTS location_city,
  DROP COLUMN IF EXISTS location_country;

-- 4) venue — where an instructor delivers their service
DO $$ BEGIN
  CREATE TYPE venue_kind AS ENUM (
    'GYM',
    'STUDIO',
    'PARK',
    'OUTDOOR',
    'CLIENT_HOME',
    'ONLINE',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE meeting_provider AS ENUM (
    'ZOOM',
    'GOOGLE_MEET',
    'TEAMS',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS venue (
  id                 CHAR(36)     PRIMARY KEY DEFAULT gen_random_uuid()::text,
  instructor_id      CHAR(36)     NOT NULL REFERENCES instructor_profile(id) ON DELETE CASCADE,

  kind               venue_kind   NOT NULL,
  is_online          BOOLEAN      NOT NULL DEFAULT FALSE,

  name               VARCHAR(160) NOT NULL,
  notes              TEXT         NULL,

  -- Physical (nullable when is_online=true or kind='CLIENT_HOME')
  line1              VARCHAR(255) NULL,
  line2              VARCHAR(255) NULL,
  city               VARCHAR(120) NULL,
  region             VARCHAR(120) NULL,
  postal_code        VARCHAR(20)  NULL,
  country_code       CHAR(2)      NULL,
  latitude           DECIMAL(9,6) NULL,
  longitude          DECIMAL(9,6) NULL,

  -- Online (only meaningful when is_online=true)
  meeting_url        TEXT             NULL,
  meeting_provider   meeting_provider NULL,

  -- Mobile trainer: only meaningful when kind='CLIENT_HOME'
  travel_radius_km   INTEGER      NULL,

  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  display_order      INTEGER      NULL,

  created_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMP    NULL,

  CONSTRAINT venue_country_code_format
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT venue_online_xor_physical
    CHECK (
      (is_online = TRUE  AND meeting_url IS NOT NULL)
      OR
      (is_online = FALSE)
    ),
  CONSTRAINT venue_travel_radius_non_negative
    CHECK (travel_radius_km IS NULL OR travel_radius_km >= 0)
);

CREATE INDEX IF NOT EXISTS idx_venue_instructor_active
  ON venue(instructor_id)
  WHERE deleted_at IS NULL AND is_active = TRUE;

-- 5) Session references a venue (nullable for backwards compatibility)
ALTER TABLE session
  ADD COLUMN IF NOT EXISTS venue_id CHAR(36) NULL REFERENCES venue(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_venue ON session(venue_id) WHERE venue_id IS NOT NULL;

COMMIT;
