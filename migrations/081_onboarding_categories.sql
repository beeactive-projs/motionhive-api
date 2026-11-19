-- 081_onboarding_categories.sql
-- Title: one category list for people, coaches and groups, plus the welcome
-- flow's progress per person.
--
-- Why: until now "what kind of training" was free text everywhere (a coach's
-- specializations, a group's tags) and keyword guesses in the mobile app, so
-- the same idea showed up as "Forță", "forță", "strength" and "Strength &
-- Conditioning", and a person could not say what they are into. The welcome
-- flow that runs on a person's first entry into the app (research:
-- docs/research/onboarding/ONBOARDING_AND_CATEGORIES.md) needs a list it can
-- write answers against, and Discover needs the same list to match them.
--
-- Changes:
--   1. `category`: MotionHive's own list, two kinds. ACTIVITY is what you do
--      (strength training, running, yoga...), GOAL is why (get stronger, lose
--      fat...). English in `name`, Romanian in `translations` (the content
--      pattern of migration 063, swapped in by ContentLocaleInterceptor).
--      `coaches_only` marks what a coach offers but a trainee does not pick
--      as an interest (nutrition).
--   2. `user_interest`: the activities and goals a person picked.
--   3. `coach_category`: the activities a coach coaches, keyed by the coach's
--      user id like every other coach reference (`group.instructor_id`,
--      `session_template.instructor_id`). The free-text specializations stay
--      as the coach's own words on their profile; matching reads this table.
--   4. `group_category`: the activities a group is about.
--   5. `user.fitness_level`: where a person is starting, on the exercise
--      level scale (migration 047).
--   6. `user_onboarding_step`: one row per person and welcome step once it
--      is answered (DONE), skipped in the flow (SKIPPED: Home may still offer
--      it as a card) or closed on Home (DISMISSED: never offered again).
--      `flow_version` lets a step added later be asked once of everyone.
--   7. Backfill: existing specializations and group tags (and group names)
--      matched to categories by word starts, folded, in English and Romanian.
--      What matches nothing stays free text.
--
-- Idempotent: IF [NOT] EXISTS, guarded enum creation, ON CONFLICT DO NOTHING.

BEGIN;

-- ---------------------------------------------------------------- enums ---

DO $$ BEGIN
  CREATE TYPE category_kind AS ENUM ('ACTIVITY', 'GOAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE onboarding_step AS ENUM (
    'ROLE', 'INTERESTS', 'LEVEL', 'COACH_CATEGORIES', 'COACH_DETAILS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE onboarding_step_status AS ENUM ('DONE', 'SKIPPED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------------- category ---

CREATE TABLE IF NOT EXISTS category (
  id            CHAR(36)      PRIMARY KEY,
  slug          VARCHAR(50)   NOT NULL,
  kind          category_kind NOT NULL,
  name          VARCHAR(100)  NOT NULL,
  -- An Ionicons outline glyph name, the apps draw it as is.
  icon          VARCHAR(50)   NOT NULL,
  display_order SMALLINT      NOT NULL DEFAULT 0,
  coaches_only  BOOLEAN       NOT NULL DEFAULT false,
  translations  JSONB         NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_category_slug UNIQUE (slug)
);

ALTER TABLE category DROP CONSTRAINT IF EXISTS category_translations_object;
ALTER TABLE category ADD CONSTRAINT category_translations_object CHECK (
  translations IS NULL OR jsonb_typeof(translations) = 'object'
);

ALTER TABLE category DROP CONSTRAINT IF EXISTS category_coaches_only_activity;
ALTER TABLE category ADD CONSTRAINT category_coaches_only_activity CHECK (
  NOT coaches_only OR kind = 'ACTIVITY'
);

INSERT INTO category (id, slug, kind, name, icon, display_order, coaches_only, translations) VALUES
  (gen_random_uuid()::text, 'strength',    'ACTIVITY', 'Strength training',       'barbell-outline',        1,  false, '{"ro": {"name": "Antrenament de forță"}}'),
  (gen_random_uuid()::text, 'running',     'ACTIVITY', 'Running',                 'footsteps-outline',      2,  false, '{"ro": {"name": "Alergare"}}'),
  (gen_random_uuid()::text, 'yoga',        'ACTIVITY', 'Yoga',                    'flower-outline',         3,  false, NULL),
  (gen_random_uuid()::text, 'pilates',     'ACTIVITY', 'Pilates',                 'body-outline',           4,  false, NULL),
  (gen_random_uuid()::text, 'hiit',        'ACTIVITY', 'HIIT and functional',     'flash-outline',          5,  false, '{"ro": {"name": "HIIT și funcțional"}}'),
  (gen_random_uuid()::text, 'cycling',     'ACTIVITY', 'Cycling',                 'bicycle-outline',        6,  false, '{"ro": {"name": "Ciclism"}}'),
  (gen_random_uuid()::text, 'swimming',    'ACTIVITY', 'Swimming',                'water-outline',          7,  false, '{"ro": {"name": "Înot"}}'),
  (gen_random_uuid()::text, 'combat',      'ACTIVITY', 'Boxing and martial arts', 'hand-left-outline',      8,  false, '{"ro": {"name": "Box și arte marțiale"}}'),
  (gen_random_uuid()::text, 'dance',       'ACTIVITY', 'Dance',                   'musical-notes-outline',  9,  false, '{"ro": {"name": "Dans"}}'),
  (gen_random_uuid()::text, 'mobility',    'ACTIVITY', 'Mobility and stretching', 'accessibility-outline', 10,  false, '{"ro": {"name": "Mobilitate și stretching"}}'),
  (gen_random_uuid()::text, 'outdoor',     'ACTIVITY', 'Outdoor (hiking, trail)', 'trail-sign-outline',    11,  false, '{"ro": {"name": "În aer liber (drumeții, trail)"}}'),
  (gen_random_uuid()::text, 'team-sports', 'ACTIVITY', 'Team sports',             'football-outline',      12,  false, '{"ro": {"name": "Sporturi de echipă"}}'),
  (gen_random_uuid()::text, 'prenatal',    'ACTIVITY', 'Pre and postnatal',       'heart-outline',         13,  false, '{"ro": {"name": "Sarcină și postnatal"}}'),
  (gen_random_uuid()::text, 'nutrition',   'ACTIVITY', 'Nutrition',               'nutrition-outline',     14,  true,  '{"ro": {"name": "Nutriție"}}'),
  (gen_random_uuid()::text, 'get-stronger','GOAL',     'Get stronger',            'trending-up-outline',    1,  false, '{"ro": {"name": "Mai multă forță"}}'),
  (gen_random_uuid()::text, 'lose-fat',    'GOAL',     'Lose fat',                'flame-outline',          2,  false, '{"ro": {"name": "Slăbit"}}'),
  (gen_random_uuid()::text, 'endurance',   'GOAL',     'Build endurance',         'pulse-outline',          3,  false, '{"ro": {"name": "Mai multă rezistență"}}'),
  (gen_random_uuid()::text, 'move-better', 'GOAL',     'Move better',             'leaf-outline',           4,  false, '{"ro": {"name": "Mă mișc mai ușor"}}'),
  (gen_random_uuid()::text, 'event',       'GOAL',     'Train for an event',      'trophy-outline',         5,  false, '{"ro": {"name": "Mă pregătesc pentru o competiție"}}'),
  (gen_random_uuid()::text, 'feel-better', 'GOAL',     'Feel better',             'happy-outline',          6,  false, '{"ro": {"name": "Mă simt mai bine"}}')
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------- link tables ---

CREATE TABLE IF NOT EXISTS user_interest (
  user_id     CHAR(36)    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category_id CHAR(36)    NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_user_interest_category ON user_interest (category_id);

CREATE TABLE IF NOT EXISTS coach_category (
  user_id     CHAR(36)    NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  category_id CHAR(36)    NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_coach_category_category ON coach_category (category_id);

CREATE TABLE IF NOT EXISTS group_category (
  group_id    CHAR(36)    NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  category_id CHAR(36)    NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_group_category_category ON group_category (category_id);

-- -------------------------------------------------------- user columns ---

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS fitness_level exercise_level NULL;

-- --------------------------------------------------- onboarding steps ---

CREATE TABLE IF NOT EXISTS user_onboarding_step (
  user_id      CHAR(36)               NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  step         onboarding_step        NOT NULL,
  status       onboarding_step_status NOT NULL,
  flow_version SMALLINT               NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, step)
);

-- -------------------------------------------------------------- backfill ---

-- How a word starts when it means a category, folded (lowercase, no
-- diacritics), English and Romanian. `\m` is a word start, so "alerg" finds
-- "Alergare" and "Alergăm", and "run" does not find "brunch".
-- "weight" and "greutate" alone are left out: "Weight loss" and "Pierdere
-- în greutate" are not strength (corrected by 082 where 081 already ran).
CREATE TEMP TABLE category_words (slug VARCHAR(50), pattern TEXT) ON COMMIT DROP;
INSERT INTO category_words (slug, pattern) VALUES
  ('strength',    '\m(strength|forta|power|lift|weightlift|haltere|putere|musculat|bodybuild|culturism|greutati)'),
  ('running',     '\m(run|alerg|jog|marathon|maraton|sprint)'),
  ('yoga',        '\myoga'),
  ('pilates',     '\mpilates'),
  ('hiit',        '\m(hiit|functional|crossfit|cross|circuit|cardio|conditioning|tabata)'),
  ('cycling',     '\m(cycl|ciclism|bike|bicicl|spinning)'),
  ('swimming',    '\m(swim|inot|aqua|acva)'),
  ('combat',      '\m(box|kickbox|mma|martial|karate|judo|jiu|muay|krav|lupte)'),
  ('dance',       '\m(dance|dans|zumba|salsa|balet|ballet)'),
  ('mobility',    '\m(mobil|stretch|flexib|postur|intinder)'),
  ('outdoor',     '\m(hik|drumet|trail|outdoor|munte|trek)'),
  ('team-sports', '\m(football|fotbal|basket|baschet|volei|volley|handbal|tenis|tennis|rugby)'),
  ('prenatal',    '\m(prenatal|postnatal|pregnan|sarcin|gravid|postpartum)'),
  ('nutrition',   '\m(nutrit|diet|alimenta)');

-- A coach's specializations (a JSON array of strings).
INSERT INTO coach_category (user_id, category_id)
SELECT DISTINCT ip.user_id, c.id
  FROM instructor_profile ip
  CROSS JOIN LATERAL json_array_elements_text(
    CASE WHEN json_typeof(ip.specializations) = 'array'
      THEN ip.specializations ELSE '[]'::json END
  ) AS spec(value)
  JOIN category_words w ON fold_for_search(spec.value) ~ w.pattern
  JOIN category c ON c.slug = w.slug
ON CONFLICT DO NOTHING;

-- A group's tags (JSON array) and its name.
INSERT INTO group_category (group_id, category_id)
SELECT DISTINCT g.id, c.id
  FROM "group" g
  JOIN category_words w ON fold_for_search(
    concat_ws(' ', g.name, (
      SELECT string_agg(t.value, ' ')
        FROM json_array_elements_text(
          CASE WHEN json_typeof(g.tags::json) = 'array'
            THEN g.tags::json ELSE '[]'::json END
        ) AS t(value)
    ))
  ) ~ w.pattern
  JOIN category c ON c.slug = w.slug
 WHERE g.deleted_at IS NULL
ON CONFLICT DO NOTHING;

COMMIT;
