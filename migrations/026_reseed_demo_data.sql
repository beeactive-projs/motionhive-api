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
--   • Stripe Connect + customer scaffolding for the instructor
--   • 2 products (one-off + subscription) on the instructor
--   • 1 active subscription (user ↔ instructor's subscription product)
--   • 2 invoices (paid + open) demonstrating both states
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

  -- Payments (pid = product id, invid = invoice id, etc.)
  pay_stripe_account   CHAR(36);
  pay_stripe_customer  CHAR(36);
  pid_oneoff   CHAR(36);
  pid_sub      CHAR(36);
  subid_demo   CHAR(36);
  invid_paid   CHAR(36);
  invid_open   CHAR(36);

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

  -- =====================================================
  -- 5. PAYMENTS — Stripe Connect scaffolding for the
  --    instructor, one customer for the client, 2 products,
  --    1 subscription, 2 invoices.
  --
  --    The Stripe IDs (`acct_demo_...`, `cus_demo_...`,
  --    `prod_demo_...`, `price_demo_...`, `in_demo_...`,
  --    `sub_demo_...`) are fake — they don't exist on Stripe
  --    servers. That means:
  --      ✓ You can SEE this data in lists / tables.
  --      ✗ Mutations (send invoice, cancel sub, pay invoice)
  --        will fail because Stripe returns 404 for the fake
  --        IDs. That's expected for pre-Stripe-onboarded demo
  --        data — to test real mutations, complete the Stripe
  --        Connect onboarding flow inside the app.
  -- =====================================================

  -- Stripe Connect account for the instructor
  SELECT id INTO pay_stripe_account
    FROM stripe_account sa
   WHERE sa.user_id = uid_instructor;
  IF pay_stripe_account IS NULL THEN
    pay_stripe_account := gen_random_uuid()::TEXT;
    INSERT INTO stripe_account (
      id, user_id, stripe_account_id,
      charges_enabled, payouts_enabled, details_submitted,
      country, default_currency, platform_fee_bps,
      onboarding_completed_at, created_at, updated_at
    ) VALUES (
      pay_stripe_account, uid_instructor,
      'acct_demo_instructor_0001',
      TRUE, TRUE, TRUE,
      'RO', 'ron', 0,
      NOW() - INTERVAL '30 days',
      NOW() - INTERVAL '30 days', NOW()
    );
  END IF;

  -- Stripe customer for the client user
  SELECT id INTO pay_stripe_customer
    FROM stripe_customer sc
   WHERE sc.user_id = uid_user;
  IF pay_stripe_customer IS NULL THEN
    pay_stripe_customer := gen_random_uuid()::TEXT;
    INSERT INTO stripe_customer (
      id, user_id, stripe_customer_id,
      email, name,
      created_at, updated_at
    ) VALUES (
      pay_stripe_customer, uid_user,
      'cus_demo_test_user_0001',
      'user@motionhive.fit', 'Test User',
      NOW() - INTERVAL '20 days', NOW()
    );
  END IF;

  -- Products (one-off personal training + monthly subscription)
  SELECT id INTO pid_oneoff
    FROM product p
   WHERE p.instructor_id = uid_instructor
     AND p.name = 'Single PT session';
  IF pid_oneoff IS NULL THEN
    pid_oneoff := gen_random_uuid()::TEXT;
    INSERT INTO product (
      id, instructor_id, name, description, type,
      amount_cents, currency,
      stripe_product_id, stripe_price_id,
      is_active, show_on_profile,
      created_at, updated_at
    ) VALUES (
      pid_oneoff, uid_instructor,
      'Single PT session',
      '60-minute one-on-one personal training session.',
      'ONE_OFF',
      15000, 'RON',
      'prod_demo_oneoff_0001', 'price_demo_oneoff_0001',
      TRUE, TRUE,
      NOW() - INTERVAL '25 days', NOW()
    );
  END IF;

  SELECT id INTO pid_sub
    FROM product p
   WHERE p.instructor_id = uid_instructor
     AND p.name = 'Monthly membership';
  IF pid_sub IS NULL THEN
    pid_sub := gen_random_uuid()::TEXT;
    INSERT INTO product (
      id, instructor_id, name, description, type,
      amount_cents, currency,
      interval, interval_count,
      stripe_product_id, stripe_price_id,
      is_active, show_on_profile,
      created_at, updated_at
    ) VALUES (
      pid_sub, uid_instructor,
      'Monthly membership',
      'Unlimited group classes for a month.',
      'SUBSCRIPTION',
      24000, 'RON',
      'month', 1,
      'prod_demo_sub_0001', 'price_demo_sub_0001',
      TRUE, TRUE,
      NOW() - INTERVAL '25 days', NOW()
    );
  END IF;

  -- Active subscription: user pays the monthly membership
  IF NOT EXISTS (
    SELECT 1 FROM subscription s
     WHERE s.instructor_id = uid_instructor
       AND s.client_id     = uid_user
       AND s.product_id    = pid_sub
  ) THEN
    subid_demo := gen_random_uuid()::TEXT;
    INSERT INTO subscription (
      id, instructor_id, client_id,
      stripe_customer_id, product_id,
      stripe_subscription_id, stripe_price_id,
      status, currency, amount_cents,
      current_period_start, current_period_end,
      cancel_at_period_end,
      created_at, updated_at
    ) VALUES (
      subid_demo, uid_instructor, uid_user,
      'cus_demo_test_user_0001', pid_sub,
      'sub_demo_active_0001', 'price_demo_sub_0001',
      'active', 'RON', 24000,
      NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days',
      FALSE,
      NOW() - INTERVAL '10 days', NOW()
    );
  END IF;

  -- Paid invoice (showcases "Paid in full" state)
  IF NOT EXISTS (
    SELECT 1 FROM invoice i
     WHERE i.instructor_id     = uid_instructor
       AND i.stripe_invoice_id = 'in_demo_paid_0001'
  ) THEN
    invid_paid := gen_random_uuid()::TEXT;
    INSERT INTO invoice (
      id, instructor_id, client_id,
      stripe_customer_id, stripe_invoice_id,
      number, status,
      amount_due_cents, amount_paid_cents, amount_remaining_cents,
      currency, application_fee_cents,
      due_date, finalized_at, paid_at,
      hosted_invoice_url, invoice_pdf,
      paid_out_of_band, description,
      created_at, updated_at
    ) VALUES (
      invid_paid, uid_instructor, uid_user,
      'cus_demo_test_user_0001', 'in_demo_paid_0001',
      'MH-DEMO-0001', 'paid',
      15000, 15000, 0,
      'RON', 0,
      NOW() - INTERVAL '3 days',
      NOW() - INTERVAL '5 days',
      NOW() - INTERVAL '3 days',
      NULL, NULL,
      FALSE, 'Single PT session — first demo invoice',
      NOW() - INTERVAL '5 days', NOW()
    );
  END IF;

  -- Open invoice (showcases "Awaiting payment" state)
  IF NOT EXISTS (
    SELECT 1 FROM invoice i
     WHERE i.instructor_id     = uid_instructor
       AND i.stripe_invoice_id = 'in_demo_open_0001'
  ) THEN
    invid_open := gen_random_uuid()::TEXT;
    INSERT INTO invoice (
      id, instructor_id, client_id,
      stripe_customer_id, stripe_invoice_id,
      number, status,
      amount_due_cents, amount_paid_cents, amount_remaining_cents,
      currency, application_fee_cents,
      due_date, finalized_at,
      hosted_invoice_url,
      paid_out_of_band, description,
      requires_immediate_access_waiver,
      created_at, updated_at
    ) VALUES (
      invid_open, uid_instructor, uid_user,
      'cus_demo_test_user_0001', 'in_demo_open_0001',
      'MH-DEMO-0002', 'open',
      20000, 0, 20000,
      'RON', 0,
      NOW() + INTERVAL '7 days',
      NOW() - INTERVAL '1 day',
      'https://invoice.stripe.com/demo/open-0001',
      FALSE, 'Second demo invoice — open for payment',
      TRUE,
      NOW() - INTERVAL '1 day', NOW()
    );
  END IF;

END $$;

-- =========================================================
-- Done — `SELECT COUNT(*) FROM "user" WHERE email LIKE
-- '%@motionhive.fit'` should return 6 after this runs.
-- =========================================================
