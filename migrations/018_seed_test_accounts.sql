-- =========================================================
-- Migration 018: Seed Test Accounts (one per role)
-- =========================================================
-- Creates one verified account for each platform role for
-- testing role-specific endpoints in production/staging.
--
-- Credentials (email / password):
--   superadmin@motionhive.fit / Test1234!
--   admin@motionhive.fit      / Test1234!
--   support@motionhive.fit    / Test1234!
--   instructor@motionhive.fit / Test1234!
--   writer@motionhive.fit     / Test1234!
--   user@motionhive.fit       / Test1234!
--
-- IMPORTANT: Change these passwords immediately after use!
-- =========================================================

-- --------------------------------------------------------
-- Insert users
-- --------------------------------------------------------
INSERT INTO "user" (
  id, email, password_hash, first_name, last_name,
  language, timezone, is_active, is_email_verified,
  failed_login_attempts, created_at, updated_at
) VALUES
(
  'test0001-0000-0000-0000-000000000001',
  'superadmin@motionhive.fit',
  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu',
  'Super', 'Admin',
  'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
),
(
  'test0002-0000-0000-0000-000000000001',
  'admin@motionhive.fit',
  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu',
  'Platform', 'Admin',
  'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
),
(
  'test0003-0000-0000-0000-000000000001',
  'support@motionhive.fit',
  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu',
  'Support', 'Agent',
  'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
),
(
  'test0004-0000-0000-0000-000000000001',
  'instructor@motionhive.fit',
  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu',
  'Test', 'Instructor',
  'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
),
(
  'test0005-0000-0000-0000-000000000001',
  'writer@motionhive.fit',
  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu',
  'Content', 'Writer',
  'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
),
(
  'test0006-0000-0000-0000-000000000001',
  'user@motionhive.fit',
  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu',
  'Test', 'User',
  'en', 'Europe/Bucharest', TRUE, TRUE, 0, NOW(), NOW()
);

-- --------------------------------------------------------
-- Create user_profile rows (required by registration flow)
-- --------------------------------------------------------
INSERT INTO user_profile (id, user_id, created_at, updated_at)
VALUES
  (gen_random_uuid()::TEXT, 'test0001-0000-0000-0000-000000000001', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'test0002-0000-0000-0000-000000000001', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'test0003-0000-0000-0000-000000000001', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'test0004-0000-0000-0000-000000000001', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'test0005-0000-0000-0000-000000000001', NOW(), NOW()),
  (gen_random_uuid()::TEXT, 'test0006-0000-0000-0000-000000000001', NOW(), NOW());

-- --------------------------------------------------------
-- Assign roles
-- --------------------------------------------------------
INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at) VALUES
-- superadmin@motionhive.fit → SUPER_ADMIN
(gen_random_uuid()::TEXT, 'test0001-0000-0000-0000-000000000001', '7261bd94-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
-- admin@motionhive.fit → ADMIN
(gen_random_uuid()::TEXT, 'test0002-0000-0000-0000-000000000001', '7261d03c-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
-- support@motionhive.fit → SUPPORT
(gen_random_uuid()::TEXT, 'test0003-0000-0000-0000-000000000001', '7261d117-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
-- instructor@motionhive.fit → INSTRUCTOR (also needs USER role)
(gen_random_uuid()::TEXT, 'test0004-0000-0000-0000-000000000001', '7261d176-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
(gen_random_uuid()::TEXT, 'test0004-0000-0000-0000-000000000001', '7261d1cc-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
-- writer@motionhive.fit → WRITER (also needs USER role)
(gen_random_uuid()::TEXT, 'test0005-0000-0000-0000-000000000001', 'a1b2c3d4-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
(gen_random_uuid()::TEXT, 'test0005-0000-0000-0000-000000000001', '7261d1cc-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL),
-- user@motionhive.fit → USER
(gen_random_uuid()::TEXT, 'test0006-0000-0000-0000-000000000001', '7261d1cc-006c-11f1-b74f-0242ac110002', NULL, NOW(), NULL);

-- --------------------------------------------------------
-- Create instructor_profile for the instructor account
-- (required by instructor-specific endpoints)
-- --------------------------------------------------------
INSERT INTO instructor_profile (
  id, user_id, bio, specializations, certifications,
  years_of_experience, is_public, created_at, updated_at
) VALUES (
  gen_random_uuid()::TEXT,
  'test0004-0000-0000-0000-000000000001',
  'Test instructor account for endpoint testing.',
  '[]', '[]',
  0, FALSE, NOW(), NOW()
);

-- =========================================================
-- Test accounts seeded successfully
-- =========================================================
