-- =========================================================
-- Migration 021: Seed Demo Data (20 records per table)
-- =========================================================
-- Creates realistic fitness-platform data linked to the
-- existing test accounts (migration 018).
--
-- Anchor accounts (already in DB from migration 018):
--   test0004 = instructor@motionhive.fit  ← owns all groups & sessions
--   test0006 = user@motionhive.fit        ← primary client / member
--   test0001 = superadmin@motionhive.fit
--   test0002 = admin@motionhive.fit
--   test0003 = support@motionhive.fit
--   test0005 = writer@motionhive.fit
--
-- Supporting cast (newly created):
--   20 users  : a000000N-0000-0000-0000-000000000001
--   Used as extra members, participants, and clients.
--
-- ID namespaces:
--   new users  : a000000N-0000-0000-0000-000000000001
--   groups     : b000000N-0000-0000-0000-000000000001
--   sessions   : c000000N-0000-0000-0000-000000000001
--
-- All new user passwords = Test1234!
-- =========================================================

-- =========================================================
-- 1. USERS (20 supporting users — no test accounts re-inserted)
-- =========================================================
INSERT INTO "user" (
  id, email, password_hash, first_name, last_name,
  language, timezone, is_active, is_email_verified,
  failed_login_attempts, last_login_at, created_at, updated_at
) VALUES
('a0000001-0000-0000-0000-000000000001','mihai.pop@example.com',       '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Mihai',    'Pop',        'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '2 days', NOW() - INTERVAL '90 days',NOW()),
('a0000002-0000-0000-0000-000000000001','ana.ionescu@example.com',      '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Ana',      'Ionescu',    'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 day',  NOW() - INTERVAL '80 days',NOW()),
('a0000003-0000-0000-0000-000000000001','radu.dumitrescu@example.com',  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Radu',     'Dumitrescu', 'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '3 days', NOW() - INTERVAL '70 days',NOW()),
('a0000004-0000-0000-0000-000000000001','elena.stoica@example.com',     '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Elena',    'Stoica',     'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '5 hours',NOW() - INTERVAL '60 days',NOW()),
('a0000005-0000-0000-0000-000000000001','bogdan.constantin@example.com','$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Bogdan',   'Constantin', 'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 hour', NOW() - INTERVAL '50 days',NOW()),
('a0000006-0000-0000-0000-000000000001','maria.popa@example.com',       '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Maria',    'Popa',       'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 day',  NOW() - INTERVAL '45 days',NOW()),
('a0000007-0000-0000-0000-000000000001','ion.georgescu@example.com',    '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Ion',      'Georgescu',  'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '2 days', NOW() - INTERVAL '40 days',NOW()),
('a0000008-0000-0000-0000-000000000001','cristina.dima@example.com',    '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Cristina', 'Dima',       'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '4 hours',NOW() - INTERVAL '35 days',NOW()),
('a0000009-0000-0000-0000-000000000001','alex.barbu@example.com',       '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Alexandru','Barbu',      'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '6 hours',NOW() - INTERVAL '30 days',NOW()),
('a0000010-0000-0000-0000-000000000001','ioana.lungu@example.com',      '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Ioana',    'Lungu',      'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 day',  NOW() - INTERVAL '28 days',NOW()),
('a0000011-0000-0000-0000-000000000001','stefan.niculescu@example.com', '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Stefan',   'Niculescu',  'en','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '3 days', NOW() - INTERVAL '25 days',NOW()),
('a0000012-0000-0000-0000-000000000001','laura.matei@example.com',      '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Laura',    'Matei',      'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '2 hours',NOW() - INTERVAL '22 days',NOW()),
('a0000013-0000-0000-0000-000000000001','andrei.florescu@example.com',  '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Andrei',   'Florescu',   'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 day',  NOW() - INTERVAL '20 days',NOW()),
('a0000014-0000-0000-0000-000000000001','camelia.radu@example.com',     '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Camelia',  'Radu',       'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '5 days', NOW() - INTERVAL '18 days',NOW()),
('a0000015-0000-0000-0000-000000000001','vlad.mocanu@example.com',      '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Vlad',     'Mocanu',     'en','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 hour', NOW() - INTERVAL '15 days',NOW()),
('a0000016-0000-0000-0000-000000000001','diana.tanase@example.com',     '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Diana',    'Tanase',     'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '2 days', NOW() - INTERVAL '12 days',NOW()),
('a0000017-0000-0000-0000-000000000001','cosmin.dobre@example.com',     '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Cosmin',   'Dobre',      'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '3 hours',NOW() - INTERVAL '10 days',NOW()),
('a0000018-0000-0000-0000-000000000001','alina.stanescu@example.com',   '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Alina',    'Stanescu',   'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '1 day',  NOW() - INTERVAL '8 days', NOW()),
('a0000019-0000-0000-0000-000000000001','razvan.oprea@example.com',     '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Razvan',   'Oprea',      'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '4 days', NOW() - INTERVAL '5 days', NOW()),
('a0000020-0000-0000-0000-000000000001','simona.zaharia@example.com',   '$2b$12$41I8q54Ve0JxdHOeN66K/OimQyOE5.nex.oCGoAU1xcTGIGt8MKCu','Simona',   'Zaharia',    'ro','Europe/Bucharest',TRUE,TRUE,0,NOW() - INTERVAL '6 hours',NOW() - INTERVAL '3 days', NOW())
ON CONFLICT (email) DO NOTHING;

-- =========================================================
-- 2. USER_ROLES (for new users only — test accounts already have roles)
-- =========================================================
INSERT INTO user_role (id, user_id, role_id, group_id, assigned_at, expires_at) VALUES
-- a0000001–a0000005 get USER role only (they exist as background members, not platform instructors)
(gen_random_uuid()::TEXT,'a0000001-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000002-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000003-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000004-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000005-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000006-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000007-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000008-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000009-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000010-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000011-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000012-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000013-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000014-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000015-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000016-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000017-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000018-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000019-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL),
(gen_random_uuid()::TEXT,'a0000020-0000-0000-0000-000000000001','7261d1cc-006c-11f1-b74f-0242ac110002',NULL,NOW(),NULL)
ON CONFLICT (user_id, role_id, group_id) DO NOTHING;

-- =========================================================
-- 3. USER_PROFILES
--    - New rows only for a000000X users
--    - test0001–test0006 already have profiles from migration 018
-- =========================================================
INSERT INTO user_profile (
  id, user_id, date_of_birth, gender, height_cm, weight_kg,
  fitness_level, goals, medical_conditions,
  emergency_contact_name, emergency_contact_phone,
  created_at, updated_at
) VALUES
(gen_random_uuid()::TEXT,'a0000001-0000-0000-0000-000000000001','1988-03-15','MALE',  178.0,75.5, 'ADVANCED',    '["strength","flexibility"]','[]',             'Ioana Pop',      '0721100001',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000002-0000-0000-0000-000000000001','1991-07-22','FEMALE',165.0,58.0, 'ADVANCED',    '["endurance","weight_loss"]','[]',            'Petre Ionescu',  '0721100002',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000003-0000-0000-0000-000000000001','1985-11-08','MALE',  182.0,83.0, 'ADVANCED',    '["strength","swimming"]',  '[]',             'Mihaela D.',     '0721100003',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000004-0000-0000-0000-000000000001','1993-04-30','FEMALE',162.0,55.0, 'ADVANCED',    '["flexibility","dance"]',  '[]',             'Gheorghe Stoica','0721100004',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000005-0000-0000-0000-000000000001','1987-09-12','MALE',  180.0,88.0, 'ADVANCED',    '["muscle_gain","strength"]','[]',            'Roxana C.',      '0721100005',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000006-0000-0000-0000-000000000001','1995-01-25','FEMALE',167.0,62.0, 'BEGINNER',    '["weight_loss","wellness"]','[]',            'Victor Popa',    '0721100006',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000007-0000-0000-0000-000000000001','1990-06-18','MALE',  175.0,80.0, 'INTERMEDIATE','["endurance","general"]',  '["mild_hypertension"]','Elena G.','0721100007',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000008-0000-0000-0000-000000000001','1997-03-07','FEMALE',160.0,54.0, 'BEGINNER',    '["flexibility","wellness"]','[]',            'Mihai Dima',     '0721100008',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000009-0000-0000-0000-000000000001','1992-12-14','MALE',  184.0,90.0, 'INTERMEDIATE','["strength","muscle_gain"]','[]',            'Lidia Barbu',    '0721100009',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000010-0000-0000-0000-000000000001','1999-08-03','FEMALE',163.0,57.0, 'BEGINNER',    '["weight_loss","energy"]',  '[]',            'Dan Lungu',      '0721100010',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000011-0000-0000-0000-000000000001','1986-05-20','MALE',  179.0,82.0, 'INTERMEDIATE','["endurance","cycling"]',  '["asthma"]',     'Raluca N.',      '0721100011',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000012-0000-0000-0000-000000000001','1994-10-11','FEMALE',168.0,61.0, 'INTERMEDIATE','["flexibility","pilates"]', '[]',            'Bogdan Matei',   '0721100012',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000013-0000-0000-0000-000000000001','1998-02-28','MALE',  176.0,73.0, 'BEGINNER',    '["general","wellness"]',   '[]',             'Anca Florescu',  '0721100013',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000014-0000-0000-0000-000000000001','1989-07-16','FEMALE',164.0,59.0, 'INTERMEDIATE','["weight_loss","yoga"]',    '[]',            'Adrian Radu',    '0721100014',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000015-0000-0000-0000-000000000001','1996-11-04','MALE',  181.0,85.0, 'INTERMEDIATE','["strength","sports"]',    '[]',             'Daniela M.',     '0721100015',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000016-0000-0000-0000-000000000001','2000-04-09','FEMALE',166.0,56.0, 'BEGINNER',    '["dance","flexibility"]',  '[]',             'Mihai Tanase',   '0721100016',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000017-0000-0000-0000-000000000001','1991-08-27','MALE',  177.0,79.0, 'INTERMEDIATE','["muscle_gain","crossfit"]','[]',            'Ioana D.',       '0721100017',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000018-0000-0000-0000-000000000001','1993-01-19','FEMALE',169.0,63.0, 'BEGINNER',    '["wellness","yoga"]',       '["lower_back_pain"]','Florin S.','0721100018',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000019-0000-0000-0000-000000000001','1988-09-05','MALE',  183.0,87.0, 'INTERMEDIATE','["endurance","running"]',  '[]',             'Cristina O.',    '0721100019',NOW(),NOW()),
(gen_random_uuid()::TEXT,'a0000020-0000-0000-0000-000000000001','1997-12-23','FEMALE',161.0,55.0, 'BEGINNER',    '["weight_loss","dance"]',   '[]',            'George Z.',      '0721100020',NOW(),NOW())
ON CONFLICT (user_id) DO NOTHING;

-- =========================================================
-- 4. INSTRUCTOR_PROFILE — enrich test0004's existing row
--    (inserted with minimal data in migration 018)
-- =========================================================
UPDATE instructor_profile SET
  display_name          = 'Test Instructor',
  specializations       = '["functional_training","strength_training","hiit","yoga","personal_training"]',
  bio                   = 'Certified personal trainer and group fitness coach with 8 years of experience. I work with clients of all levels — from first-timers to competitive athletes — helping them build strength, move better, and enjoy the process. My sessions combine evidence-based programming with a supportive community atmosphere.',
  certifications        = '["NSCA-CPT","CrossFit Level 2 Trainer","RYT-200 Yoga Alliance","Precision Nutrition L1","First Aid & CPR"]',
  years_of_experience   = 8,
  is_accepting_clients  = TRUE,
  social_links          = '{"instagram":"@test_instructor_fit","youtube":"TestInstructorFit"}',
  show_social_links     = TRUE,
  show_email            = TRUE,
  show_phone            = FALSE,
  location_city         = 'București',
  location_country      = 'RO',
  is_public             = TRUE,
  updated_at            = NOW()
WHERE user_id = 'test0004-0000-0000-0000-000000000001';

-- =========================================================
-- 5. GROUPS (10 — all owned by test0004 / instructor@motionhive.fit)
-- =========================================================
INSERT INTO "group" (
  id, instructor_id, name, slug, description,
  is_active, is_public, join_policy,
  tags, contact_email, city, country,
  member_count, created_at, updated_at
) VALUES
('b0000001-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Functional Fitness București','functional-fitness-bucuresti',
  'A community for people who want to move well and get stronger. Twice-weekly group sessions blending strength, mobility, and conditioning.',
  TRUE,TRUE,'OPEN',
  '["functional","strength","conditioning"]','instructor@motionhive.fit','București','RO',
  9, NOW() - INTERVAL '85 days',NOW()),

('b0000002-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Morning HIIT Club','morning-hiit-club',
  'Early-morning high-intensity interval training, Monday to Friday at 07:00. No equipment needed — just energy.',
  TRUE,TRUE,'OPEN',
  '["hiit","cardio","morning","fat_loss"]','instructor@motionhive.fit','București','RO',
  7, NOW() - INTERVAL '70 days',NOW()),

('b0000003-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Strength Foundations','strength-foundations',
  'Beginner-friendly barbell strength program. We learn the squat, bench, and deadlift safely with 3x/week sessions and optional open gym.',
  TRUE,TRUE,'INVITE_ONLY',
  '["strength","powerlifting","beginners"]','instructor@motionhive.fit','București','RO',
  6, NOW() - INTERVAL '60 days',NOW()),

('b0000004-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Yoga & Mindfulness','yoga-and-mindfulness',
  'Weekly yoga flow and guided meditation sessions. All levels welcome. Blocks and straps provided. Sundays at 10:00.',
  TRUE,TRUE,'OPEN',
  '["yoga","mindfulness","flexibility","stress_relief"]','instructor@motionhive.fit','București','RO',
  11, NOW() - INTERVAL '75 days',NOW()),

('b0000005-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Online Training Hub','online-training-hub',
  'Live-streamed sessions accessible from anywhere. Library of recorded workouts included. Perfect for members who travel.',
  TRUE,TRUE,'OPEN',
  '["online","home_workout","flexibility"]','instructor@motionhive.fit',NULL,NULL,
  15, NOW() - INTERVAL '55 days',NOW()),

('b0000006-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Core & Mobility Program','core-and-mobility-program',
  'Targeted core strengthening and joint mobility work. 45-minute sessions, 3x per week. Great for desk workers and athletes alike.',
  TRUE,TRUE,'OPEN',
  '["core","mobility","rehabilitation","posture"]','instructor@motionhive.fit','București','RO',
  8, NOW() - INTERVAL '50 days',NOW()),

('b0000007-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Weekend Warriors','weekend-warriors',
  'Saturday and Sunday sessions for busy professionals. A mix of strength, conditioning, and outdoor workouts when weather permits.',
  TRUE,TRUE,'OPEN',
  '["weekend","conditioning","outdoor","community"]','instructor@motionhive.fit','București','RO',
  13, NOW() - INTERVAL '45 days',NOW()),

('b0000008-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Women-Only Fitness Group','women-only-fitness',
  'A safe, supportive space for women of all ages and fitness levels. Focus on strength, confidence, and community.',
  TRUE,TRUE,'INVITE_ONLY',
  '["women","strength","community","empowerment"]','instructor@motionhive.fit','București','RO',
  5, NOW() - INTERVAL '35 days',NOW()),

('b0000009-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Run Club București','run-club-bucuresti',
  'Weekly group runs in Parcul Herăstrău: 5K fun runs for beginners and longer intervals for experienced runners.',
  TRUE,TRUE,'OPEN',
  '["running","cardio","outdoor","community"]','instructor@motionhive.fit','București','RO',
  10, NOW() - INTERVAL '30 days',NOW()),

('b0000010-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Premium PT Clients','premium-pt-clients',
  'Exclusive group for personal training clients. Includes access to custom programming, weekly check-ins, and nutrition guidance.',
  TRUE,FALSE,'INVITE_ONLY',
  '["personal_training","premium","nutrition","accountability"]','instructor@motionhive.fit','București','RO',
  4, NOW() - INTERVAL '20 days',NOW())
ON CONFLICT (slug) DO NOTHING;

-- =========================================================
-- 6. GROUP_MEMBERS (20 memberships)
--    test0006 is a member of several groups
--    a000000X users fill the rest
-- =========================================================
INSERT INTO group_member (id, group_id, user_id, is_owner, shared_health_info, joined_at) VALUES
-- functional-fitness-bucuresti (b1)
(gen_random_uuid()::TEXT,'b0000001-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001',FALSE,TRUE, NOW() - INTERVAL '80 days'),
(gen_random_uuid()::TEXT,'b0000001-0000-0000-0000-000000000001','a0000006-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '72 days'),
(gen_random_uuid()::TEXT,'b0000001-0000-0000-0000-000000000001','a0000009-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '65 days'),
-- morning-hiit-club (b2)
(gen_random_uuid()::TEXT,'b0000002-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '65 days'),
(gen_random_uuid()::TEXT,'b0000002-0000-0000-0000-000000000001','a0000007-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '60 days'),
-- strength-foundations (b3)
(gen_random_uuid()::TEXT,'b0000003-0000-0000-0000-000000000001','a0000009-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '55 days'),
(gen_random_uuid()::TEXT,'b0000003-0000-0000-0000-000000000001','a0000015-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '50 days'),
-- yoga-and-mindfulness (b4)
(gen_random_uuid()::TEXT,'b0000004-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001',FALSE,TRUE, NOW() - INTERVAL '70 days'),
(gen_random_uuid()::TEXT,'b0000004-0000-0000-0000-000000000001','a0000008-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '68 days'),
(gen_random_uuid()::TEXT,'b0000004-0000-0000-0000-000000000001','a0000014-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '55 days'),
-- online-training-hub (b5)
(gen_random_uuid()::TEXT,'b0000005-0000-0000-0000-000000000001','a0000010-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '50 days'),
(gen_random_uuid()::TEXT,'b0000005-0000-0000-0000-000000000001','a0000013-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '45 days'),
-- core-and-mobility (b6)
(gen_random_uuid()::TEXT,'b0000006-0000-0000-0000-000000000001','a0000012-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '45 days'),
(gen_random_uuid()::TEXT,'b0000006-0000-0000-0000-000000000001','a0000018-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '40 days'),
-- weekend-warriors (b7)
(gen_random_uuid()::TEXT,'b0000007-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '40 days'),
(gen_random_uuid()::TEXT,'b0000007-0000-0000-0000-000000000001','a0000011-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '38 days'),
-- run-club (b9)
(gen_random_uuid()::TEXT,'b0000009-0000-0000-0000-000000000001','a0000019-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '28 days'),
-- premium-pt-clients (b10)
(gen_random_uuid()::TEXT,'b0000010-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001',FALSE,TRUE, NOW() - INTERVAL '18 days'),
(gen_random_uuid()::TEXT,'b0000010-0000-0000-0000-000000000001','a0000015-0000-0000-0000-000000000001',FALSE,TRUE, NOW() - INTERVAL '15 days'),
(gen_random_uuid()::TEXT,'b0000010-0000-0000-0000-000000000001','a0000017-0000-0000-0000-000000000001',FALSE,FALSE,NOW() - INTERVAL '10 days')
ON CONFLICT (group_id, user_id) DO NOTHING;

-- =========================================================
-- 7. SESSIONS (20 — all by test0004 / instructor@motionhive.fit)
-- =========================================================
INSERT INTO session (
  id, group_id, instructor_id, title, description,
  session_type, visibility, scheduled_at, duration_minutes,
  location, max_participants, price, currency,
  status, is_recurring, created_at, updated_at
) VALUES
-- Past COMPLETED sessions
('c0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Functional Fitness — Intro Class',
  'Assessment session: movement screening, goal-setting, and a sampler workout to gauge current fitness.',
  'GROUP','PUBLIC',NOW() - INTERVAL '14 days',60,
  'Sala Fitness, Str. Florilor 12, București',15,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '20 days',NOW()),

('c0000002-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Functional Fitness — Push & Pull Day',
  'Upper body focus: push-ups, rows, overhead press, and farmer carries. Scale options for all levels.',
  'GROUP','PUBLIC',NOW() - INTERVAL '11 days',60,
  'Sala Fitness, Str. Florilor 12, București',15,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '15 days',NOW()),

('c0000003-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Morning HIIT — Full Body Tabata',
  '8 rounds of 20/10 Tabata across 6 exercises. Expect sweat.',
  'GROUP','PUBLIC',NOW() - INTERVAL '9 days',45,
  'Outdoor — Parcul Tineretului, intrarea nord',30,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '12 days',NOW()),

('c0000004-0000-0000-0000-000000000001','b0000003-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Strength Foundations — Squat Technique',
  'Deep dive into squat mechanics: stance, depth, bracing, and common faults. Every rep filmed for form check.',
  'GROUP','CLIENTS',NOW() - INTERVAL '7 days',75,
  'FitPower Gym, Str. Costache Negri 11, București',8,120.00,'RON','COMPLETED',FALSE,NOW() - INTERVAL '10 days',NOW()),

('c0000005-0000-0000-0000-000000000001','b0000004-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Yoga Flow — Hip Opening Sequence',
  'A 60-minute practice targeting the hips and lower back using yin-inspired holds and vinyasa flow.',
  'GROUP','PUBLIC',NOW() - INTERVAL '6 days',60,
  'Studio Zen, Bd. Unirii 45, București',12,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '9 days',NOW()),

('c0000006-0000-0000-0000-000000000001',NULL,'test0004-0000-0000-0000-000000000001',
  'Private Session — Test User (Goal Setting)',
  'One-on-one kickoff: goals review, movement assessment, and first week of programming delivered.',
  'ONE_ON_ONE','PRIVATE',NOW() - INTERVAL '5 days',60,
  'Studio 1, Str. Mioriței 4, București',1,250.00,'RON','COMPLETED',FALSE,NOW() - INTERVAL '7 days',NOW()),

('c0000007-0000-0000-0000-000000000001','b0000005-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Online Training — Live HIIT Drop-In',
  'No equipment 40-minute HIIT. Just a mat and your bodyweight.',
  'ONLINE','PUBLIC',NOW() - INTERVAL '4 days',40,NULL,50,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '6 days',NOW()),

('c0000008-0000-0000-0000-000000000001','b0000006-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Core & Mobility — Lower Back Reset',
  'Decompression and activation routine for the lumbar spine. Suitable for anyone with desk-job tension.',
  'GROUP','PUBLIC',NOW() - INTERVAL '3 days',45,
  'Sala Fitness, Str. Florilor 12, București',10,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '5 days',NOW()),

('c0000009-0000-0000-0000-000000000001','b0000007-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Weekend Warriors — Partner WOD',
  'Team workout: pairs share the reps. Burpees, kettlebell swings, box jumps, and rowing.',
  'GROUP','PUBLIC',NOW() - INTERVAL '2 days',75,
  'Outdoor — Parcul Herăstrău, Poiana Mare',20,NULL,'RON','COMPLETED',FALSE,NOW() - INTERVAL '4 days',NOW()),

('c0000010-0000-0000-0000-000000000001','b0000008-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Women-Only — Strength Confidence Workshop',
  'Introduction to barbells and resistance training in a safe, supportive environment.',
  'WORKSHOP','CLIENTS',NOW() - INTERVAL '1 day',120,
  'FitPower Gym, Str. Costache Negri 11, București',8,180.00,'RON','COMPLETED',FALSE,NOW() - INTERVAL '3 days',NOW()),

-- IN_PROGRESS
('c0000011-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Functional Fitness — Legs & Core',
  'Squats, lunges, deadlifts, and plank variations. 60 minutes of lower-body work.',
  'GROUP','PUBLIC',NOW() - INTERVAL '20 minutes',60,
  'Sala Fitness, Str. Florilor 12, București',15,NULL,'RON','IN_PROGRESS',FALSE,NOW() - INTERVAL '1 day',NOW()),

-- Future SCHEDULED sessions
('c0000012-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Morning HIIT — Cardio Intervals',
  '30/30 work-to-rest intervals across 5 stations. Doubles as cardio and lactate threshold training.',
  'GROUP','PUBLIC',NOW() + INTERVAL '1 day',45,
  'Outdoor — Parcul Tineretului',30,NULL,'RON','SCHEDULED',TRUE,NOW(),NOW()),

('c0000013-0000-0000-0000-000000000001','b0000003-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Strength Foundations — Deadlift Day',
  'Romanian deadlift, conventional pull, and accessory work: hip hinges and back extensions.',
  'GROUP','CLIENTS',NOW() + INTERVAL '2 days',75,
  'FitPower Gym, Str. Costache Negri 11, București',8,120.00,'RON','SCHEDULED',FALSE,NOW(),NOW()),

('c0000014-0000-0000-0000-000000000001','b0000004-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Yoga Flow — Sunday Restore',
  'Slow-flow yoga with long holds. Ideal after a heavy training week. Ends with a 10-minute yoga nidra.',
  'GROUP','PUBLIC',NOW() + INTERVAL '3 days',75,
  'Studio Zen, Bd. Unirii 45, București',12,NULL,'RON','SCHEDULED',TRUE,NOW(),NOW()),

('c0000015-0000-0000-0000-000000000001','b0000005-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Online Training — Upper Body Strength',
  'Resistance band and dumbbell workout: chest, back, and shoulders.',
  'ONLINE','PUBLIC',NOW() + INTERVAL '1 day',50,NULL,50,NULL,'RON','SCHEDULED',TRUE,NOW(),NOW()),

('c0000016-0000-0000-0000-000000000001','b0000006-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Core & Mobility — Hip Flexor Release',
  'Myofascial release, active stretching, and core activation for the hip flexors and thoracic spine.',
  'GROUP','PUBLIC',NOW() + INTERVAL '4 days',45,
  'Sala Fitness, Str. Florilor 12, București',10,NULL,'RON','SCHEDULED',FALSE,NOW(),NOW()),

('c0000017-0000-0000-0000-000000000001','b0000007-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Weekend Warriors — Strongman Saturday',
  'Tire flips, sled pushes, log press, and atlas stones. One of those sessions you talk about on Monday.',
  'GROUP','PUBLIC',NOW() + INTERVAL '5 days',90,
  'Outdoor — Parcul Herăstrău, Poiana Mare',20,NULL,'RON','SCHEDULED',FALSE,NOW(),NOW()),

('c0000018-0000-0000-0000-000000000001',NULL,'test0004-0000-0000-0000-000000000001',
  'Private Session — Test User (Week 3 Check-in)',
  'Progress review: strength numbers, body measurements, and program adjustment for weeks 4–6.',
  'ONE_ON_ONE','PRIVATE',NOW() + INTERVAL '2 days',60,
  'Studio 1, Str. Mioriței 4, București',1,250.00,'RON','SCHEDULED',FALSE,NOW(),NOW()),

('c0000019-0000-0000-0000-000000000001','b0000009-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'Run Club — 10K Tempo Run',
  'Structured tempo effort: 2K warm-up, 6K at comfortably hard pace, 2K cool-down.',
  'GROUP','PUBLIC',NOW() + INTERVAL '6 days',70,
  'Parcul Herăstrău, startul principal',20,NULL,'RON','SCHEDULED',FALSE,NOW(),NOW()),

('c0000020-0000-0000-0000-000000000001','b0000010-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001',
  'PT Premium — Monthly Group Check-in',
  'Group accountability call: progress photos, measurements, nutrition review, and program tweaks.',
  'GROUP','PRIVATE',NOW() + INTERVAL '7 days',60,
  'Zoom / Online',4,NULL,'RON','SCHEDULED',FALSE,NOW(),NOW())
ON CONFLICT (id) DO NOTHING;

-- =========================================================
-- 8. SESSION_PARTICIPANTS (20 participants)
--    test0006 attends most of their sessions (past + future)
-- =========================================================
INSERT INTO session_participant (id, session_id, user_id, status, checked_in_at, created_at) VALUES
-- Completed sessions
(gen_random_uuid()::TEXT,'c0000001-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '14 days',NOW() - INTERVAL '16 days'),
(gen_random_uuid()::TEXT,'c0000001-0000-0000-0000-000000000001','a0000006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '14 days',NOW() - INTERVAL '16 days'),
(gen_random_uuid()::TEXT,'c0000001-0000-0000-0000-000000000001','a0000009-0000-0000-0000-000000000001','NO_SHOW',  NULL,                       NOW() - INTERVAL '16 days'),
(gen_random_uuid()::TEXT,'c0000002-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '11 days',NOW() - INTERVAL '13 days'),
(gen_random_uuid()::TEXT,'c0000002-0000-0000-0000-000000000001','a0000007-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '11 days',NOW() - INTERVAL '13 days'),
(gen_random_uuid()::TEXT,'c0000003-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '9 days', NOW() - INTERVAL '10 days'),
(gen_random_uuid()::TEXT,'c0000003-0000-0000-0000-000000000001','a0000008-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '9 days', NOW() - INTERVAL '10 days'),
(gen_random_uuid()::TEXT,'c0000004-0000-0000-0000-000000000001','a0000009-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '7 days', NOW() - INTERVAL '8 days'),
(gen_random_uuid()::TEXT,'c0000004-0000-0000-0000-000000000001','a0000015-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '7 days', NOW() - INTERVAL '8 days'),
(gen_random_uuid()::TEXT,'c0000005-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '6 days', NOW() - INTERVAL '7 days'),
(gen_random_uuid()::TEXT,'c0000005-0000-0000-0000-000000000001','a0000014-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '6 days', NOW() - INTERVAL '7 days'),
(gen_random_uuid()::TEXT,'c0000006-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '5 days', NOW() - INTERVAL '6 days'),
(gen_random_uuid()::TEXT,'c0000007-0000-0000-0000-000000000001','a0000010-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '4 days', NOW() - INTERVAL '5 days'),
(gen_random_uuid()::TEXT,'c0000007-0000-0000-0000-000000000001','a0000013-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '4 days', NOW() - INTERVAL '5 days'),
(gen_random_uuid()::TEXT,'c0000008-0000-0000-0000-000000000001','a0000012-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '3 days', NOW() - INTERVAL '4 days'),
(gen_random_uuid()::TEXT,'c0000009-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '2 days', NOW() - INTERVAL '3 days'),
(gen_random_uuid()::TEXT,'c0000009-0000-0000-0000-000000000001','a0000011-0000-0000-0000-000000000001','CANCELLED',NULL,                       NOW() - INTERVAL '3 days'),
(gen_random_uuid()::TEXT,'c0000010-0000-0000-0000-000000000001','a0000016-0000-0000-0000-000000000001','ATTENDED', NOW() - INTERVAL '1 day',  NOW() - INTERVAL '2 days'),
-- Future sessions — registered
(gen_random_uuid()::TEXT,'c0000012-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','REGISTERED',NULL,NOW() - INTERVAL '12 hours'),
(gen_random_uuid()::TEXT,'c0000014-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','REGISTERED',NULL,NOW() - INTERVAL '6 hours')
ON CONFLICT (session_id, user_id) DO NOTHING;

-- =========================================================
-- 9. INSTRUCTOR_CLIENT (15 — test0004 as instructor)
--    test0006 is the primary/showcase client
-- =========================================================
INSERT INTO instructor_client (
  id, instructor_id, client_id,
  status, initiated_by, notes, started_at,
  created_at, updated_at
) VALUES
-- test0006 (user@motionhive.fit) — the primary test client
(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001',
  'ACTIVE','INSTRUCTOR',
  'Main test client. Goals: body recomposition and general strength. Training 3x per week. Week 3 of 12.',
  NOW() - INTERVAL '21 days',NOW() - INTERVAL '22 days',NOW()),

-- a000000X clients (ACTIVE)
(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000006-0000-0000-0000-000000000001',
  'ACTIVE','INSTRUCTOR',
  'Maria — weight loss focus. Pilates + HIIT combo, 2x per week.',
  NOW() - INTERVAL '40 days',NOW() - INTERVAL '42 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000007-0000-0000-0000-000000000001',
  'ACTIVE','CLIENT',
  'Ion — training for a 10K race. Adding strength work to complement running.',
  NOW() - INTERVAL '35 days',NOW() - INTERVAL '37 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000009-0000-0000-0000-000000000001',
  'ACTIVE','INSTRUCTOR',
  'Alexandru — powerlifting prep. Currently running a 5/3/1 variation.',
  NOW() - INTERVAL '28 days',NOW() - INTERVAL '30 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000011-0000-0000-0000-000000000001',
  'ACTIVE','CLIENT',
  'Stefan — managed asthma. Lower-intensity sessions, monitoring heart rate carefully.',
  NOW() - INTERVAL '22 days',NOW() - INTERVAL '24 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000012-0000-0000-0000-000000000001',
  'ACTIVE','INSTRUCTOR',
  'Laura — core rehab post-pregnancy. Progressing well, cleared by physio for full training.',
  NOW() - INTERVAL '18 days',NOW() - INTERVAL '20 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000015-0000-0000-0000-000000000001',
  'ACTIVE','CLIENT',
  'Vlad — sport-specific S&C for football. 3x per week in-season program.',
  NOW() - INTERVAL '14 days',NOW() - INTERVAL '16 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000017-0000-0000-0000-000000000001',
  'ACTIVE','INSTRUCTOR',
  'Cosmin — muscle gain program. Nutrition coaching included.',
  NOW() - INTERVAL '9 days',NOW() - INTERVAL '10 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000019-0000-0000-0000-000000000001',
  'ACTIVE','CLIENT',
  'Razvan — marathon runner adding strength work to reduce injury risk.',
  NOW() - INTERVAL '6 days',NOW() - INTERVAL '7 days',NOW()),

-- PENDING
(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000008-0000-0000-0000-000000000001',
  'PENDING','CLIENT',NULL,NULL,NOW() - INTERVAL '3 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000013-0000-0000-0000-000000000001',
  'PENDING','INSTRUCTOR',NULL,NULL,NOW() - INTERVAL '2 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000020-0000-0000-0000-000000000001',
  'PENDING','CLIENT',NULL,NULL,NOW() - INTERVAL '1 day',NOW()),

-- ARCHIVED (completed cycles)
(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001',
  'ARCHIVED','INSTRUCTOR',
  'Mihai — completed 12-week foundation program. Moved to self-programming.',
  NULL,NOW() - INTERVAL '90 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000003-0000-0000-0000-000000000001',
  'ARCHIVED','CLIENT',
  'Radu — completed 8-week mobility program. No longer needs guided sessions.',
  NULL,NOW() - INTERVAL '75 days',NOW()),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000005-0000-0000-0000-000000000001',
  'ARCHIVED','INSTRUCTOR',
  'Bogdan — completed 16-week powerlifting cycle. Competed in regional meet.',
  NULL,NOW() - INTERVAL '60 days',NOW())
ON CONFLICT (instructor_id, client_id) DO NOTHING;

-- =========================================================
-- 10. CLIENT_REQUESTS (15 — all involving test0004)
-- =========================================================
INSERT INTO client_request (
  id, from_user_id, to_user_id, type,
  message, status, expires_at, responded_at, created_at
) VALUES
-- ACCEPTED (matching ACTIVE relationships)
(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','test0006-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Hi! I''d love to work with you on your fitness goals. Let''s set up a free intro call to discuss a personalised program.',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '22 days',NOW() - INTERVAL '25 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000006-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Maria, I think a combination of pilates and HIIT would be perfect for your weight-loss goals. Interested?',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '42 days',NOW() - INTERVAL '45 days'),

(gen_random_uuid()::TEXT,'a0000007-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'Hi, I''m training for a 10K and would love some guidance on adding strength work without compromising my running.',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '37 days',NOW() - INTERVAL '40 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000009-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Alexandru, your strength base is solid. I think you''re ready for a structured powerlifting program.',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '30 days',NOW() - INTERVAL '33 days'),

(gen_random_uuid()::TEXT,'a0000011-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'I have managed asthma and my doctor recommended low-intensity strength training. Can you help?',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '24 days',NOW() - INTERVAL '27 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000012-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Laura, I specialize in postnatal rehab and core rebuilding. I''d be glad to work with you.',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '20 days',NOW() - INTERVAL '23 days'),

(gen_random_uuid()::TEXT,'a0000015-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'Need sport-specific conditioning for football. Pre-season starts in 10 weeks.',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '16 days',NOW() - INTERVAL '19 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000017-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Cosmin, you''ve been consistent in group class. Ready to take it to the next level with a personal program?',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '10 days',NOW() - INTERVAL '13 days'),

(gen_random_uuid()::TEXT,'a0000019-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'I''m running my first marathon in 6 months. I want to add strength training to reduce injury risk.',
  'ACCEPTED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '7 days', NOW() - INTERVAL '10 days'),

-- PENDING
(gen_random_uuid()::TEXT,'a0000008-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'Hi, I''m interested in personal training. I''m a complete beginner. Is that okay?',
  'PENDING',NOW() + INTERVAL '27 days',NULL,NOW() - INTERVAL '3 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000013-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Andrei, I have a spot opening in the Strength Foundations group. Want to join as a personal client?',
  'PENDING',NOW() + INTERVAL '28 days',NULL,NOW() - INTERVAL '2 days'),

(gen_random_uuid()::TEXT,'a0000020-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'I''ve been watching your content online and I''d love to train with you!',
  'PENDING',NOW() + INTERVAL '29 days',NULL,NOW() - INTERVAL '1 day'),

-- DECLINED / CANCELLED
(gen_random_uuid()::TEXT,'a0000002-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'Hi, do you have space for a new client? I''m already intermediate level.',
  'DECLINED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '15 days',NOW() - INTERVAL '18 days'),

(gen_random_uuid()::TEXT,'a0000004-0000-0000-0000-000000000001','test0004-0000-0000-0000-000000000001','CLIENT_TO_INSTRUCTOR',
  'Looking for a trainer — are you available?',
  'CANCELLED',NOW() + INTERVAL '30 days',NULL,NOW() - INTERVAL '10 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','a0000018-0000-0000-0000-000000000001','INSTRUCTOR_TO_CLIENT',
  'Alina, I think you''d benefit from our Core & Mobility program given your lower back history.',
  'DECLINED',NOW() + INTERVAL '30 days',NOW() - INTERVAL '8 days',NOW() - INTERVAL '12 days');

-- =========================================================
-- 11. INVITATIONS (10 — all sent by test0004)
--     test0006 receives one; a000000X and test accounts fill the rest
-- =========================================================
INSERT INTO invitation (
  id, inviter_id, email, role_id, group_id,
  token, message, expires_at, accepted_at, declined_at, created_at
) VALUES
(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','user@motionhive.fit',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000010-0000-0000-0000-000000000001',
  'tok_inv_001','Welcome to the Premium PT group! This is your exclusive access.',
  NOW() + INTERVAL '30 days',NOW() - INTERVAL '18 days',NULL,NOW() - INTERVAL '20 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','maria.popa@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000001-0000-0000-0000-000000000001',
  'tok_inv_002','Maria, join our Functional Fitness group — great community and all levels welcome!',
  NOW() + INTERVAL '14 days',NOW() - INTERVAL '40 days',NULL,NOW() - INTERVAL '45 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','ion.georgescu@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000009-0000-0000-0000-000000000001',
  'tok_inv_003','Ion, the Run Club would be perfect for your 10K training!',
  NOW() + INTERVAL '14 days',NOW() - INTERVAL '35 days',NULL,NOW() - INTERVAL '38 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','alina.stanescu@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000008-0000-0000-0000-000000000001',
  'tok_inv_004','Alina, the Women-Only group is a great fit for your goals. First session is free.',
  NOW() + INTERVAL '10 days',NOW() - INTERVAL '8 days',NULL,NOW() - INTERVAL '10 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','razvan.oprea@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000010-0000-0000-0000-000000000001',
  'tok_inv_005','Razvan, you''ve earned your spot in the Premium PT group. Welcome aboard!',
  NOW() + INTERVAL '30 days',NOW() - INTERVAL '6 days',NULL,NOW() - INTERVAL '8 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','cosmin.dobre@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000003-0000-0000-0000-000000000001',
  'tok_inv_006','Cosmin, Strength Foundations is perfect timing for your new muscle-gain program.',
  NOW() + INTERVAL '12 days',NULL,NULL,NOW() - INTERVAL '2 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','andrei.florescu@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000005-0000-0000-0000-000000000001',
  'tok_inv_007','Andrei, the Online Training Hub means you can train from anywhere — perfect for your schedule.',
  NOW() + INTERVAL '14 days',NULL,NULL,NOW() - INTERVAL '1 day'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','simona.zaharia@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000002-0000-0000-0000-000000000001',
  'tok_inv_008','Simona, Morning HIIT is only 45 minutes — no excuses!',
  NOW() + INTERVAL '7 days', NULL,NULL,NOW() - INTERVAL '3 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','camelia.radu@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000004-0000-0000-0000-000000000001',
  'tok_inv_009','Camelia, Sunday yoga is exactly what you need to decompress after the week.',
  NOW() + INTERVAL '10 days',NULL,NULL,NOW() - INTERVAL '4 days'),

(gen_random_uuid()::TEXT,'test0004-0000-0000-0000-000000000001','ioana.lungu@example.com',
  '7261d1cc-006c-11f1-b74f-0242ac110002','b0000007-0000-0000-0000-000000000001',
  'tok_inv_010','Ioana, Weekend Warriors is a fun community — come join us on Saturday!',
  NOW() + INTERVAL '7 days', NULL,NOW() - INTERVAL '1 day',NOW() - INTERVAL '5 days')
ON CONFLICT (token) DO NOTHING;

-- =========================================================
-- 12. FEEDBACK (20 entries)
--     From test0001–test0006 AND a000000X users
-- =========================================================
INSERT INTO feedback (id, type, title, message, user_id, email, created_at, updated_at) VALUES
-- From test accounts
(gen_random_uuid()::TEXT,'FEATURE','Analytics dashboard needs export option',
  'As an instructor the analytics page is great, but I need to export data to CSV for my accountant. Please add this.',
  'test0004-0000-0000-0000-000000000001','instructor@motionhive.fit',NOW() - INTERVAL '20 days',NOW() - INTERVAL '20 days'),

(gen_random_uuid()::TEXT,'FEATURE','Admin: bulk user management',
  'When managing large groups of users it would help to have bulk actions — assign role, export, suspend — rather than doing each one by one.',
  'test0002-0000-0000-0000-000000000001','admin@motionhive.fit',NOW() - INTERVAL '18 days',NOW() - INTERVAL '18 days'),

(gen_random_uuid()::TEXT,'BUG','Support dashboard shows wrong session count',
  'The support dashboard shows 12 sessions for instructor@motionhive.fit but when I drill in there are only 8. Possible caching issue.',
  'test0003-0000-0000-0000-000000000001','support@motionhive.fit',NOW() - INTERVAL '16 days',NOW() - INTERVAL '16 days'),

(gen_random_uuid()::TEXT,'GENERAL','Platform is great — keep it up!',
  'Really impressed with how polished the experience is. The session booking flow is super clean.',
  'test0006-0000-0000-0000-000000000001','user@motionhive.fit',NOW() - INTERVAL '14 days',NOW() - INTERVAL '14 days'),

(gen_random_uuid()::TEXT,'FEATURE','Blog: scheduled publish date',
  'Would love the ability to write a post today and schedule it to go live at a specific date and time.',
  'test0005-0000-0000-0000-000000000001','writer@motionhive.fit',NOW() - INTERVAL '13 days',NOW() - INTERVAL '13 days'),

(gen_random_uuid()::TEXT,'BUG','SUPER_ADMIN: cannot delete soft-deleted users',
  'When trying to permanently delete a soft-deleted user from the admin panel I get a 500 error. Steps to reproduce attached.',
  'test0001-0000-0000-0000-000000000001','superadmin@motionhive.fit',NOW() - INTERVAL '12 days',NOW() - INTERVAL '12 days'),

-- From a000000X users
(gen_random_uuid()::TEXT,'BUG','Session calendar not loading on mobile',
  'On iPhone 15 the calendar view just shows a spinner and never loads. Tested on Chrome and Safari.',
  'a0000006-0000-0000-0000-000000000001','maria.popa@example.com',NOW() - INTERVAL '11 days',NOW() - INTERVAL '11 days'),

(gen_random_uuid()::TEXT,'FEATURE','Add video call link to online sessions',
  'It would be great if online sessions had a built-in Zoom/Meet link rather than pasting it in the description.',
  'a0000007-0000-0000-0000-000000000001','ion.georgescu@example.com',NOW() - INTERVAL '10 days',NOW() - INTERVAL '10 days'),

(gen_random_uuid()::TEXT,'BUG','Profile picture upload fails for large images',
  'Uploading a photo larger than 2MB shows an error with no explanation. Should give a size limit message.',
  'a0000009-0000-0000-0000-000000000001','alex.barbu@example.com',NOW() - INTERVAL '9 days',NOW() - INTERVAL '9 days'),

(gen_random_uuid()::TEXT,'FEATURE','Push notifications for upcoming sessions',
  'A reminder 30 minutes before a session would help a lot. Easy to forget when you have a busy day.',
  'a0000010-0000-0000-0000-000000000001','ioana.lungu@example.com',NOW() - INTERVAL '8 days',NOW() - INTERVAL '8 days'),

(gen_random_uuid()::TEXT,'BUG','Duplicate session in calendar view',
  'The same session appears twice in the calendar but only once in the list. Seems like a rendering bug.',
  'a0000011-0000-0000-0000-000000000001','stefan.niculescu@example.com',NOW() - INTERVAL '7 days',NOW() - INTERVAL '7 days'),

(gen_random_uuid()::TEXT,'FEATURE','Export workout history to PDF',
  'I''d love to export all attended sessions as a PDF to share with my physiotherapist.',
  'a0000012-0000-0000-0000-000000000001','laura.matei@example.com',NOW() - INTERVAL '6 days',NOW() - INTERVAL '6 days'),

(gen_random_uuid()::TEXT,'GENERAL','Dark mode please!',
  'The white background is very bright during evening sessions. A dark mode option would be much appreciated.',
  'a0000013-0000-0000-0000-000000000001','andrei.florescu@example.com',NOW() - INTERVAL '5 days',NOW() - INTERVAL '5 days'),

(gen_random_uuid()::TEXT,'BUG','Cannot cancel session registration',
  'The cancel button on my registered session doesn''t respond. Had to ask the instructor to remove me manually.',
  'a0000014-0000-0000-0000-000000000001','camelia.radu@example.com',NOW() - INTERVAL '5 days',NOW() - INTERVAL '5 days'),

(gen_random_uuid()::TEXT,'FEATURE','Session ratings and reviews',
  'Clients should be able to leave a star rating after a session. Would help new users choose the right instructor.',
  'a0000015-0000-0000-0000-000000000001','vlad.mocanu@example.com',NOW() - INTERVAL '4 days',NOW() - INTERVAL '4 days'),

(gen_random_uuid()::TEXT,'BUG','Payment receipt not received by email',
  'Paid for a session 3 days ago. Bank shows the charge went through but I never received a receipt email.',
  'a0000016-0000-0000-0000-000000000001','diana.tanase@example.com',NOW() - INTERVAL '3 days',NOW() - INTERVAL '3 days'),

(gen_random_uuid()::TEXT,'FEATURE','Recurring session auto-RSVP',
  'For weekly sessions I always attend, I''d love an auto-register option instead of confirming every week.',
  'a0000018-0000-0000-0000-000000000001','alina.stanescu@example.com',NOW() - INTERVAL '2 days',NOW() - INTERVAL '2 days'),

(gen_random_uuid()::TEXT,'BUG','Group member count mismatch',
  'My group shows 15 members on the group card but only 12 appear in the members list.',
  'a0000019-0000-0000-0000-000000000001','razvan.oprea@example.com',NOW() - INTERVAL '2 days',NOW() - INTERVAL '2 days'),

(gen_random_uuid()::TEXT,'FEATURE','Waitlist for full sessions',
  'When a session is full I should be able to join a waitlist and be notified automatically if a spot opens.',
  'a0000020-0000-0000-0000-000000000001','simona.zaharia@example.com',NOW() - INTERVAL '1 day',NOW() - INTERVAL '1 day'),

(gen_random_uuid()::TEXT,'GENERAL','Great instructor discovery feature',
  'Found my trainer through the discovery page — never would have found him otherwise. Keep that feature front and centre!',
  'a0000017-0000-0000-0000-000000000001','cosmin.dobre@example.com',NOW(),NOW());

-- =========================================================
-- 13. WAITLIST (20 entries)
-- =========================================================
INSERT INTO waitlist (id, email, name, role, source, created_at, updated_at) VALUES
(gen_random_uuid()::TEXT,'florin.moldovan@gmail.com',   'Florin Moldovan',  'INSTRUCTOR','landing_page',       NOW() - INTERVAL '45 days',NOW()),
(gen_random_uuid()::TEXT,'adriana.coman@yahoo.com',     'Adriana Coman',    'USER',      'instagram_bio_link', NOW() - INTERVAL '42 days',NOW()),
(gen_random_uuid()::TEXT,'marian.costea@gmail.com',     'Marian Costea',    'INSTRUCTOR','google_ads',         NOW() - INTERVAL '40 days',NOW()),
(gen_random_uuid()::TEXT,'teodora.vlad@outlook.com',    'Teodora Vlad',     'USER',      'friend_referral',    NOW() - INTERVAL '38 days',NOW()),
(gen_random_uuid()::TEXT,'gabriel.serban@gmail.com',    'Gabriel Șerban',   'INSTRUCTOR','facebook_group',     NOW() - INTERVAL '35 days',NOW()),
(gen_random_uuid()::TEXT,'nicoleta.andrei@yahoo.com',   'Nicoleta Andrei',  'USER',      'landing_page',       NOW() - INTERVAL '33 days',NOW()),
(gen_random_uuid()::TEXT,'sorin.cojocaru@gmail.com',    'Sorin Cojocaru',   'INSTRUCTOR','podcast_episode',    NOW() - INTERVAL '30 days',NOW()),
(gen_random_uuid()::TEXT,'mihaela.toma@gmail.com',      'Mihaela Toma',     'USER',      'instagram_post',     NOW() - INTERVAL '28 days',NOW()),
(gen_random_uuid()::TEXT,'daniel.calin@outlook.com',    'Daniel Călin',     'INSTRUCTOR','youtube_video',      NOW() - INTERVAL '26 days',NOW()),
(gen_random_uuid()::TEXT,'larisa.grigore@gmail.com',    'Larisa Grigore',   'USER',      'google_search',      NOW() - INTERVAL '24 days',NOW()),
(gen_random_uuid()::TEXT,'paul.dimitriu@gmail.com',     'Paul Dimitriu',    'INSTRUCTOR','linkedin_post',      NOW() - INTERVAL '22 days',NOW()),
(gen_random_uuid()::TEXT,'andreea.ionita@yahoo.com',    'Andreea Ioniță',   'USER',      'friend_referral',    NOW() - INTERVAL '20 days',NOW()),
(gen_random_uuid()::TEXT,'cristian.lazar@gmail.com',    'Cristian Lazăr',   'INSTRUCTOR','landing_page',       NOW() - INTERVAL '18 days',NOW()),
(gen_random_uuid()::TEXT,'roxana.petcu@gmail.com',      'Roxana Petcu',     'USER',      'tiktok_bio_link',    NOW() - INTERVAL '15 days',NOW()),
(gen_random_uuid()::TEXT,'octavian.marin@yahoo.com',    'Octavian Marin',   'INSTRUCTOR','facebook_ad',        NOW() - INTERVAL '13 days',NOW()),
(gen_random_uuid()::TEXT,'valentina.rusu@gmail.com',    'Valentina Rusu',   'USER',      'instagram_story',    NOW() - INTERVAL '10 days',NOW()),
(gen_random_uuid()::TEXT,'ciprian.gheorghe@gmail.com',  'Ciprian Gheorghe', 'INSTRUCTOR','landing_page',       NOW() - INTERVAL '7 days', NOW()),
(gen_random_uuid()::TEXT,'ionela.badea@yahoo.com',      'Ionela Badea',     'USER',      'google_search',      NOW() - INTERVAL '5 days', NOW()),
(gen_random_uuid()::TEXT,'sebastian.opris@gmail.com',   'Sebastian Opriș',  'INSTRUCTOR','podcast_episode',    NOW() - INTERVAL '3 days', NOW()),
(gen_random_uuid()::TEXT,'bianca.constantin@gmail.com', 'Bianca Constantin','USER',      'friend_referral',    NOW() - INTERVAL '1 day',  NOW())
ON CONFLICT (email) DO NOTHING;

-- =========================================================
-- Demo data seeded successfully
-- =========================================================
-- Anchor accounts (from migration 018) now have rich data:
--
--   instructor@motionhive.fit (test0004)
--     → instructor_profile UPDATED with full bio & specializations
--     → 10 groups owned
--     → 20 sessions created (10 past, 1 in-progress, 9 future)
--     → 15 instructor_client relationships (9 ACTIVE, 3 PENDING, 3 ARCHIVED)
--     → 15 client_requests sent/received
--     → 10 invitations sent
--
--   user@motionhive.fit (test0006)
--     → member of 4 groups (b1, b2, b4, b7, b10)
--     → attended 6 past sessions, registered for 2 upcoming
--     → ACTIVE client of test0004
--     → received group invitation
--
--   admin/support/superadmin/writer have feedback entries
--
-- Supporting users a0000001–a0000020 fill the rest of the
-- membership, participant, and client data.
-- All new user passwords: Test1234!
-- =========================================================
