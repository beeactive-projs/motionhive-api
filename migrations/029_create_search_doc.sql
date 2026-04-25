-- 029_create_search_doc.sql
--
-- Global search infrastructure. One denormalized row per indexable
-- entity (user, instructor, group, session, tag) — kept fresh by
-- application-level write hooks in the corresponding services.
--
-- Design rationale lives in `docs/research/search/recommendations.md`.
-- Short version:
--   - tsvector with setweight() gives field-level relevance (title >> body)
--   - pg_trgm (LIKE/similarity) gives typo tolerance ("yga" → "yoga")
--   - One denormalized table beats per-entity indexes joined at query time:
--     a single GIN scan can sort & paginate; UNION ALL cannot.
--   - Application-level upsert (not triggers): simpler to test and debug,
--     no PL/pgSQL JSON-array flattening pain.

-- Enable trigram extension for fuzzy / typo-tolerant matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS search_doc (
  id            CHAR(36)    PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- One row per (entity_type, entity_id). Upserts dedupe on this pair.
  entity_type   VARCHAR(20) NOT NULL,
  entity_id     CHAR(36)    NOT NULL,

  -- Denormalized text columns. Keep them small, keep them readable —
  -- the search response renders straight from these without rejoining
  -- the source tables.
  title         TEXT        NOT NULL,           -- weight A: name, displayName, group/session title
  subtitle      TEXT,                           -- weight B: role, city, group cadence
  body          TEXT,                           -- weight C: bio, description
  tags          TEXT[]      DEFAULT '{}',       -- weight B: specializations, group tags
  city          TEXT,                           -- for proximity boost (day-30)

  -- Visibility & permissions, used by the search WHERE clause to
  -- avoid leaking private rows.
  is_public     BOOLEAN     NOT NULL DEFAULT TRUE,
  owner_id      CHAR(36),                       -- creator/owner; for "your own private rows still appear" logic
  -- Search avatar (resolved from the source entity at index time so
  -- the FE doesn't need a follow-up call).
  avatar_url    TEXT,

  -- Full-text search vector + lowercased trigram text.
  --
  -- These would naturally be GENERATED columns, but Postgres rejects
  -- `to_tsvector(<config>, …)` and `array_to_string` inside generated
  -- expressions because their volatility is STABLE, not IMMUTABLE.
  -- (`generation expression is not immutable`.)
  --
  -- Workaround: plain columns, populated by SearchIndexService._upsert.
  -- The service already builds the row from the source entity, so it
  -- pays nothing extra to compute these two strings server-side.
  search_vector TSVECTOR    NOT NULL DEFAULT ''::tsvector,
  search_text   TEXT        NOT NULL DEFAULT '',

  created_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT uk_search_doc_entity UNIQUE (entity_type, entity_id),
  CONSTRAINT chk_search_doc_entity_type CHECK (
    entity_type IN ('user', 'instructor', 'group', 'session', 'tag')
  )
);

-- GIN index on the tsvector — primary path for full-text queries.
CREATE INDEX IF NOT EXISTS idx_search_doc_vector
  ON search_doc USING GIN (search_vector);

-- GIN index on lowercased text using trigram ops — fuzzy/partial match
-- path. Used when the tsvector returns nothing (typos, partial words).
CREATE INDEX IF NOT EXISTS idx_search_doc_text_trgm
  ON search_doc USING GIN (search_text gin_trgm_ops);

-- Filter index for the common "public + entity_type" predicate so the
-- planner can shortcut visibility filtering.
CREATE INDEX IF NOT EXISTS idx_search_doc_public_type
  ON search_doc (entity_type, is_public);

-- Index on owner_id for "show the viewer's own private rows" subqueries.
CREATE INDEX IF NOT EXISTS idx_search_doc_owner
  ON search_doc (owner_id) WHERE owner_id IS NOT NULL;

COMMENT ON TABLE search_doc IS
  'Denormalized search index. One row per (entity_type, entity_id). Refreshed by SearchIndexService write hooks in the source-entity services.';
