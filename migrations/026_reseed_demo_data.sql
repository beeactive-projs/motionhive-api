-- =========================================================
-- Migration 026: Reseed demo data (replaces 018, 021, 023)
-- =========================================================
-- Supersedes the three old seed migrations (018, 021, 023)
-- which used hand-written 36-char IDs that look like UUIDs
-- but fail v4 validation, breaking `ParseUUIDPipe` across the
-- whole API.
--
-- This migration provides a CURATED demo dataset — enough to
-- exercise every UI state in development without hundreds of
-- filler rows. Everything generated via `gen_random_uuid()`.
--
-- Contents:
--   • 6 test accounts (one per role) — you log in as these
--   • 1 demo group owned by the instructor
--   • 1 group membership (user joins the group)
--   • 2 scheduled sessions in that group
--   • 1 instructor_client relationship (user → instructor)
--
-- NOT included: Stripe Connect account / customer / products / invoices
--   / subscriptions. An earlier iteration seeded those with fake
--   `acct_demo_*` / `cus_demo_*` / `in_demo_*` ids and
--   `charges_enabled = TRUE`, which looked fine in the UI but made
--   every Stripe mutation 500 with "No such destination". Seed data
--   for Stripe must be REAL or absent — there's no middle ground.
--   To exercise payments, complete Stripe Connect onboarding through
--   the in-app flow as the seeded instructor; that creates real rows.
--
-- Test credentials:
--   superadmin@motionhive.fit / Test1234!
--   admin@motionhive.fit      / Test1234!
--   support@motionhive.fit    / Test1234!
--   instructor@motionhive.fit / Test1234!
--   writer@motionhive.fit     / Test1234!
--   user@motionhive.fit       / Test1234!
--
-- Idempotent: every INSERT is guarded by an existence check
-- inside the DO block so re-running the migration never
-- duplicates rows.
-- =========================================================

-- Local variables in the DO block are named `uid_*`, `rid_*`,
-- `gid_*`, `sid_*`, `pid_*`, `invid_*`, etc. so they can never
-- shadow an entity column like `user_id` or `instructor_id`.
DO $$
DECLARE
  -- Users (uid = "user id")
  uid_superadmin  CHAR(36);
  uid_admin       CHAR(36);
  uid_support     CHAR(36);
  uid_instructor  CHAR(36);
  uid_writer      CHAR(36);
  uid_user        CHAR(36);

  -- Role IDs (rid) — resolved by name so we're not coupled to the
  -- hardcoded UUIDs in migration 005.
  rid_superadmin CHAR(36);
  rid_admin      CHAR(36);
  rid_support    CHAR(36);
  rid_instructor CHAR(36);
  rid_writer     CHAR(36);
  rid_user       CHAR(36);

  -- Group / sessions (gid / sid)
  gid_demo  CHAR(36);
  sid_hiit  CHAR(36);
  sid_strength  CHAR(36);

  -- NOTE: No Stripe/payment fixtures are seeded here on purpose.
  -- A seeded `stripe_account` with `charges_enabled = TRUE` and a fake
  -- `acct_demo_...` id lies to the UI — the instructor looks onboarded
  -- but every Stripe API call 500s with "No such destination". Same
  -- goes for seeded `stripe_customer`, products with fake
  -- `stripe_product_id`, seeded invoices, etc. — they're hostile to
  -- the read-then-mutate flows in this codebase.
  -- To exercise the payments UI end-to-end, log in as the seeded
  -- instructor and complete Stripe Connect onboarding in-app. That
  -- creates a REAL `stripe_account` row that the rest of the system
  -- can actually call.

  -- Common bcrypt hash of 'Test1234!' used for all test accounts
  test_password_hash TEXT := '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu';
BEGIN
  -- =====================================================
  -- Resolve role IDs by name so the seed doesn't hardcode
  -- values from 005_seed_roles_permissions.sql.
  -- =====================================================
  SELECT id INTO rid_superadmin FROM role WHERE name = 'SUPER_ADMIN';
  SELECT id INTO rid_admin      FROM role WHERE name = 'ADMIN';
  SELECT id INTO rid_support    FROM role WHERE name = 'SUPPORT';
  SELECT id INTO rid_instructor FROM role WHERE name = 'INSTRUCTOR';
  SELECT id INTO rid_writer     FROM role WHERE name = 'WRITER';
  SELECT id INTO rid_user       FROM role WHERE name = 'USER';

  IF rid_user IS NULL THEN
    RAISE EXCEPTION 'Role seed (migration 005) has not run. Run all migrations from scratch.';
  END IF;

  -- =====================================================
  -- 1. USERS — six test accounts, one per role.
  --    Idempotent: if the email already exists we reuse that
  --    user's id and skip the INSERT + downstream rows.
  -- =====================================================

  -- superadmin
  SELECT id INTO uid_superadmin FROM "user" WHERE email = 'superadmin@motionhive.fit';
  IF uid_superadmin IS NULL THEN
    uid_superadmin := gen_random_uuid()::TEXT;
    INSERT INTO "user" (
      id, email, password_hash, first_name, last_name,
      language, timezone, is_active, is_email_verified,
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      uid_superadmin, 'superadmin@motionhive.fit', test_password_hash,
      'Super', 'Admin', 'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
    );
    INSERT INTO user_profile (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid()::TEXT, uid_superadmin, NOW(), NOW());
    INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at)
      VALUES (gen_random_uuid()::TEXT, uid_superadmin, rid_superadmin, NULL, NOW(), NULL);
  END IF;

  -- admin
  SELECT id INTO uid_admin FROM "user" WHERE email = 'admin@motionhive.fit';
  IF uid_admin IS NULL THEN
    uid_admin := gen_random_uuid()::TEXT;
    INSERT INTO "user" (
      id, email, password_hash, first_name, last_name,
      language, timezone, is_active, is_email_verified,
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      uid_admin, 'admin@motionhive.fit', test_password_hash,
      'Platform', 'Admin', 'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
    );
    INSERT INTO user_profile (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid()::TEXT, uid_admin, NOW(), NOW());
    INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at)
      VALUES (gen_random_uuid()::TEXT, uid_admin, rid_admin, NULL, NOW(), NULL);
  END IF;

  -- support
  SELECT id INTO uid_support FROM "user" WHERE email = 'support@motionhive.fit';
  IF uid_support IS NULL THEN
    uid_support := gen_random_uuid()::TEXT;
    INSERT INTO "user" (
      id, email, password_hash, first_name, last_name,
      language, timezone, is_active, is_email_verified,
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      uid_support, 'support@motionhive.fit', test_password_hash,
      'Support', 'Agent', 'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
    );
    INSERT INTO user_profile (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid()::TEXT, uid_support, NOW(), NOW());
    INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at)
      VALUES (gen_random_uuid()::TEXT, uid_support, rid_support, NULL, NOW(), NULL);
  END IF;

  -- instructor (gets INSTRUCTOR + USER roles + an instructor_profile)
  SELECT id INTO uid_instructor FROM "user" WHERE email = 'instructor@motionhive.fit';
  IF uid_instructor IS NULL THEN
    uid_instructor := gen_random_uuid()::TEXT;
    INSERT INTO "user" (
      id, email, password_hash, first_name, last_name,
      language, timezone, is_active, is_email_verified,
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      uid_instructor, 'instructor@motionhive.fit', test_password_hash,
      'Test', 'Instructor', 'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
    );
    INSERT INTO user_profile (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid()::TEXT, uid_instructor, NOW(), NOW());
    INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at)
      VALUES
        (gen_random_uuid()::TEXT, uid_instructor, rid_instructor, NULL, NOW(), NULL),
        (gen_random_uuid()::TEXT, uid_instructor, rid_user,       NULL, NOW(), NULL);
    INSERT INTO instructor_profile (
      id, user_id, display_name, bio,
      specializations, certifications,
      years_of_experience, is_accepting_clients,
      social_links, show_social_links, show_email, show_phone,
      location_city, location_country, is_public,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid()::TEXT, uid_instructor, 'Test Instructor',
      'Certified personal trainer and group fitness coach with 8 years of experience.',
      '["functional_training","strength_training","hiit","yoga","personal_training"]',
      '["NSCA-CPT","CrossFit Level 2 Trainer","RYT-200 Yoga Alliance"]',
      8, TRUE,
      '{"instagram":"@test_instructor_fit","youtube":"TestInstructorFit"}',
      TRUE, TRUE, FALSE,
      'București', 'RO', TRUE,
      NOW(), NOW()
    );
  END IF;

  -- writer
  SELECT id INTO uid_writer FROM "user" WHERE email = 'writer@motionhive.fit';
  IF uid_writer IS NULL THEN
    uid_writer := gen_random_uuid()::TEXT;
    INSERT INTO "user" (
      id, email, password_hash, first_name, last_name,
      language, timezone, is_active, is_email_verified,
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      uid_writer, 'writer@motionhive.fit', test_password_hash,
      'Content', 'Writer', 'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
    );
    INSERT INTO user_profile (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid()::TEXT, uid_writer, NOW(), NOW());
    INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at)
      VALUES
        (gen_random_uuid()::TEXT, uid_writer, rid_writer, NULL, NOW(), NULL),
        (gen_random_uuid()::TEXT, uid_writer, rid_user,   NULL, NOW(), NULL);
  END IF;

  -- user
  SELECT id INTO uid_user FROM "user" WHERE email = 'user@motionhive.fit';
  IF uid_user IS NULL THEN
    uid_user := gen_random_uuid()::TEXT;
    INSERT INTO "user" (
      id, email, password_hash, first_name, last_name,
      language, timezone, is_active, is_email_verified,
      failed_login_attempts, created_at, updated_at
    ) VALUES (
      uid_user, 'user@motionhive.fit', test_password_hash,
      'Test', 'User', 'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
    );
    INSERT INTO user_profile (id, user_id, created_at, updated_at)
      VALUES (gen_random_uuid()::TEXT, uid_user, NOW(), NOW());
    INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at)
      VALUES (gen_random_uuid()::TEXT, uid_user, rid_user, NULL, NOW(), NULL);
  END IF;

  -- =====================================================
  -- 2. DEMO GROUP — instructor owns it, user joins it.
  -- =====================================================
  SELECT id INTO gid_demo FROM "group" WHERE slug = 'motionhive-demo';
  IF gid_demo IS NULL THEN
    gid_demo := gen_random_uuid()::TEXT;
    INSERT INTO "group" (
      id, instructor_id, name, slug, description,
      is_active, is_public, join_policy,
      tags, contact_email, city, country,
      member_count, created_at, updated_at
    ) VALUES (
      gid_demo, uid_instructor,
      'MotionHive Demo Group',
      'motionhive-demo',
      'Demo training group for exercising instructor UI flows. Owned by the test instructor.',
      TRUE, TRUE, 'OPEN',
      '["hiit","strength","demo"]',
      'instructor@motionhive.fit',
      'București', 'RO',
      2, NOW(), NOW()
    );
    -- Instructor is owner member
    INSERT INTO group_member (id, group_id, user_id, is_owner, joined_at)
      VALUES (gen_random_uuid()::TEXT, gid_demo, uid_instructor, TRUE, NOW());
    -- User is a regular member
    INSERT INTO group_member (id, group_id, user_id, is_owner, joined_at)
      VALUES (gen_random_uuid()::TEXT, gid_demo, uid_user, FALSE, NOW());
  END IF;

  -- =====================================================
  -- 3. SESSIONS — two scheduled sessions in the demo group.
  -- =====================================================
  SELECT id INTO sid_hiit
    FROM session
   WHERE group_id = gid_demo
     AND title = 'HIIT Conditioning';
  IF sid_hiit IS NULL THEN
    sid_hiit := gen_random_uuid()::TEXT;
    INSERT INTO session (
      id, group_id, instructor_id,
      title, description, session_type, visibility,
      scheduled_at, duration_minutes,
      location, max_participants, price, currency,
      status, is_recurring, created_at, updated_at
    ) VALUES (
      sid_hiit, gid_demo, uid_instructor,
      'HIIT Conditioning',
      'High-intensity interval training — bring water and a towel.',
      'WORKSHOP', 'GROUP',
      NOW() + INTERVAL '3 days', 45,
      'Sala Alpha', 12, 50.00, 'RON',
      'SCHEDULED', FALSE, NOW(), NOW()
    );
  END IF;

  SELECT id INTO sid_strength
    FROM session
   WHERE group_id = gid_demo
     AND title = 'Strength Fundamentals';
  IF sid_strength IS NULL THEN
    sid_strength := gen_random_uuid()::TEXT;
    INSERT INTO session (
      id, group_id, instructor_id,
      title, description, session_type, visibility,
      scheduled_at, duration_minutes,
      location, max_participants, price, currency,
      status, is_recurring, created_at, updated_at
    ) VALUES (
      sid_strength, gid_demo, uid_instructor,
      'Strength Fundamentals',
      'Technique-focused strength session covering squat, deadlift, and press.',
      'WORKSHOP', 'GROUP',
      NOW() + INTERVAL '7 days', 60,
      'Sala Beta', 8, 80.00, 'RON',
      'SCHEDULED', FALSE, NOW(), NOW()
    );
    -- User is registered for the strength session
    INSERT INTO session_participant (id, session_id, user_id, status, created_at)
      VALUES (gen_random_uuid()::TEXT, sid_strength, uid_user, 'REGISTERED', NOW());
  END IF;

  -- =====================================================
  -- 4. INSTRUCTOR ↔ CLIENT — active relationship.
  -- =====================================================
  IF NOT EXISTS (
    SELECT 1 FROM instructor_client ic
     WHERE ic.instructor_id = uid_instructor
       AND ic.client_id     = uid_user
  ) THEN
    INSERT INTO instructor_client (
      id, instructor_id, client_id, status, initiated_by,
      notes, started_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid()::TEXT, uid_instructor, uid_user,
      'ACTIVE', 'INSTRUCTOR',
      'Demo active client relationship.',
      NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days', NOW()
    );
  END IF;

END $$;

-- =========================================================
-- Done — `SELECT COUNT(*) FROM "user" WHERE email LIKE
-- '%@motionhive.fit'` should return 6 after this runs.
-- =========================================================
