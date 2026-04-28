#!/usr/bin/env node

/**
 * Generates DATABASE.md — a live snapshot of the current database schema.
 * Called automatically by migrations/run.js after migrations succeed.
 * Can also be run manually: node migrations/generate-db-map.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load .env (same logic as run.js)
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

// Tables excluded from the map (internal/tracking tables)
const EXCLUDED_TABLES = new Set(['_migrations', 'SequelizeMeta']);

async function fetchSchema(client) {
  // All user tables
  const tablesResult = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = tablesResult.rows
    .map((r) => r.table_name)
    .filter((t) => !EXCLUDED_TABLES.has(t));

  // All columns
  const columnsResult = await client.query(`
    SELECT
      table_name,
      column_name,
      data_type,
      character_maximum_length,
      numeric_precision,
      numeric_scale,
      is_nullable,
      column_default,
      ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  // Primary keys
  const pkResult = await client.query(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
  `);

  // Unique constraints
  const uniqueResult = await client.query(`
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE'
      AND tc.table_schema = 'public'
  `);

  // Foreign keys
  const fkResult = await client.query(`
    SELECT
      kcu.table_name,
      kcu.column_name,
      ccu.table_name AS ref_table,
      ccu.column_name AS ref_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY kcu.table_name, kcu.column_name
  `);

  // Indexes (non-primary)
  const indexResult = await client.query(`
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      array_agg(a.attname ORDER BY u.k) AS columns
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS u(attnum, k) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND NOT ix.indisprimary
    GROUP BY t.relname, i.relname, ix.indisunique
    ORDER BY t.relname, i.relname
  `);

  // Row counts
  const countQueries = tables.map((t) =>
    client.query(`SELECT COUNT(*) AS cnt FROM "${t}"`).then((r) => [t, parseInt(r.rows[0].cnt)]),
  );
  const counts = Object.fromEntries(await Promise.all(countQueries));

  // Organise by table
  const columnsByTable = {};
  for (const row of columnsResult.rows) {
    if (!columnsByTable[row.table_name]) columnsByTable[row.table_name] = [];
    columnsByTable[row.table_name].push(row);
  }

  const pkSet = new Set(pkResult.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const uniqueSet = new Set(uniqueResult.rows.map((r) => `${r.table_name}.${r.column_name}`));

  const fksByTable = {};
  for (const row of fkResult.rows) {
    if (!fksByTable[row.table_name]) fksByTable[row.table_name] = [];
    fksByTable[row.table_name].push(row);
  }

  const indexesByTable = {};
  for (const row of indexResult.rows) {
    if (!indexesByTable[row.table_name]) indexesByTable[row.table_name] = [];
    // pg returns array_agg as '{col1,col2}' string — normalize to JS array
    if (!Array.isArray(row.columns)) {
      row.columns = String(row.columns).replace(/^\{|\}$/g, '').split(',');
    }
    indexesByTable[row.table_name].push(row);
  }

  return { tables, columnsByTable, pkSet, uniqueSet, fksByTable, indexesByTable, counts, fkRows: fkResult.rows };
}

function formatType(col) {
  if (col.data_type === 'character varying' && col.character_maximum_length) {
    return `varchar(${col.character_maximum_length})`;
  }
  if (col.data_type === 'numeric' && col.numeric_precision) {
    return `numeric(${col.numeric_precision},${col.numeric_scale ?? 0})`;
  }
  const aliases = {
    'character varying': 'varchar',
    'timestamp without time zone': 'timestamp',
    'timestamp with time zone': 'timestamptz',
    'double precision': 'float8',
    'integer': 'int',
    'bigint': 'int8',
    'boolean': 'bool',
    'text': 'text',
  };
  return aliases[col.data_type] ?? col.data_type;
}

function formatDefault(raw) {
  if (!raw) return '';
  // Trim verbose casts like '::character varying' or nextval(...) references
  return raw.replace(/::[\w\s]+/g, '').replace(/^'(.*)'$/, '$1').trim();
}

function generateMarkdown(schema, generatedAt) {
  const { tables, columnsByTable, pkSet, uniqueSet, fksByTable, indexesByTable, counts, fkRows } = schema;
  const lines = [];

  lines.push(`# Database schema`);
  lines.push(``);
  lines.push(`> Auto-generated by \`migrations/generate-db-map.js\` — do not edit manually.  `);
  lines.push(`> Last updated: **${generatedAt}**`);
  lines.push(``);

  // Summary table
  lines.push(`## Tables (${tables.length})`);
  lines.push(``);
  lines.push(`| Table | Columns | Rows |`);
  lines.push(`|-------|---------|------|`);
  for (const t of tables) {
    const cols = (columnsByTable[t] || []).length;
    const rows = counts[t] ?? '—';
    lines.push(`| [${t}](#${t.replace(/_/g, '-')}) | ${cols} | ${rows} |`);
  }
  lines.push(``);

  // Relationships section
  if (fkRows.length > 0) {
    lines.push(`## Relationships`);
    lines.push(``);
    lines.push(`| Table | Column | References |`);
    lines.push(`|-------|--------|------------|`);
    for (const fk of fkRows) {
      if (EXCLUDED_TABLES.has(fk.table_name)) continue;
      lines.push(`| ${fk.table_name} | ${fk.column_name} | ${fk.ref_table}.${fk.ref_column} |`);
    }
    lines.push(``);
  }

  // Per-table detail
  lines.push(`## Table details`);
  lines.push(``);

  for (const t of tables) {
    const cols = columnsByTable[t] || [];
    const fks = fksByTable[t] || [];
    const indexes = indexesByTable[t] || [];
    const fkMap = Object.fromEntries(fks.map((f) => [f.column_name, f]));

    lines.push(`### ${t}`);
    lines.push(``);

    lines.push(`| Column | Type | Nullable | Default | Notes |`);
    lines.push(`|--------|------|----------|---------|-------|`);

    for (const col of cols) {
      const key = `${t}.${col.column_name}`;
      const isPk = pkSet.has(key);
      const isUnique = uniqueSet.has(key);
      const fk = fkMap[col.column_name];
      const notes = [
        isPk ? '🔑 PK' : '',
        isUnique && !isPk ? 'unique' : '',
        fk ? `→ ${fk.ref_table}.${fk.ref_column}` : '',
      ].filter(Boolean).join(', ');

      lines.push(
        `| ${col.column_name} | ${formatType(col)} | ${col.is_nullable === 'YES' ? 'yes' : 'no'} | ${formatDefault(col.column_default)} | ${notes} |`,
      );
    }

    if (indexes.length > 0) {
      lines.push(``);
      lines.push(`**Indexes**`);
      lines.push(``);
      for (const idx of indexes) {
        const unique = idx.is_unique ? ' (unique)' : '';
        lines.push(`- \`${idx.index_name}\`${unique} on \`${idx.columns.join(', ')}\``);
      }
    }

    lines.push(``);
  }

  return lines.join('\n');
}

async function generateDbMap() {
  const client = new Client(getClientConfig());

  try {
    await client.connect();

    process.stdout.write('Generating DATABASE.md... ');

    const schema = await fetchSchema(client);
    const generatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const markdown = generateMarkdown(schema, generatedAt);

    const outputPath = path.join(__dirname, '..', 'DATABASE.md');
    fs.writeFileSync(outputPath, markdown, 'utf-8');

    console.log(`OK (${schema.tables.length} tables → DATABASE.md)`);
  } catch (err) {
    // Non-fatal — map generation failing should never block a deploy
    console.warn(`WARN: Could not generate DATABASE.md: ${err.message}`);
  } finally {
    await client.end();
  }
}

// Run directly or export for use by run.js
if (require.main === module) {
  generateDbMap();
} else {
  module.exports = { generateDbMap };
}
