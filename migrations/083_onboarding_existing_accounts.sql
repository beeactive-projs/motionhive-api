-- 083_onboarding_existing_accounts.sql
-- Title: people who had an account before the welcome flow get the Home
-- card, not the flow.
--
-- Why: the welcome flow (081) asks every step that has no row, and an
-- account made before it has none, so everyone who already used the app was
-- sent through the whole flow on their next start. For them it should be
-- offered, not forced: a SKIPPED step leaves the flow and waits on a Home
-- card (`computeOnboardingFlow`), exactly as if they had pressed Skip.
--
-- Changes: for every account that exists and is not deleted when this runs,
-- a SKIPPED row (flow version 1) for each of its steps that has no row yet:
--   - someone who does not coach (no INSTRUCTOR role): ROLE, INTERESTS and
--     LEVEL. INTERESTS and LEVEL wait on the Train card; ROLE is not asked.
--   - a coach (the INSTRUCTOR role, read as RoleService reads it: any
--     user_role row): COACH_CATEGORIES and COACH_DETAILS, which wait on the
--     coach card. A coach is never asked ROLE, and their own training
--     already waits on the Train card.
-- A step already answered, skipped or dismissed keeps its row, and nothing
-- else is touched. Accounts made after this runs have no rows and see the
-- flow, as intended.
--
-- Idempotent: ON CONFLICT (user_id, step) DO NOTHING; a second run adds
-- nothing.

BEGIN;

INSERT INTO user_onboarding_step (user_id, step, status, flow_version)
SELECT u.id, steps.step, 'SKIPPED', 1
  FROM "user" u
  CROSS JOIN LATERAL unnest(
    CASE
      WHEN EXISTS (
        SELECT 1
          FROM user_role ur
          JOIN role r ON r.id = ur.role_id
         WHERE ur.user_id = u.id
           AND r.name = 'INSTRUCTOR'
      )
      THEN ARRAY['COACH_CATEGORIES', 'COACH_DETAILS']::onboarding_step[]
      ELSE ARRAY['ROLE', 'INTERESTS', 'LEVEL']::onboarding_step[]
    END
  ) AS steps(step)
 WHERE u.deleted_at IS NULL
ON CONFLICT (user_id, step) DO NOTHING;

COMMIT;
