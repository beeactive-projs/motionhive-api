#!/usr/bin/env node
/* eslint-disable */
const { execSync, spawnSync } = require('child_process');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function listChangedTs() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;

  let range = '';

  if (eventName === 'pull_request' && baseRef) {
    try {
      sh(`git fetch --no-tags --depth=50 origin ${baseRef}`);
    } catch {}
    let mergeBase = '';
    try {
      mergeBase = sh(`git merge-base origin/${baseRef} HEAD`);
    } catch {}
    range = mergeBase ? `${mergeBase} HEAD` : `origin/${baseRef} HEAD`;
  } else if (eventName === 'push' && process.env.GITHUB_EVENT_PATH) {
    try {
      const evt = JSON.parse(
        require('fs').readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'),
      );
      const before = evt.before;
      if (before && !/^0+$/.test(before)) {
        range = `${before} HEAD`;
      } else {
        range = `HEAD~1 HEAD`;
      }
    } catch {
      range = `HEAD~1 HEAD`;
    }
  } else {
    const base = process.env.LINT_BASE_REF || 'origin/main';
    try {
      sh(`git rev-parse --verify ${base}`);
    } catch {
      try {
        sh(`git fetch --depth=50 origin main`);
      } catch {}
    }
    let mergeBase = '';
    try {
      mergeBase = sh(`git merge-base ${base} HEAD`);
    } catch {}
    range = mergeBase ? `${mergeBase} HEAD` : `${base} HEAD`;
  }

  let out = '';
  try {
    out = sh(`git diff --name-only --diff-filter=ACMR ${range}`);
  } catch (e) {
    console.error(`[lint:ci] git diff failed for range "${range}":`, e.message);
    out = '';
  }

  return out
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => /^(src|test|apps|libs)\/.*\.ts$/.test(f));
}

const files = listChangedTs();
if (files.length === 0) {
  console.log('[lint:ci] no changed .ts files — skipping');
  process.exit(0);
}

console.log(`[lint:ci] linting ${files.length} changed file(s):`);
for (const f of files) console.log(`  - ${f}`);

const result = spawnSync('npx', ['eslint', ...files], {
  stdio: 'inherit',
  shell: false,
});
process.exit(result.status ?? 1);
