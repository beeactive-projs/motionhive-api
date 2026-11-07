/**
 * Moves every picture the database points at from Cloudinary to
 * Cloudflare R2, then rewrites the links. Safe to run more than once:
 * files already in R2 are skipped and a moved link no longer matches.
 *
 *   # local database, from .env (dry run: reads only, writes nothing)
 *   npx tsx --env-file=.env scripts/move-media-to-r2.ts
 *   npx tsx --env-file=.env scripts/move-media-to-r2.ts --apply
 *
 *   # just list what the database links to (needs no R2 keys)
 *   npx tsx --env-file=.env scripts/move-media-to-r2.ts --scan-only
 *
 *   # a Railway environment, its variables injected by the CLI
 *   railway run -e <environment> -s <service> npx tsx scripts/move-media-to-r2.ts
 *   railway run -e <environment> -s <service> npx tsx scripts/move-media-to-r2.ts --apply
 *
 * No `.env` is read unless you pass it, so a Railway run can never pick
 * up local keys by accident. The first lines printed name the database,
 * buckets and public URL: check them before passing --apply.
 *
 * What it finds:
 *   - public pictures: any link into our Cloudinary account, in ANY text,
 *     JSON or text-array column (avatars, covers, posts, exercise
 *     pictures, notification icons, search rows, blog bodies...). Each
 *     file is copied to the public bucket under the same path, with the
 *     camera metadata stripped, and every link to it is rewritten.
 *   - private workout photos (`workout_log.photo_public_id`): copied to
 *     the private bucket with a thumbnail; the stored id stays as it is.
 *   - the email logo, which the email layout links to directly.
 *
 * A file Cloudinary cannot serve is reported and its links are left
 * alone, so nothing ever points at a file that is not there.
 */
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { v2 as cloudinary } from 'cloudinary';
import { Options, QueryTypes, Sequelize, Transaction } from 'sequelize';
import sharp from 'sharp';

import {
  privateKey,
  privatePhotoVariants,
} from '../src/common/utils/image-processing';

const APPLY = process.argv.includes('--apply');
const SCAN_ONLY = process.argv.includes('--scan-only');
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const FETCH_TIMEOUT_MS = 30_000;

/** Files linked from code, not from the database. */
const STATIC_FILES = [
  {
    source:
      'https://res.cloudinary.com/dom4dfr1q/image/upload/v1778503491/logo-bg-navy-sm_1_ac6drj.png',
    key: 'motionhive/static/email/logo-bg-navy-sm.png',
  },
];

interface Column {
  table: string;
  column: string;
  dataType: string;
  udtName: string;
}

interface PublicAsset {
  /** Every exact link string found in the database for this file. */
  oldUrls: Set<string>;
  sourceUrl: string;
  key: string;
  newUrl: string;
  /** Where it was found, for the report. */
  places: Set<string>;
}

interface Report {
  copied: number;
  alreadyThere: number;
  failed: { what: string; why: string }[];
  bytes: number;
}

// ─── Setup ─────────────────────────────────────────────────────────────

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Pass --env-file=.env or run through railway run.`,
    );
    process.exit(1);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const cloudName = required('CLOUDINARY_CLOUD_NAME');
cloudinary.config({
  cloud_name: cloudName,
  api_key: required('CLOUDINARY_API_KEY'),
  api_secret: required('CLOUDINARY_API_SECRET'),
});
/** An R2 setting; a scan does not touch storage, so it may be missing then. */
function r2(name: string): string {
  if (!SCAN_ONLY) {
    return required(name);
  }
  return process.env[name] ?? '(not set)';
}
let endpoint = 'https://unused.invalid';
if (!SCAN_ONLY) {
  endpoint = required('R2_ENDPOINT');
}
const publicBucket = r2('R2_PUBLIC_BUCKET');
const privateBucket = r2('R2_PRIVATE_BUCKET');
const mediaBase = r2('MEDIA_PUBLIC_URL').replace(/\/+$/, '');
const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: r2('R2_ACCESS_KEY_ID'),
    secretAccessKey: r2('R2_SECRET_ACCESS_KEY'),
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

function connect(): { db: Sequelize; label: string } {
  const url = process.env.DATABASE_URL;
  const ssl = { require: true, rejectUnauthorized: false };
  if (url) {
    const parsed = new URL(url);
    return {
      db: new Sequelize(url, {
        dialect: 'postgres',
        logging: false,
        dialectOptions: { ssl },
      }),
      label: `${parsed.hostname}/${parsed.pathname.slice(1)}`,
    };
  }
  // Same lookup order as src/config/database.config.ts: PG* first.
  const host = firstSet(['PGHOST', 'DB_HOST'], 'localhost');
  const database = firstSet(['PGDATABASE', 'DB_DATABASE'], '');
  const options: Options = {
    dialect: 'postgres',
    logging: false,
    host,
    port: Number(firstSet(['PGPORT', 'DB_PORT'], '5432')),
    username: firstSet(['PGUSER', 'DB_USERNAME'], ''),
    password: firstSet(['PGPASSWORD', 'DB_PASSWORD'], ''),
    database,
  };
  if (nodeEnv === 'production') {
    options.dialectOptions = { ssl };
  }
  return { db: new Sequelize(options), label: `${host}/${database}` };
}

/** The value of the first variable that is set, else `fallback`. */
function firstSet(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return fallback;
}

// ─── Finding links ─────────────────────────────────────────────────────

/** Our own Cloudinary links: upload type, any transformation or version. */
function linkPattern(): RegExp {
  const cloud = cloudName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `https://res\\.cloudinary\\.com/${cloud}/image/upload/[^\\s"'<>()\\\\{}]+`,
    'g',
  );
}

export function linksIn(text: string): string[] {
  const links: string[] = [];
  for (const match of text.match(linkPattern()) ?? []) {
    // Two links written back to back ("a.jpg,https://…") are two links.
    for (const part of match.split(/,(?=https:\/\/)/)) {
      // Prose after a link ("…/a.jpg, then") is not part of it.
      links.push(part.replace(/[.,;:!?]+$/, ''));
    }
  }
  return links;
}

/** `c_fill,w_80` and friends: Cloudinary's transformation segments. */
function isTransformation(segment: string): boolean {
  return segment.split(',').every((part) => /^[a-z]{1,3}_[^/]*$/.test(part));
}

/**
 * The file behind a link: its public id and extension, without the
 * version or any transformation, which R2 does not need.
 */
export function parseLink(
  link: string,
): { publicId: string; ext: string } | null {
  const segments = new URL(link).pathname.split('/').filter(Boolean);
  // [cloud, 'image', 'upload', ...rest]
  let rest = segments.slice(3).map(decodeURIComponent);
  const version = rest.findIndex((s) => /^v\d+$/.test(s));
  if (version >= 0) {
    rest = rest.slice(version + 1);
  } else {
    while (rest.length > 1 && isTransformation(rest[0])) {
      rest = rest.slice(1);
    }
  }
  const last = rest.pop();
  if (!last) {
    return null;
  }
  const dot = last.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  return {
    publicId: [...rest, last.slice(0, dot)].join('/'),
    ext: last.slice(dot + 1).toLowerCase(),
  };
}

/**
 * Our files keep their path. Older uploads from before the
 * `motionhive/<env>/` layout get one, under `legacy/`, so the API
 * recognises every moved link as its own.
 */
export function keyFor(publicId: string, ext: string): string {
  if (publicId.startsWith('motionhive/')) {
    return `${publicId}.${ext}`;
  }
  return `motionhive/${nodeEnv}/legacy/${publicId}.${ext}`;
}

async function textColumns(db: Sequelize): Promise<Column[]> {
  return db.query<Column>(
    `SELECT table_name AS "table", column_name AS "column",
            data_type AS "dataType", udt_name AS "udtName"
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
             OR (data_type = 'ARRAY' AND udt_name IN ('_text', '_varchar')))
      ORDER BY table_name, column_name`,
    { type: QueryTypes.SELECT },
  );
}

const quote = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const isArray = (c: Column): boolean => c.dataType === 'ARRAY';
const isJson = (c: Column): boolean =>
  c.dataType === 'json' || c.dataType === 'jsonb';

/** Every link to our Cloudinary account in one column. */
async function linksInColumn(db: Sequelize, c: Column): Promise<string[]> {
  const needle = `res.cloudinary.com/${cloudName}/`;
  const col = quote(c.column);
  let sql = `SELECT ${col}::text AS v FROM ${quote(c.table)}
        WHERE strpos(${col}::text, $1) > 0`;
  if (isArray(c)) {
    sql = `SELECT unnest(${col}) AS v FROM ${quote(c.table)}
        WHERE strpos(array_to_string(${col}, ' '), $1) > 0`;
  }
  const rows = await db.query<{ v: string | null }>(sql, {
    bind: [needle],
    type: QueryTypes.SELECT,
  });
  const links: string[] = [];
  for (const row of rows) {
    if (row.v) {
      links.push(...linksIn(row.v));
    }
  }
  return links;
}

// ─── Storage ───────────────────────────────────────────────────────────

async function exists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err instanceof NotFound) {
      return false;
    }
    if ((err as { name?: string }).name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

async function download(url: string): Promise<{ body: Buffer; type: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  let type = res.headers.get('content-type');
  if (!type) {
    type = 'application/octet-stream';
  }
  return { body: Buffer.from(await res.arrayBuffer()), type };
}

/**
 * The same picture without camera metadata, in its own format (the key
 * keeps its extension). GIF and anything sharp cannot write go as they are.
 */
async function withoutMetadata(body: Buffer): Promise<Buffer> {
  try {
    const { format } = await sharp(body).metadata();
    if (format === 'jpeg') {
      return await sharp(body)
        .rotate()
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer();
    }
    if (format === 'png') {
      return await sharp(body).rotate().png().toBuffer();
    }
    if (format === 'webp') {
      return await sharp(body).rotate().webp({ quality: 90 }).toBuffer();
    }
  } catch {
    /* not something sharp reads: keep the bytes */
  }
  return body;
}

async function putPublic(
  key: string,
  body: Buffer,
  type: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: publicBucket,
      Key: key,
      Body: body,
      ContentType: type,
      CacheControl: PUBLIC_CACHE_CONTROL,
    }),
  );
}

async function putPrivate(key: string, body: Buffer): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: privateBucket,
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
    }),
  );
}

/** Proves the keys work on both buckets before anything else runs. */
async function checkBuckets(): Promise<void> {
  for (const bucket of [publicBucket, privateBucket]) {
    await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  }
}

// ─── Steps ─────────────────────────────────────────────────────────────

async function copyPublic(
  assets: PublicAsset[],
  report: Report,
): Promise<void> {
  for (const asset of assets) {
    try {
      if (await exists(publicBucket, asset.key)) {
        report.alreadyThere++;
        continue;
      }
      if (!APPLY) {
        // Dry run: only prove the source is still there.
        const res = await fetch(asset.sourceUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        report.copied++;
        continue;
      }
      const { body, type } = await download(asset.sourceUrl);
      const clean = await withoutMetadata(body);
      await putPublic(asset.key, clean, type);
      report.copied++;
      report.bytes += clean.length;
    } catch (err) {
      report.failed.push({
        what: asset.sourceUrl,
        why: (err as Error).message,
      });
      asset.oldUrls.clear(); // its links stay as they are
    }
  }
}

async function copyPrivate(db: Sequelize, report: Report): Promise<number> {
  const rows = await db.query<{ id: string; pid: string }>(
    `SELECT id, photo_public_id AS pid FROM workout_log
      WHERE photo_public_id IS NOT NULL`,
    { type: QueryTypes.SELECT },
  );
  for (const { id, pid } of rows) {
    try {
      const full = privateKey(pid, 'full');
      const thumb = privateKey(pid, 'thumb');
      if (
        (await exists(privateBucket, full)) &&
        (await exists(privateBucket, thumb))
      ) {
        report.alreadyThere++;
        continue;
      }
      const signed = cloudinary.url(pid, {
        type: 'authenticated',
        sign_url: true,
        secure: true,
        resource_type: 'image',
        format: 'jpg',
      });
      const { body } = await download(signed);
      if (!APPLY) {
        report.copied++;
        continue;
      }
      const variants = await privatePhotoVariants(body);
      await putPrivate(full, variants.full);
      await putPrivate(thumb, variants.thumb);
      report.copied++;
      report.bytes += variants.full.length + variants.thumb.length;
    } catch (err) {
      report.failed.push({
        what: `workout_log ${id} (${pid})`,
        why: (err as Error).message,
      });
    }
  }
  return rows.length;
}

async function copyStatic(report: Report): Promise<void> {
  for (const file of STATIC_FILES) {
    try {
      if (await exists(publicBucket, file.key)) {
        report.alreadyThere++;
        continue;
      }
      const { body, type } = await download(file.source);
      if (APPLY) {
        await putPublic(file.key, body, type);
      }
      report.copied++;
    } catch (err) {
      report.failed.push({ what: file.source, why: (err as Error).message });
    }
  }
}

/** Rewrites every moved link in every column it was found in. */
async function rewrite(
  db: Sequelize,
  columns: Map<string, { col: Column; links: Set<string> }>,
  newUrlOf: Map<string, string>,
): Promise<number> {
  let updated = 0;
  await db.transaction(async (transaction: Transaction) => {
    for (const { col, links } of columns.values()) {
      const table = quote(col.table);
      const c = quote(col.column);
      // Longest first, so a link that contains another is replaced whole.
      const pairs = [...links]
        .filter((l) => newUrlOf.has(l))
        .sort((a, b) => b.length - a.length);
      for (const oldUrl of pairs) {
        let sql = `UPDATE ${table} SET ${c} = replace(${c}, $1, $2)
                WHERE strpos(${c}, $1) > 0`;
        if (isArray(col)) {
          sql = `UPDATE ${table}
                SET ${c} = (SELECT array_agg(replace(e, $1, $2) ORDER BY i)
                              FROM unnest(${c}) WITH ORDINALITY AS x(e, i))
              WHERE strpos(array_to_string(${c}, ' '), $1) > 0`;
        } else if (isJson(col)) {
          sql = `UPDATE ${table} SET ${c} = replace(${c}::text, $1, $2)::${col.dataType}
                WHERE strpos(${c}::text, $1) > 0`;
        }
        const [, count] = await db.query(sql, {
          bind: [oldUrl, newUrlOf.get(oldUrl)],
          type: QueryTypes.UPDATE,
          transaction,
        });
        updated += count;
      }
    }
    // The avatar's storage key follows its link (the API deletes by it).
    await db.query(
      `UPDATE "user" SET avatar_public_id = substr(avatar_url, length($1) + 2)
        WHERE starts_with(avatar_url, $1 || '/')
          AND avatar_public_id IS DISTINCT FROM substr(avatar_url, length($1) + 2)`,
      { bind: [mediaBase], type: QueryTypes.UPDATE, transaction },
    );
  });
  return updated;
}

// ─── Run ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { db, label } = connect();
  if (SCAN_ONLY) {
    console.log('Scan only: lists links, touches no storage.');
  } else if (APPLY) {
    console.log('*** APPLY: files will be copied and links rewritten ***');
  } else {
    console.log('Dry run: nothing is written.');
  }
  console.log(`  database:        ${label}`);
  console.log(`  NODE_ENV:        ${nodeEnv}`);
  console.log(`  from Cloudinary: ${cloudName}`);
  console.log(`  public bucket:   ${publicBucket}  →  ${mediaBase}`);
  console.log(`  private bucket:  ${privateBucket}`);
  console.log('');

  await db.authenticate();
  if (!SCAN_ONLY) {
    await checkBuckets();
  }

  // 1. Every link, grouped by file.
  const columns = new Map<string, { col: Column; links: Set<string> }>();
  const assets = new Map<string, PublicAsset>();
  const unparsed: string[] = [];
  for (const col of await textColumns(db)) {
    const links = await linksInColumn(db, col);
    if (links.length === 0) {
      continue;
    }
    const place = `${col.table}.${col.column}`;
    columns.set(place, { col, links: new Set(links) });
    for (const link of links) {
      const parsed = parseLink(link);
      if (!parsed) {
        unparsed.push(link);
        continue;
      }
      const key = keyFor(parsed.publicId, parsed.ext);
      let asset = assets.get(key);
      if (!asset) {
        const encodedId = parsed.publicId
          .split('/')
          .map(encodeURIComponent)
          .join('/');
        asset = {
          oldUrls: new Set<string>(),
          sourceUrl: `https://res.cloudinary.com/${cloudName}/image/upload/${encodedId}.${parsed.ext}`,
          key,
          newUrl: `${mediaBase}/${key}`,
          places: new Set<string>(),
        };
      }
      asset.oldUrls.add(link);
      asset.places.add(place);
      assets.set(key, asset);
    }
  }

  console.log('Links found, by column:');
  for (const [place, { links }] of columns) {
    console.log(`  ${place.padEnd(48)} ${links.size} distinct link(s)`);
  }
  if (columns.size === 0) {
    console.log('  none');
  }
  console.log(`  → ${assets.size} distinct public file(s)\n`);

  if (SCAN_ONLY) {
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM workout_log WHERE photo_public_id IS NOT NULL`,
      { type: QueryTypes.SELECT },
    );
    console.log(`Private workout photos: ${n}`);
    for (const a of [...assets.values()].slice(0, 5)) {
      console.log(`  ${[...a.oldUrls][0]}\n    → ${a.key}`);
    }
    if (unparsed.length) {
      console.log(`Unreadable links: ${unparsed.join(', ')}`);
    }
    await db.close();
    return;
  }

  // 2. Copy.
  const publicReport: Report = {
    copied: 0,
    alreadyThere: 0,
    failed: [],
    bytes: 0,
  };
  await copyPublic([...assets.values()], publicReport);
  const privateReport: Report = {
    copied: 0,
    alreadyThere: 0,
    failed: [],
    bytes: 0,
  };
  const photoRows = await copyPrivate(db, privateReport);
  const staticReport: Report = {
    copied: 0,
    alreadyThere: 0,
    failed: [],
    bytes: 0,
  };
  await copyStatic(staticReport);

  let verb = 'to copy';
  if (APPLY) {
    verb = 'copied';
  }
  const line = (name: string, r: Report) => {
    let text = `  ${name.padEnd(16)} ${r.copied} ${verb}, ${r.alreadyThere} already in R2, ${r.failed.length} failed`;
    if (APPLY) {
      text += `, ${(r.bytes / 1e6).toFixed(1)} MB`;
    }
    console.log(text);
  };
  console.log('Files:');
  line('public', publicReport);
  line(`private (${photoRows})`, privateReport);
  line('static', staticReport);

  const failures = [
    ...publicReport.failed,
    ...privateReport.failed,
    ...staticReport.failed,
  ];
  if (failures.length) {
    console.log('\nNot moved (their links stay on Cloudinary):');
    for (const f of failures) {
      console.log(`  ${f.what}\n    ${f.why}`);
    }
  }
  if (unparsed.length) {
    console.log('\nLinks the script could not read (left alone):');
    for (const l of unparsed) {
      console.log(`  ${l}`);
    }
  }

  // 3. Rewrite.
  const newUrlOf = new Map<string, string>();
  for (const asset of assets.values()) {
    for (const old of asset.oldUrls) {
      newUrlOf.set(old, asset.newUrl);
    }
  }
  if (APPLY) {
    const updated = await rewrite(db, columns, newUrlOf);
    console.log(
      `\nLinks rewritten: ${newUrlOf.size} distinct, ${updated} row update(s).`,
    );
    let left = 0;
    for (const col of await textColumns(db)) {
      left += (await linksInColumn(db, col)).length;
    }
    console.log(`Cloudinary links left in the database: ${left}`);
  } else {
    console.log(
      `\nWould rewrite ${newUrlOf.size} distinct link(s). Run again with --apply.`,
    );
    const sample = [...assets.values()].slice(0, 3);
    for (const a of sample)
      console.log(`  ${[...a.oldUrls][0]}\n    → ${a.newUrl}`);
  }

  await db.close();
  if (APPLY) {
    console.log(
      '\nNext: rebuild the website so prerendered blog pages pick up the new cover links.',
    );
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
