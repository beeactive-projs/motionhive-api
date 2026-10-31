-- 077: global search ignores accents.
--
-- `search_doc` was indexed with plain lower(), so "bucuresti" never found
-- "București" and "forta" never found "Forță" (most phones type without
-- diacritics). The index now stores folded text, `fold_for_search()`
-- (unaccent + lower, migration 063), and the query folds the term the same
-- way, so accents never decide a match. The titles shown in results keep
-- their accents: only the derived columns change.
--
-- This rebuilds the two derived columns of every existing row with the
-- same weights `SearchIndexService.upsert` writes:
--   search_vector  title A, tags B, subtitle B, body C
--   search_text    title, subtitle, body and tags, for similarity()
-- New and updated rows are folded by the service itself.
--
-- Idempotent: a re-run computes the same values.

BEGIN;

UPDATE search_doc
SET
  search_vector =
    setweight(to_tsvector('simple', fold_for_search(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('simple', fold_for_search(array_to_string(coalesce(tags, '{}'::text[]), ' '))), 'B') ||
    setweight(to_tsvector('simple', fold_for_search(coalesce(subtitle, ''))), 'B') ||
    setweight(to_tsvector('simple', fold_for_search(coalesce(body, ''))), 'C'),
  search_text = fold_for_search(
    coalesce(title, '') || ' ' ||
    coalesce(subtitle, '') || ' ' ||
    coalesce(body, '') || ' ' ||
    array_to_string(coalesce(tags, '{}'::text[]), ' ')
  );

COMMIT;
