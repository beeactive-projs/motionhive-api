-- =========================================================
-- Migration 023: Seed payment demo data for the profile UI
-- =========================================================
-- Creates Stripe account + customer rows, a handful of products,
-- two subscriptions (memberships), and a mix of invoices so the
-- profile tabs (My invoices, My memberships) actually render with
-- realistic data during local development.
--
-- Actors:
--   INSTRUCTOR: test0004-0000-0000-0000-000000000001 (instructor@motionhive.fit)
--   USER:      test0006-0000-0000-0000-000000000001 (user@motionhive.fit)
--
-- Idempotent: every INSERT uses a deterministic CHAR(36) id and
-- ON CONFLICT DO NOTHING, so re-running the migration is safe.
-- Fake `stripe_*_id` values use the format `demo_*` so they're easy
-- to spot and can be filtered out in production.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Stripe account for the instructor (charges enabled so
--    the invoice/product endpoints don't gate the UI)
-- ---------------------------------------------------------
INSERT INTO stripe_account (
  id, user_id, stripe_account_id,
  charges_enabled, payouts_enabled, details_submitted,
  country, default_currency, platform_fee_bps,
  onboarding_completed_at, created_at, updated_at
) VALUES (
  'demo0001-acct-0000-0000-000000000001',
  'test0004-0000-0000-0000-000000000001',
  'acct_demo_instructor',
  TRUE, TRUE, TRUE,
  'RO', 'ron', 0,
  NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days', NOW()
) ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------
-- 2. Stripe customer for the test user
-- ---------------------------------------------------------
INSERT INTO stripe_customer (
  id, user_id, stripe_customer_id, email, name, created_at, updated_at
) VALUES (
  'demo0001-cust-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  'user@motionhive.fit',
  'Regular User',
  NOW() - INTERVAL '30 days', NOW()
) ON CONFLICT (stripe_customer_id) DO NOTHING;

-- ---------------------------------------------------------
-- 3. Instructor products
--    Two one-offs + two subscriptions. Mark two as visible
--    on the public profile so the Coaching profile "services"
--    list has something to show out of the box.
-- ---------------------------------------------------------
INSERT INTO product (
  id, instructor_id, name, description, type,
  amount_cents, currency, interval, interval_count,
  stripe_product_id, stripe_price_id,
  is_active, show_on_profile, created_at, updated_at
) VALUES
(
  'demo0001-prod-0000-0000-000000000001',
  'test0004-0000-0000-0000-000000000001',
  'Morning yoga session',
  '60 minutes of vinyasa yoga, all levels welcome.',
  'ONE_OFF', 4500, 'RON', NULL, NULL,
  'prod_demo_yoga', 'price_demo_yoga',
  TRUE, TRUE, NOW() - INTERVAL '25 days', NOW()
),
(
  'demo0001-prod-0000-0000-000000000002',
  'test0004-0000-0000-0000-000000000001',
  'Personal training session',
  '1:1 strength training, 60 minutes.',
  'ONE_OFF', 12000, 'RON', NULL, NULL,
  'prod_demo_pt', 'price_demo_pt',
  TRUE, FALSE, NOW() - INTERVAL '20 days', NOW()
),
(
  'demo0001-prod-0000-0000-000000000003',
  'test0004-0000-0000-0000-000000000001',
  'Monthly membership',
  'Unlimited group classes for a flat monthly fee.',
  'SUBSCRIPTION', 24000, 'RON', 'month', 1,
  'prod_demo_monthly', 'price_demo_monthly',
  TRUE, TRUE, NOW() - INTERVAL '15 days', NOW()
),
(
  'demo0001-prod-0000-0000-000000000004',
  'test0004-0000-0000-0000-000000000001',
  'Quarterly coaching package',
  '3 months of coaching with weekly check-ins.',
  'SUBSCRIPTION', 60000, 'RON', 'month', 3,
  'prod_demo_quarterly', 'price_demo_quarterly',
  TRUE, FALSE, NOW() - INTERVAL '10 days', NOW()
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------
-- 4. Subscriptions (user is subscribed to both recurring products)
-- ---------------------------------------------------------
INSERT INTO subscription (
  id, instructor_id, client_id, stripe_customer_id, product_id,
  stripe_subscription_id, stripe_price_id, status,
  current_period_start, current_period_end,
  cancel_at_period_end, amount_cents, currency,
  created_at, updated_at
) VALUES
(
  'demo0001-sub0-0000-0000-000000000001',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  'demo0001-prod-0000-0000-000000000003',
  'sub_demo_monthly', 'price_demo_monthly', 'active',
  NOW() - INTERVAL '10 days', NOW() + INTERVAL '20 days',
  FALSE, 24000, 'RON',
  NOW() - INTERVAL '10 days', NOW()
),
(
  'demo0001-sub0-0000-0000-000000000002',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  'demo0001-prod-0000-0000-000000000004',
  'sub_demo_quarterly', 'price_demo_quarterly', 'trialing',
  NOW() - INTERVAL '3 days', NOW() + INTERVAL '4 days',
  FALSE, 60000, 'RON',
  NOW() - INTERVAL '3 days', NOW()
) ON CONFLICT (stripe_subscription_id) DO NOTHING;

-- ---------------------------------------------------------
-- 5. Invoices
--    Mix of paid + open + one draft + one void so every status
--    filter tab has a row. All billed FROM the test instructor
--    TO the test user so the "My invoices" tab on the user's
--    profile renders them.
-- ---------------------------------------------------------
INSERT INTO invoice (
  id, instructor_id, client_id, stripe_customer_id, subscription_id,
  stripe_invoice_id, number, status,
  amount_due_cents, amount_paid_cents, amount_remaining_cents,
  currency, application_fee_cents,
  due_date, finalized_at, paid_at, voided_at,
  paid_out_of_band, description,
  created_at, updated_at
) VALUES
-- Paid, subscription-generated (monthly membership, current period)
(
  'demo0001-inv0-0000-0000-000000000001',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  'demo0001-sub0-0000-0000-000000000001',
  'in_demo_membership_paid', 'MH-0001', 'paid',
  24000, 24000, 0, 'RON', 0,
  NOW() - INTERVAL '7 days',
  NOW() - INTERVAL '10 days',
  NOW() - INTERVAL '9 days',
  NULL, FALSE, 'Monthly membership — April',
  NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days'
),
-- Paid, one-off (yoga session)
(
  'demo0001-inv0-0000-0000-000000000002',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  NULL,
  'in_demo_yoga_paid', 'MH-0002', 'paid',
  4500, 4500, 0, 'RON', 0,
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '6 days',
  NOW() - INTERVAL '5 days',
  NULL, FALSE, 'Morning yoga session — Apr 15',
  NOW() - INTERVAL '6 days', NOW() - INTERVAL '5 days'
),
-- Paid, one-off (personal training)
(
  'demo0001-inv0-0000-0000-000000000003',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  NULL,
  'in_demo_pt_paid', 'MH-0003', 'paid',
  12000, 12000, 0, 'RON', 0,
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '2 days',
  NULL, FALSE, 'Personal training — strength',
  NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days'
),
-- Open, overdue (reminder candidate)
(
  'demo0001-inv0-0000-0000-000000000004',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  NULL,
  'in_demo_yoga_open', 'MH-0004', 'open',
  4500, 0, 4500, 'RON', 0,
  NOW() - INTERVAL '2 days',   -- due 2 days ago → overdue
  NOW() - INTERVAL '4 days',
  NULL, NULL, FALSE, 'Morning yoga session — Apr 19',
  NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'
),
-- Open, future due date
(
  'demo0001-inv0-0000-0000-000000000005',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  NULL,
  'in_demo_pt_open', 'MH-0005', 'open',
  12000, 0, 12000, 'RON', 0,
  NOW() + INTERVAL '10 days',
  NOW() - INTERVAL '1 day',
  NULL, NULL, FALSE, 'Personal training — mobility',
  NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'
),
-- Draft (instructor-only; not yet sent)
(
  'demo0001-inv0-0000-0000-000000000006',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  NULL,
  'in_demo_draft', NULL, 'draft',
  9000, 0, 9000, 'RON', 0,
  NULL, NULL, NULL, NULL, FALSE, 'Draft — 2-session pack',
  NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours'
),
-- Void (historical)
(
  'demo0001-inv0-0000-0000-000000000007',
  'test0004-0000-0000-0000-000000000001',
  'test0006-0000-0000-0000-000000000001',
  'cus_demo_user',
  NULL,
  'in_demo_void', 'MH-0007', 'void',
  4500, 0, 0, 'RON', 0,
  NULL,
  NOW() - INTERVAL '14 days',
  NULL,
  NOW() - INTERVAL '13 days',
  FALSE, 'Cancelled — client rescheduled',
  NOW() - INTERVAL '14 days', NOW() - INTERVAL '13 days'
) ON CONFLICT (stripe_invoice_id) DO NOTHING;
