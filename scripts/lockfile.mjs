// Windows-safe package-lock maintenance.
//
// Problem: `npm install` on Windows drops Linux-only optional deps
// (@emnapi/*, pulled in by WASM fallbacks) from package-lock.json, so `npm ci` on the Linux
// CI runner fails with "Missing: @emnapi/core … from lock file".
//
//   npm run lock:check    → reproduces CI's `npm ci` validation locally (no install)
//   npm run lock:refresh  → resolves a fresh lockfile from package.json in a temp folder
//                           (no node_modules there, so nothing is pruned), validates it,
//                           and copies it back. node_modules is not touched.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmQuiet = '--no-audit --no-fund';

function lockIsValid(cwd) {
  try {
    execSync(`npm ci --dry-run --ignore-scripts ${npmQuiet}`, { cwd, stdio: 'pipe' });
    return true;
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    process.stderr.write(out.split('\n').filter((l) => /Missing|Invalid|EUSAGE/.test(l)).join('\n') + '\n');
    return false;
  }
}

const command = process.argv[2];

if (command === 'check') {
  const ok = lockIsValid(root);
  console.log(ok ? 'lockfile OK — npm ci will succeed on CI' : 'lockfile out of sync — run: npm run lock:refresh');
  process.exit(ok ? 0 : 1);
}

if (command === 'refresh') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockfile-'));
  try {
    fs.copyFileSync(path.join(root, 'package.json'), path.join(tmp, 'package.json'));
    console.log('Resolving a fresh lockfile (takes ~2 min)…');
    execSync(`npm install --package-lock-only ${npmQuiet}`, { cwd: tmp, stdio: 'inherit' });
    if (!lockIsValid(tmp)) {
      console.error('Fresh lockfile is still invalid — not copying it back.');
      process.exit(1);
    }
    fs.copyFileSync(path.join(tmp, 'package-lock.json'), path.join(root, 'package-lock.json'));
    console.log('package-lock.json refreshed and validated.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}

console.error('Usage: node scripts/lockfile.mjs <check|refresh>');
process.exit(1);
