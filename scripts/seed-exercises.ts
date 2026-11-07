/**
 * Seed the SYSTEM exercise catalog from the Free Exercise DB.
 *
 *   Source:  https://github.com/yuhonas/free-exercise-db  (Unlicense)
 *   Schema:  migration 047  (exercise + exercise_muscle + exercise_equipment
 *                            + exercise_media)
 *
 * The Free Exercise DB ships ~870 exercises with two JPG frames each
 * (start + end). We DON'T re-host the JPGs — V1 serves them from
 * jsDelivr against the upstream repo (zero storage cost, no Cloudinary
 * bandwidth burn). If yuhonas ever takes the repo down, we re-host
 * then; by then we have revenue. Locked in `04-locked-decisions.md` §17
 * via the design-validation pass.
 *
 * Idempotent: re-running upserts on (source_provider, source_external_id).
 * Safe to run on a partial-success state.
 *
 * Usage:
 *   npx tsx scripts/seed-exercises.ts             # full seed
 *   npx tsx scripts/seed-exercises.ts --dry-run   # parse + print, no writes
 *   npx tsx scripts/seed-exercises.ts --limit 10  # first N exercises only
 *   FED_CACHE=./tmp/fed.json npx tsx ...          # use local cached JSON
 *
 * Run after migration 047 has applied. The script reads DATABASE_URL
 * (or DB_HOST / DB_PORT / etc.) from .env exactly like migrations/run.js.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

// ─── Constants ────────────────────────────────────────────────────────

const FED_JSON_URL =
  'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';

/** jsDelivr CDN URL pattern for FED images. Two per exercise (0.jpg start, 1.jpg end). */
const JSDELIVR_BASE =
  'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises';

const PROVIDER = 'free-exercise-db';
const MEDIA_PROVIDER = 'jsdelivr';

// ─── FED → MotionHive enum maps ──────────────────────────────────────

const KIND_MAP: Record<string, string> = {
  strength: 'STRENGTH',
  stretching: 'MOBILITY',
  plyometrics: 'BODYWEIGHT',
  strongman: 'STRENGTH',
  powerlifting: 'STRENGTH',
  cardio: 'CARDIO',
  'olympic weightlifting': 'STRENGTH',
};

const LEVEL_MAP: Record<string, string> = {
  beginner: 'BEGINNER',
  intermediate: 'INTERMEDIATE',
  expert: 'ADVANCED',
};

const FORCE_MAP: Record<string, string> = {
  push: 'PUSH',
  pull: 'PULL',
  static: 'STATIC',
};

const MECHANIC_MAP: Record<string, string> = {
  compound: 'COMPOUND',
  isolation: 'ISOLATION',
};

/** FED equipment string → our equipment.slug. Unmapped → 'other'. */
const EQUIPMENT_MAP: Record<string, string> = {
  'body only': 'bodyweight',
  machine: 'machine',
  other: 'other',
  'foam roll': 'foam_roller',
  kettlebells: 'kettlebell',
  dumbbell: 'dumbbell',
  cable: 'cable',
  barbell: 'barbell',
  bands: 'bands',
  'medicine ball': 'medicine_ball',
  'exercise ball': 'exercise_ball',
  'e-z curl bar': 'ez_bar',
};

/** FED muscle string → our muscle.slug. Identity for the common ones. */
const MUSCLE_MAP: Record<string, string> = {
  abdominals: 'abdominals',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'middle_back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
};

// ─── FED record shape ────────────────────────────────────────────────

interface FedExercise {
  id: string; // e.g. "Barbell_Squat"
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[]; // e.g. ["Barbell_Squat/0.jpg", "Barbell_Squat/1.jpg"]
}

// ─── CLI ─────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT =
  LIMIT_ARG >= 0 && process.argv[LIMIT_ARG + 1]
    ? parseInt(process.argv[LIMIT_ARG + 1], 10)
    : null;

// ─── Helpers ─────────────────────────────────────────────────────────

function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'exercise'
  );
}

function getClientConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false } as const,
    };
  }
  return {
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
    user: process.env.PGUSER || process.env.DB_USERNAME || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'postgres',
    database: process.env.PGDATABASE || process.env.DB_DATABASE || 'beeactive',
    ssl:
      process.env.NODE_ENV === 'production'
        ? ({ rejectUnauthorized: false } as const)
        : undefined,
  };
}

async function fetchSource(): Promise<FedExercise[]> {
  if (process.env.FED_CACHE) {
    const p = path.resolve(process.env.FED_CACHE);
    if (fs.existsSync(p)) {
      console.log(`Reading cached FED JSON from ${p}`);
      return JSON.parse(fs.readFileSync(p, 'utf8')) as FedExercise[];
    }
    console.warn(`FED_CACHE set but ${p} missing — falling back to fetch`);
  }
  console.log(`Fetching ${FED_JSON_URL}`);
  const res = await fetch(FED_JSON_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Free Exercise DB JSON: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as FedExercise[];
}

interface TaxonomyMap {
  muscles: Map<string, string>; // slug -> id
  equipment: Map<string, string>; // slug -> id
}

async function loadTaxonomy(client: Client): Promise<TaxonomyMap> {
  const muscles = new Map<string, string>();
  const equipment = new Map<string, string>();
  const m = await client.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM muscle',
  );
  for (const r of m.rows) muscles.set(r.slug, r.id);
  const e = await client.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM equipment',
  );
  for (const r of e.rows) equipment.set(r.slug, r.id);
  return { muscles, equipment };
}

interface SeedStats {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

// ─── Per-exercise upsert ─────────────────────────────────────────────

async function upsertExercise(
  client: Client,
  fed: FedExercise,
  tax: TaxonomyMap,
  stats: SeedStats,
): Promise<void> {
  const kind = KIND_MAP[fed.category.toLowerCase()] ?? 'STRENGTH';
  const level = LEVEL_MAP[fed.level?.toLowerCase()] ?? 'BEGINNER';
  const force = fed.force ? (FORCE_MAP[fed.force.toLowerCase()] ?? null) : null;
  const mechanic = fed.mechanic
    ? (MECHANIC_MAP[fed.mechanic.toLowerCase()] ?? null)
    : null;
  const instructions =
    fed.instructions?.length > 0 ? fed.instructions.join('\n\n') : null;

  const primaryMuscleIds = fed.primaryMuscles
    .map((s) => tax.muscles.get(MUSCLE_MAP[s.toLowerCase()] ?? ''))
    .filter(Boolean) as string[];
  const secondaryMuscleIds = fed.secondaryMuscles
    .map((s) => tax.muscles.get(MUSCLE_MAP[s.toLowerCase()] ?? ''))
    .filter(Boolean) as string[];

  // Bodyweight when FED has no equipment string.
  const equipmentSlugs = fed.equipment
    ? [EQUIPMENT_MAP[fed.equipment.toLowerCase()] ?? 'other']
    : ['bodyweight'];
  const equipmentIds = equipmentSlugs
    .map((s) => tax.equipment.get(s))
    .filter(Boolean) as string[];

  if (primaryMuscleIds.length === 0) {
    console.warn(
      `  ! skipping "${fed.name}" — no primary muscles mapped from ${JSON.stringify(fed.primaryMuscles)}`,
    );
    stats.skipped++;
    return;
  }

  const startImageUrl = fed.images[0]
    ? `${JSDELIVR_BASE}/${fed.images[0]}`
    : null;
  const endImageUrl = fed.images[1]
    ? `${JSDELIVR_BASE}/${fed.images[1]}`
    : null;
  const mediaKind = startImageUrl ? 'IMAGE' : 'NONE';

  if (DRY_RUN) {
    console.log(
      `  ✓ DRY ${fed.id} kind=${kind} level=${level} muscles=${primaryMuscleIds.length}/${secondaryMuscleIds.length} eq=${equipmentIds.length} images=${fed.images.length}`,
    );
    stats.inserted++;
    return;
  }

  await client.query('BEGIN');
  try {
    // Skip if already seeded — we identify rows by provider+external_id.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM exercise
        WHERE source = 'SYSTEM'
          AND source_provider = $1
          AND source_external_id = $2
          AND deleted_at IS NULL`,
      [PROVIDER, fed.id],
    );

    if (existing.rows.length > 0) {
      // Refresh mutable surface (name, thumbnail, instructions) so a
      // re-run after an upstream update converges. M2M rebuild is a
      // delete-then-insert.
      const id = existing.rows[0].id;
      await client.query(
        `UPDATE exercise SET
            name = $1,
            instructions = $2,
            kind = $3,
            level = $4,
            force = $5,
            mechanic = $6,
            media_kind = $7,
            thumbnail_url = $8,
            updated_at = NOW()
          WHERE id = $9`,
        [
          fed.name,
          instructions,
          kind,
          level,
          force,
          mechanic,
          mediaKind,
          startImageUrl,
          id,
        ],
      );
      await client.query('DELETE FROM exercise_muscle WHERE exercise_id = $1', [
        id,
      ]);
      await client.query(
        'DELETE FROM exercise_equipment WHERE exercise_id = $1',
        [id],
      );
      await client.query('DELETE FROM exercise_media WHERE exercise_id = $1', [
        id,
      ]);
      await insertChildRows(
        client,
        id,
        primaryMuscleIds,
        secondaryMuscleIds,
        equipmentIds,
        startImageUrl,
        endImageUrl,
        mediaKind,
      );
      await client.query('COMMIT');
      stats.updated++;
      return;
    }

    // Fresh insert.
    const slug = slugify(fed.name);
    const insert = await client.query<{ id: string }>(
      `INSERT INTO exercise
         (id, name, slug, instructions, kind, level, force, mechanic,
          source, owner_id, visibility, source_provider, source_external_id,
          media_kind, thumbnail_url)
       VALUES
         (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
          'SYSTEM', NULL, 'PUBLIC', $8, $9,
          $10, $11)
       RETURNING id`,
      [
        fed.name,
        slug,
        instructions,
        kind,
        level,
        force,
        mechanic,
        PROVIDER,
        fed.id,
        mediaKind,
        startImageUrl,
      ],
    );
    const newId = insert.rows[0].id;
    await insertChildRows(
      client,
      newId,
      primaryMuscleIds,
      secondaryMuscleIds,
      equipmentIds,
      startImageUrl,
      endImageUrl,
      mediaKind,
    );
    await client.query('COMMIT');
    stats.inserted++;
  } catch (err) {
    await client.query('ROLLBACK');
    stats.errors++;
    console.error(`  ✗ ${fed.id}: ${(err as Error).message}`);
  }
}

async function insertChildRows(
  client: Client,
  exerciseId: string,
  primaryMuscleIds: string[],
  secondaryMuscleIds: string[],
  equipmentIds: string[],
  startImageUrl: string | null,
  endImageUrl: string | null,
  mediaKind: string,
): Promise<void> {
  // Muscles
  for (const muscleId of primaryMuscleIds) {
    await client.query(
      `INSERT INTO exercise_muscle (exercise_id, muscle_id, role) VALUES ($1, $2, 'PRIMARY')`,
      [exerciseId, muscleId],
    );
  }
  for (const muscleId of secondaryMuscleIds) {
    // FED secondary lists sometimes overlap primary — primary wins.
    if (primaryMuscleIds.includes(muscleId)) continue;
    await client.query(
      `INSERT INTO exercise_muscle (exercise_id, muscle_id, role) VALUES ($1, $2, 'SECONDARY')`,
      [exerciseId, muscleId],
    );
  }
  // Equipment
  const seenEq = new Set<string>();
  for (const equipmentId of equipmentIds) {
    if (seenEq.has(equipmentId)) continue;
    seenEq.add(equipmentId);
    await client.query(
      `INSERT INTO exercise_equipment (exercise_id, equipment_id) VALUES ($1, $2)`,
      [exerciseId, equipmentId],
    );
  }
  // Media — two rows when both frames exist; one row when only the start exists.
  if (startImageUrl && mediaKind === 'IMAGE') {
    await client.query(
      `INSERT INTO exercise_media
         (id, exercise_id, provider, kind, url, display_order, is_primary)
       VALUES (gen_random_uuid()::text, $1, $2, 'IMAGE', $3, 0, TRUE)`,
      [exerciseId, MEDIA_PROVIDER, startImageUrl],
    );
    if (endImageUrl) {
      await client.query(
        `INSERT INTO exercise_media
           (id, exercise_id, provider, kind, url, display_order, is_primary)
         VALUES (gen_random_uuid()::text, $1, $2, 'IMAGE', $3, 1, FALSE)`,
        [exerciseId, MEDIA_PROVIDER, endImageUrl],
      );
    }
  }
}

// ─── Search-doc backfill ─────────────────────────────────────────────

/**
 * Bulk-mirror system exercises into `search_doc` so global search hits
 * them. The application's `SearchIndexService.upsertExercise` does this
 * row-by-row inside the create/update transaction; the seed bypasses
 * the service layer, so we replay the same row shape in SQL here.
 *
 * `search_vector` and `search_text` are NOT generated columns — the
 * service builds them inside the INSERT (see `_upsert` in
 * `search-index.service.ts`). The expressions below MUST match that
 * service's computation; if you change one, change both.
 */
async function backfillSearchIndex(client: Client): Promise<void> {
  console.log('\nBackfilling search_doc for system exercises…');
  const res = await client.query(`
    INSERT INTO search_doc
      (id, entity_type, entity_id, title, subtitle, body, tags, city,
       is_public, owner_id, avatar_url, search_vector, search_text, updated_at)
    SELECT
      gen_random_uuid()::text,
      'exercise',
      e.id,
      e.name,
      (
        SELECT string_agg(m.common_name, ', ' ORDER BY m.display_order)
          FROM exercise_muscle em
          JOIN muscle m ON m.id = em.muscle_id
         WHERE em.exercise_id = e.id AND em.role = 'PRIMARY'
      ) AS subtitle,
      NULLIF(CONCAT_WS(E'\\n\\n', e.description, e.instructions), '') AS body,
      ARRAY[]::text[],
      NULL,
      TRUE,
      e.owner_id,
      e.thumbnail_url,
      setweight(to_tsvector('simple', fold_for_search(coalesce(e.name, ''))), 'A') ||
        setweight(to_tsvector('simple', fold_for_search(coalesce(
          (SELECT string_agg(m.common_name, ', ' ORDER BY m.display_order)
             FROM exercise_muscle em JOIN muscle m ON m.id = em.muscle_id
            WHERE em.exercise_id = e.id AND em.role = 'PRIMARY'), ''))), 'B') ||
        setweight(to_tsvector('simple', fold_for_search(coalesce(NULLIF(CONCAT_WS(E'\\n\\n', e.description, e.instructions), ''), ''))), 'C'),
      fold_for_search(
        coalesce(e.name, '') || ' ' ||
        coalesce(
          (SELECT string_agg(m.common_name, ', ' ORDER BY m.display_order)
             FROM exercise_muscle em JOIN muscle m ON m.id = em.muscle_id
            WHERE em.exercise_id = e.id AND em.role = 'PRIMARY'), '') || ' ' ||
        coalesce(NULLIF(CONCAT_WS(E'\\n\\n', e.description, e.instructions), ''), '')
      ),
      NOW()
    FROM exercise e
    WHERE e.deleted_at IS NULL AND e.source = 'SYSTEM'
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      body = EXCLUDED.body,
      avatar_url = EXCLUDED.avatar_url,
      search_vector = EXCLUDED.search_vector,
      search_text = EXCLUDED.search_text,
      updated_at = NOW();
  `);
  console.log(`  ✓ search_doc upserted ${res.rowCount ?? 0} exercise rows`);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const stats: SeedStats = {
    total: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  const data = await fetchSource();
  const slice = LIMIT ? data.slice(0, LIMIT) : data;
  stats.total = slice.length;

  console.log(
    `Seeding ${slice.length} exercises${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…\n`,
  );

  const client = new Client(getClientConfig());
  await client.connect();

  try {
    const tax = await loadTaxonomy(client);
    if (tax.muscles.size === 0) {
      throw new Error(
        'No rows in `muscle` table. Run migration 047 first (it seeds the taxonomy).',
      );
    }
    if (tax.equipment.size === 0) {
      throw new Error('No rows in `equipment` table. Run migration 047 first.');
    }

    for (let i = 0; i < slice.length; i++) {
      const fed = slice[i];
      if (i % 50 === 0) console.log(`  [${i}/${slice.length}] …`);
      await upsertExercise(client, fed, tax, stats);
    }

    if (!DRY_RUN) {
      await backfillSearchIndex(client);
    }
  } finally {
    await client.end();
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`Total:    ${stats.total}`);
  console.log(`Inserted: ${stats.inserted}`);
  console.log(`Updated:  ${stats.updated}`);
  console.log(`Skipped:  ${stats.skipped}`);
  console.log(`Errors:   ${stats.errors}`);
  console.log('─────────────────────────────────────────');

  if (stats.errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
