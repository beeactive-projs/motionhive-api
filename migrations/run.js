#!/usr/bin/env node

/**
 * Database Migration Runner (PostgreSQL / Neon)
 *
 * Runs SQL migration files using pg (node-postgres).
 * Reads DB credentials from DATABASE_URL or individual env vars.
 *
 * Usage:
 *   node migrations/run.js              ← Run ALL migrations (drops everything!)
 *   node migrations/run.js --safe       ← Only run NEW migrations (skips already-run ones)
 *   node migrations/run.js --only 008   ← Run only migration 008
 *   node migrations/run.js --from 008   ← Run from 008 onwards (no drop)
 *
 * npm scripts:
 *   npm run migrate                     ← Same as node migrations/run.js
 *   npm run migrate:only 008            ← Run only 008
 *
 * On deploy (automatic):
 *   railway:start / render:start runs with --safe flag
 *   Only NEW migrations execute, existing data is preserved
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
  const isSafe = args.includes('--safe');
  const onlyFlag = args.indexOf('--only');
  const fromFlag = args.indexOf('--from');

  let migrations = [...ALL_MIGRATIONS];

  // --only 008 → run only that migration
  if (onlyFlag !== -1 && args[onlyFlag + 1]) {
    const target = args[onlyFlag + 1];
    migrations = ALL_MIGRATIONS.filter((m) => m.startsWith(target));
    if (migrations.length === 0) {
      console.error(`No migration found matching: ${target}`);
      process.exit(1);
    }
  }

  // --from 008 → run from that migration onwards (skip drop)
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
  console.log(`  Mode:     ${isSafe ? 'SAFE (only new migrations)' : 'FULL (drops everything!)'}`);
  console.log('==========================================================\n');

  const client = new Client(config);

  try {
    await client.connect();
    console.log('Connected to database.\n');

    // Always ensure tracking table exists (needed for both full and safe modes)
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) NOT NULL PRIMARY KEY,
        ran_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // --safe mode: skip already-run migrations
    if (isSafe) {

      // Get already-run migrations
      const result = await client.query('SELECT name FROM _migrations');
      const alreadyRun = new Set(result.rows.map((r) => r.name));

      // Filter out already-run migrations AND the drop migration
      migrations = migrations.filter(
        (m) => !alreadyRun.has(m) && m !== '000_drop_existing_schema.sql',
      );

      if (migrations.length === 0) {
        console.log('All migrations are up to date. Nothing to run.\n');
        return;
      }

      console.log(`${migrations.length} new migration(s) to run.\n`);
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
        // In safe mode, "already exists" / "duplicate key" errors mean the migration
        // was run before tracking was in place — record it and move on
        const isAlreadyApplied =
          isSafe &&
          (err.message.includes('already exists') ||
            err.message.includes('duplicate key'));

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
