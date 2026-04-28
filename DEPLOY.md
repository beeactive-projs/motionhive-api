# BeeActive API – Deploy & Migrations

This document explains how database migrations run on deploy and how to fix issues when they do not.

---

## Quick check: did migrations run on the server?

After deploying, you can verify that migrations ran:

1. **Railway** – In the deploy logs you should see output from the migration runner before the app starts, e.g.:
   ```
   Running: 009_add_email_verification_expires.sql... OK
   Running: 010_add_group_discovery_fields.sql... OK
   ```
2. **Database** – If you have access to the production DB, check that the `_migrations` table contains the latest migration names (e.g. `010_add_group_discovery_fields.sql`). New columns/tables from 009 and 010 should exist.

If you do **not** see migration output in the logs and new columns are missing, the start command is likely not running migrations. See below.

---

## How migrations run on deploy

Migrations run **only if** the process that starts your app also runs the migration script. By default some platforms run only `npm start` or `npm run start:prod`, which **do not** run migrations.

### What you need

The **production start command** must run migrations first, then start the app:

1. **Build** the app (if not already built by the platform).
2. **Run migrations** with `node migrations/run.js`. The runner is **SAFE by default** (never drops, never re-seeds — only applies new migrations).
3. **Start** the app with `node dist/main` (or `npm run start:prod`).

In this project that is done by a single script:

- **`npm run railway:start`** = `npm run build` → `node migrations/run.js` → `npm run start:prod`

So: **your deploy start command must be `npm run railway:start`** (or equivalent). The name is Railway-oriented but the script works on any platform.

### Runner modes

| Mode      | Command                                   | What it does                                                                               |
|-----------|-------------------------------------------|--------------------------------------------------------------------------------------------|
| **SAFE**  | `npm run migrate` *(default)*             | Reads `_migrations`, applies only files not already recorded. Never runs `000_drop`.        |
| **FRESH** | `npm run migrate:fresh`                   | Drops the whole schema and re-seeds. Refuses on `NODE_ENV=production` and on Neon URLs. Asks for typed confirmation. |
| **ONLY**  | `npm run migrate:only NNN`                | Runs only the migration whose filename starts with `NNN`. Never runs `000_drop`.            |
| **FROM**  | `npm run migrate:from NNN`                | Runs `NNN` and every later migration. Never runs `000_drop`.                                |

### Safety guarantees

The runner refuses to run **`--fresh`** when:

- `NODE_ENV` is `production` or `staging`
- `DATABASE_URL` points at a `*.neon.tech` host (your production DB is Neon)

This means you **cannot accidentally wipe your hosted database** by typing `npm run migrate:fresh` from muscle memory. To wipe a hosted DB you have to edit the runner manually — that intentional friction is the point.

The `--safe` flag is still accepted (silently — it's now the default) so any external scripts that pass it keep working.

---

## Railway

### Option 1: Use `railway.toml` (recommended)

This repo includes a **`railway.toml`** at the project root:

```toml
[deploy]
startCommand = "npm run railway:start"
```

If this file is committed and deployed, Railway will use this start command. No need to set it in the dashboard. After the next deploy, new migrations (e.g. 009, 010) will run automatically before the app starts.

### Option 2: Set the start command in the dashboard

1. Open your **BeeActive API** service in the Railway dashboard.
2. Go to **Settings** → **Deploy** (or the section where **Start Command** is configured).
3. Set the start command to:
   ```bash
   npm run railway:start
   ```
4. Redeploy. On each deploy, new migrations will run before the app starts.

### If migrations still did not run

- Confirm the start command is exactly `npm run railway:start` (no typo, no extra quotes).
- Check deploy logs for migration output (see “Quick check” above).
- If the start command was wrong on previous deploys, run the missing migrations once manually (see “Running migrations manually” below), then fix the start command and redeploy so future migrations run automatically.

---

## Other platforms (Render, Fly.io, Vercel, etc.)

Use the same idea: the **production start command** must run migrations then start the app.

- **Option A** – Use the same script (works even when not on Railway):
  ```bash
  npm run railway:start
  ```

- **Option B** – Run migrations and start explicitly:
  ```bash
  npm run build && node migrations/run.js && node dist/main
  ```

Do **not** use only `npm run start:prod` or `node dist/main` as the start command, or new migrations will never run on deploy.

---

## Running migrations manually

Useful when fixing a server where migrations did not run, or when developing locally.

| Goal | Command |
|------|--------|
| Run only **new** migrations (safe, default) | `node migrations/run.js` |
| Run from a specific migration onward (e.g. 009 and 010) | `node migrations/run.js --from 009` |
| Run only one migration file | `node migrations/run.js --only 010` |
| Wipe and re-seed (local/dev only — refuses on prod/Neon) | `node migrations/run.js --fresh` |

For production, ensure the correct database URL (e.g. `MYSQL_PUBLIC_URL` or `DATABASE_URL`) is set in the environment before running the command.

**Example – run missing migrations once on the server:**

```bash
# With production env vars loaded (e.g. MYSQL_PUBLIC_URL):
node migrations/run.js --from 009
```

After that, set the deploy start command to `npm run railway:start` and redeploy so future migrations run automatically.

---

## Production already has schema but `_migrations` is empty

If your production database was created earlier (e.g. before the `_migrations` tracking table was introduced, or by another process) and the **`_migrations`** table is missing or empty, then on deploy the runner thinks no migrations have run and tries to run **001–008** again. Those fail with errors like:

- `Table 'user' already exists`
- `Duplicate column name 'gender'`
- `Duplicate entry ... for key 'role.PRIMARY'`

**Fix: run the bootstrap once so only 009 and 010 run on the next deploy.**

### Step 1: Mark 001–008 as already run

Run the bootstrap SQL **once** against your **production** database. It creates `_migrations` (if needed) and inserts the names of migrations 001–008 so the runner will skip them.

**Option A – Railway MySQL console**

1. In Railway, open your **MySQL** service.
2. Use the **Query** / **Data** tab or connect with a MySQL client using the production connection URL.
3. Execute the contents of **`migrations/bootstrap_migrations_for_existing_db.sql`** (create `_migrations`, then the eight `INSERT IGNORE` rows).

**Option B – Railway CLI (no MySQL client needed)**

From your project directory (with Railway CLI installed and project linked):

```bash
railway run node migrations/bootstrap-migrations.js
```

This uses the same DB connection as your app (Railway injects `MYSQL_PUBLIC_URL`). It creates `_migrations` if needed and inserts 001–008. Then redeploy.

**Option C – From your machine with MySQL client**

```bash
# With MYSQL_PUBLIC_URL or connection details in env:
mysql -h YOUR_HOST -P 3306 -u YOUR_USER -p YOUR_DATABASE < migrations/bootstrap_migrations_for_existing_db.sql
```

Or with a URL:

```bash
mysql "mysql://user:pass@host:port/railway" < migrations/bootstrap_migrations_for_existing_db.sql
```

### Step 2: Redeploy

Trigger a new deploy (push a commit or “Redeploy” in Railway). The start command will run `node migrations/run.js` (SAFE mode is now the default), which will:

- See 001–008 in `_migrations` and skip them.
- Run **009** and **010** only.

After that, future migrations (011, 012, …) will also run automatically on deploy.

---

## Summary

| Item | What to do |
|------|------------|
| **Migrations run on deploy** | Use start command: `npm run railway:start`. Commit `railway.toml` so Railway uses it. |
| **Verify after deploy** | Check deploy logs for migration lines; or check `_migrations` table / new columns in DB. |
| **Migrations never ran on server** | Run once: `node migrations/run.js --from 009` (with prod env). Then set start command and redeploy. |
| **Schema exists but _migrations empty** | Run once: `migrations/bootstrap_migrations_for_existing_db.sql` on production DB, then redeploy so only 009+ run. |