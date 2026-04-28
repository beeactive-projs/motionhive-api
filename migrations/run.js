#!/usr/bin/env node

/**
 * Database Migration Runner (PostgreSQL / Neon)
 *
 * Runs SQL migration files using pg (node-postgres).
 * Reads DB credentials from DATABASE_URL or individual env vars.
 *
 * SAFETY: bare `node migrations/run.js` runs in SAFE mode by default —
 * only NEW migrations execute, existing data is preserved. The
 * destructive 000_drop_existing_schema migration is gated behind the
 * explicit `--fresh` flag so a stray `npm run migrate` cannot wipe
 * developer or production data accidentally.
 *
 * Usage:
 *   node migrations/run.js              ← SAFE: only new migrations (default)
 *   node migrations/run.js --fresh      ← DESTRUCTIVE: drop everything + re-seed
 *   node migrations/run.js --only 008   ← Run only migration 008 (no drop)
 *   node migrations/run.js --from 008   ← Run from 008 onwards (no drop)
 *
 * npm scripts:
 *   npm run migrate                     ← SAFE (default)
 *   npm run migrate:fresh               ← DESTRUCTIVE: requires confirm
 *   npm run migrate:only 008            ← Surgical, single migration
 *
 * On deploy (automatic):
 *   railway:start / render:start runs the bare command, which is now
 *   SAFE by default — only NEW migrations execute, existing data is
 *   preserved. Same behaviour as before, just no longer dependent on
 *   the deploy script remembering the --safe flag.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load .env file if it exists (for local development)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        const value = trimmed.substring(eqIndex + 1).trim();
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
}

// Database config from environment
// Prefer DATABASE_URL (Neon connection string), fall back to individual vars
function getClientConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    };
  }

  return {
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432'),
    user: process.env.PGUSER || process.env.DB_USERNAME || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'postgres',
    database: process.env.PGDATABASE || process.env.DB_DATABASE || 'beeactive',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  };
}

// Auto-discover all .sql migration files, sorted by filename (numeric prefix)
const ALL_MIGRATIONS = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.sql'))
  .sort();

async function runMigrations() {
  const args = process.argv.slice(2);
  // Backwards-compat: --safe used to be the opt-in flag for safe mode
  // (when the default was destructive). Now safe IS the default; we
  // accept --safe as a no-op so existing scripts keep working.
  const isSafeExplicit = args.includes('--safe');
  const isFresh = args.includes('--fresh');
  const skipConfirm = args.includes('--yes') || args.includes('-y');
  const onlyFlag = args.indexOf('--only');
  const fromFlag = args.indexOf('--from');

  // Surgical modes (--only, --from) NEVER run 000_drop, regardless of
  // --fresh. They run the migration(s) you explicitly named.
  const isSurgical = onlyFlag !== -1 || fromFlag !== -1;

  // SAFETY: --fresh and --only/--from are mutually exclusive.
  if (isFresh && isSurgical) {
    console.error('ERROR: --fresh cannot be combined with --only or --from.');
    process.exit(1);
  }

  // The mode triple. Safe-by-default is the whole point of this rewrite.
  const mode = isFresh
    ? 'FRESH'
    : isSurgical
      ? 'SURGICAL'
      : 'SAFE';

  let migrations = [...ALL_MIGRATIONS];

  // --only 008 → run only that migration (no drop, no skip logic)
  if (onlyFlag !== -1 && args[onlyFlag + 1]) {
    const target = args[onlyFlag + 1];
    migrations = ALL_MIGRATIONS.filter((m) => m.startsWith(target));
    if (migrations.length === 0) {
      console.error(`No migration found matching: ${target}`);
      process.exit(1);
    }
  }

  // --from 008 → run from that migration onwards (no drop)
  if (fromFlag !== -1 && args[fromFlag + 1]) {
    const target = args[fromFlag + 1];
    const startIndex = ALL_MIGRATIONS.findIndex((m) => m.startsWith(target));
    if (startIndex === -1) {
      console.error(`No migration found matching: ${target}`);
      process.exit(1);
    }
    migrations = ALL_MIGRATIONS.slice(startIndex);
  }

  const config = getClientConfig();
  const displayHost = config.connectionString
    ? '(DATABASE_URL)'
    : `${config.host}:${config.port}`;
  const displayDb = config.connectionString
    ? new URL(config.connectionString).pathname.slice(1)
    : config.database;

  console.log('==========================================================');
  console.log('  BeeActive API - Database Migration Runner (PostgreSQL)');
  console.log('==========================================================');
  console.log(`  Host:     ${displayHost}`);
  console.log(`  Database: ${displayDb}`);
  console.log(
    `  Mode:     ${
      mode === 'FRESH'
        ? 'FRESH (drops everything + re-seeds!)'
        : mode === 'SURGICAL'
          ? 'SURGICAL (only the targeted migrations)'
          : 'SAFE (only new migrations, never drops)'
    }`,
  );
  console.log('==========================================================\n');

  if (isSafeExplicit) {
    console.log(
      'Note: --safe is now the default. The flag is accepted but no longer needed.\n',
    );
  }

  // FRESH-mode interactive confirm. Easy to bypass for CI by passing --yes,
  // but blocks the "I typed `npm run migrate:fresh` from muscle memory" footgun.
  if (mode === 'FRESH' && !skipConfirm) {
    const dbLabel = config.connectionString
      ? '(DATABASE_URL)'
      : `${config.host}:${config.port}/${config.database}`;
    const env = process.env.NODE_ENV || 'development';
    const isProdLike =
      env === 'production' ||
      env === 'staging' ||
      (config.connectionString || '').includes('neon.tech');

    if (isProdLike) {
      console.error(
        `REFUSED: --fresh is blocked when NODE_ENV=${env} or against a Neon DATABASE_URL.\n` +
          'Edit the runner manually if you really mean to wipe a hosted DB.',
      );
      process.exit(1);
    }

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise((resolve) =>
      rl.question(
        `\n  ⚠️  --fresh will DROP ALL TABLES on ${dbLabel}.\n` +
          '     Every row in user, invoice, payment, subscription, etc. will be lost.\n' +
          '     Type the word "FRESH" (uppercase) to confirm: ',
        (ans) => {
          rl.close();
          resolve(ans);
        },
      ),
    );
    if (answer.trim() !== 'FRESH') {
      console.log('\nAborted. No changes made.');
      process.exit(0);
    }
    console.log('');
  }

  const client = new Client(config);

  try {
    await client.connect();
    console.log('Connected to database.\n');

    // Always ensure tracking table exists (needed for safe mode).
    // 000_drop also drops it, so it gets recreated next iteration.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        ran_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Track the highest already-applied migration number so we can
    // distinguish "old seed migration obsoleted by a later structural
    // change" (safe to skip) from "new migration with a real bug"
    // (must fail loudly). Computed regardless of mode so it can be
    // referenced by the catch block below.
    const appliedRows = await client.query('SELECT name FROM _migrations');
    const appliedSet = new Set(appliedRows.rows.map((r) => r.name));
    const numericPrefix = (n) => {
      const m = /^(\d+)_/.exec(n);
      return m ? parseInt(m[1], 10) : -1;
    };
    const highestApplied = appliedRows.rows.reduce(
      (max, r) => Math.max(max, numericPrefix(r.name)),
      -1,
    );

    // SAFE mode: skip already-run migrations AND the drop migration.
    // This is the default — bare `npm run migrate` lands here.
    if (mode === 'SAFE') {
      migrations = migrations.filter(
        (m) => !appliedSet.has(m) && m !== '000_drop_existing_schema.sql',
      );

      if (migrations.length === 0) {
        console.log('All migrations are up to date. Nothing to run.\n');
        return;
      }

      console.log(`${migrations.length} new migration(s) to run.\n`);
    }

    // SURGICAL mode: never run 000_drop even if it matches the
    // pattern (it can't, since 000 doesn't match any --only/--from
    // target the user typed unless they pass `--only 000` explicitly).
    if (mode === 'SURGICAL') {
      migrations = migrations.filter(
        (m) => m !== '000_drop_existing_schema.sql',
      );
    }

    let failed = 0;

    for (const file of migrations) {
      const filePath = path.join(__dirname, file);

      if (!fs.existsSync(filePath)) {
        console.log(`SKIP: ${file} (file not found)`);
        continue;
      }

      process.stdout.write(`Running: ${file}... `);

      try {
        const sql = fs.readFileSync(filePath, 'utf-8');
        await client.query(sql);
        console.log('OK');

        // Record migration as run (for --safe mode tracking)
        if (file !== '000_drop_existing_schema.sql') {
          try {
            await client.query(
              'INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
              [file],
            );
          } catch (_) {
            // _migrations table might not exist if running fresh (000 drops it)
          }
        }
      } catch (err) {
        // In SAFE mode there are two flavours of "expected failure"
        // for which we record the migration as applied and move on:
        //
        //   A) Idempotent re-run of a file that was actually applied
        //      before tracking existed. Identified by "already exists"
        //      / "duplicate key" / "could not create unique index".
        //      Safe regardless of the migration's position in history.
        //
        //   B) Old seed migration that has been obsoleted by a later
        //      structural change (e.g. 009 inserts author_name; 033
        //      drops the column). Identified by "does not exist". We
        //      ONLY accept this for migrations whose number is BELOW
        //      the highest already-applied migration — otherwise a
        //      brand-new buggy migration that references a missing
        //      table would silently be marked applied. New migrations
        //      must fail loudly.
        //
        // FRESH and SURGICAL modes always fail loudly — the operator
        // explicitly chose to run the file.
        const msg = err.message || '';
        const fileNum = numericPrefix(file);
        const looksReRun =
          msg.includes('already exists') ||
          msg.includes('duplicate key') ||
          msg.includes('could not create unique index');
        const looksObsoleted =
          msg.includes('does not exist') &&
          fileNum >= 0 &&
          fileNum <= highestApplied;
        const isAlreadyApplied =
          mode === 'SAFE' && (looksReRun || looksObsoleted);

        if (isAlreadyApplied) {
          console.log('SKIP (already applied)');
          try {
            await client.query(
              'INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
              [file],
            );
          } catch (_) {}
        } else {
          console.log('FAILED');
          console.error(`  Error: ${err.message}`);
          failed++;
        }
      }
    }

    console.log('\n==========================================================');

    if (failed === 0) {
      console.log('  All migrations completed successfully!');
      console.log('==========================================================\n');

      if (migrations.includes('006_create_super_admin.sql')) {
        console.log('Super Admin Account:');
        console.log('  Email:    beeactivedev@gmail.com');
        console.log('  Password: BeeActive2026!Admin');
        console.log('\n  IMPORTANT: Change this password after first login!\n');
      }
    } else {
      console.log(`  ${failed} migration(s) failed`);
      console.log('==========================================================\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
