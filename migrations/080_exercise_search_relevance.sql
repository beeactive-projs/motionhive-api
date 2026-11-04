-- 080: exercise search that forgives how people type, and knows which
-- exercises people actually do.
--
--   * search_words(text)          — fold_for_search, then every run of
--                                   anything that is not a letter or a digit
--                                   becomes one space: "Push-Up, Wide" →
--                                   "push up wide". The API folds what was
--                                   typed the same way (`searchWords`), so
--                                   "push-up", "push up" and "Push Up" are
--                                   one search.
--   * exercise.search_name        — rebuilt with search_words, so the API
--                                   matches whole words and word starts
--                                   ("squat" finds "squats", "fly" finds
--                                   "flyes") instead of raw substrings, and
--                                   words typed together or apart ("pushup"
--                                   finds "Push-Up", "push up" finds
--                                   "Pushups").
--   * exercise.popularity_score   — 0 to 1, how much people use the exercise:
--                                   our editorial rank for the staples
--                                   blended with real logs and plans.
--                                   Written by the nightly
--                                   workouts.recompute_exercise_popularity
--                                   job (and once at boot while every score
--                                   is still 0). Ranking reads it; nothing
--                                   else should.
--
-- A generated column's expression cannot be changed in place before
-- Postgres 17, so search_name is dropped and added again; Postgres fills it
-- for every row. Idempotent: OR REPLACE / IF [NOT] EXISTS throughout.

BEGIN;

CREATE OR REPLACE FUNCTION search_words(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT btrim(regexp_replace(fold_for_search(input), '[^a-z0-9]+', ' ', 'g')) $$;

DROP INDEX IF EXISTS idx_exercise_search_name_trgm;
ALTER TABLE exercise DROP COLUMN IF EXISTS search_name;
ALTER TABLE exercise ADD COLUMN search_name TEXT
  GENERATED ALWAYS AS (
    search_words(name || ' ' || translated_names(translations))
  ) STORED;

-- Serves the word-start match (LIKE 'term%' / LIKE '% term%') and the close
-- match (word similarity).
CREATE INDEX IF NOT EXISTS idx_exercise_search_name_trgm
  ON exercise USING gin (search_name gin_trgm_ops);

ALTER TABLE exercise ADD COLUMN IF NOT EXISTS popularity_score REAL NOT NULL DEFAULT 0;
ALTER TABLE exercise DROP CONSTRAINT IF EXISTS exercise_popularity_score_range;
ALTER TABLE exercise ADD CONSTRAINT exercise_popularity_score_range
  CHECK (popularity_score >= 0 AND popularity_score <= 1);

COMMENT ON COLUMN exercise.popularity_score IS
  'How much people use this exercise, 0 to 1 (editorial rank blended with logs and plans). Written by the nightly recompute job; read by search ranking only.';

COMMIT;
