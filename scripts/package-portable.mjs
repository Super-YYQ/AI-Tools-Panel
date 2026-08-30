#!/usr/bin/env node
/**
 * package:portable — Phase 5 REL-01/REL-03 (automatable part).
 * Produces a Windows portable ZIP:
 *   release/AI-Tools-Panel-v<version>-portable/
 *     agent/            compiled local agent (dist) + production node_modules
 *     panel/            compiled web console (dist)
 *     panel-portable.ps1  launcher (requires system Node 22+, no npm install)
 *     checksums.txt     SHA-256 of every packaged file (REL-03)
 * and zips it to release/AI-Tools-Panel-v<version>-portable-win.zip.
 * REL-04 fresh-machine matrix is a manual release checklist (see docs/PROGRESS.md).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;

if (!existsSync(join(repoRoot, 'apps', 'local-agent', 'dist', 'main.js')) || !existsSync(join(repoRoot, 'apps', 'panel', 'dist', 'index.html'))) {
  console.error('package:portable: build outputs missing; run npm run build first');
  process.exit(1);
}

const outDir = join(repoRoot, 'release', `AI-Tools-Panel-v${version}-portable`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'agent'), { recursive: true });
mkdirSync(join(outDir, 'panel'), { recursive: true });

// Compiled artifacts.
cpSync(join(repoRoot, 'apps', 'local-agent', 'dist'), join(outDir, 'agent', 'dist'), { recursive: true });
cpSync(join(repoRoot, 'apps', 'panel', 'dist'), join(outDir, 'panel', 'dist'), { recursive: true });

// Production dependencies only (REL-02: better-sqlite3 prebuilt binary ships
// with the package; target ABI is Node 22/24 x64 — re-verify on dependency upgrade).
const prodNodeModules = join(outDir, 'agent', 'node_modules');
mkdirSync(prodNodeModules, { recursive: true });
const skip = new Set(['.bin', '.package-lock.json', '@types', 'typescript', 'eslint', 'vitest', 'vite', '@vitest', '@playwright', 'playwright', 'tsx', '@eslint', 'js-yaml']);
let copied = 0;
for (const name of readdirSync(join(repoRoot, 'node_modules'))) {
  if (skip.has(name)) continue;
  cpSync(join(repoRoot, 'node_modules', name), join(prodNodeModules, name), { recursive: true });
  copied++;
}
// Scoped packages: copy individually (npm hoists them into node_modules/@scope/).
for (const scope of readdirSync(join(repoRoot, 'node_modules')).filter((n) => n.startsWith('@'))) {
  if (skip.has(scope)) continue;
  rmSync(join(prodNodeModules, scope), { recursive: true, force: true });
  cpSync(join(repoRoot, 'node_modules', scope), join(prodNodeModules, scope), { recursive: true });
}
// REL-102: @aitp/* workspace entries are npm links/junctions into packages/* —
// they would break after extraction. Replace them with real copies of the
// compiled package (package.json + dist).
const aitpScope = join(prodNodeModules, '@aitp');
rmSync(aitpScope, { recursive: true, force: true });
mkdirSync(aitpScope, { recursive: true });
for (const manifestPath of ['packages/contracts', 'packages/security', 'packages/inventory-core', 'packages/catalog', 'packages/reconcile', 'packages/adapter-claude', 'packages/adapter-codex', 'packages/enrichment']) {
  const name = manifestPath.split('/').pop();
  const pkgDir = join(repoRoot, manifestPath);
  if (!existsSync(join(pkgDir, 'dist'))) {
    console.error(`package:portable: missing dist for ${manifestPath}; run npm run build first`);
    process.exit(1);
  }
  const dest = join(aitpScope, name);
  mkdirSync(dest, { recursive: true });
  cpSync(join(pkgDir, 'package.json'), join(dest, 'package.json'));
  cpSync(join(pkgDir, 'dist'), join(dest, 'dist'), { recursive: true });
}
console.log(`package:portable: copied ${copied}+ top-level dependency folders; @aitp/* materialized`);

// Launcher (no npm install at first run; Node is the only prerequisite).
writeFileSync(
  join(outDir, 'panel-portable.ps1'),
  [
    '# AI Tools Panel portable launcher (REL-01).',
    '# Requires: Node.js 22+ (x64) installed; no npm install is performed.',
    '$ErrorActionPreference = "Stop"',
    '$root = $PSScriptRoot',
    'Write-Host "Starting AI Tools Panel (portable v' + version + ')..." -ForegroundColor Cyan',
    'node "$root\\agent\\dist\\start.js" --open',
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  join(outDir, 'LAUNCH-README.txt'),
  [
    'AI Tools Panel portable (v' + version + ')',
    '',
    'Prerequisites: Node.js 22+ x64 and Git. No npm install required.',
    'Run: powershell -ExecutionPolicy Bypass -File panel-portable.ps1',
    '',
    'App-owned local state (SQLite inventory DB, structured log) is created',
    'inside the scanned repository under .aitp/ and is never committed.',
    'The panel only binds 127.0.0.1; commit and push remain manual.',
    '',
  ].join('\n'),
  'utf8',
);

// Checksums (REL-03).
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(outDir);
const checksums = files
  .map((f) => `sha256:${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(outDir, f).split('\\').join('/')}`)
  .sort()
  .join('\n');
writeFileSync(join(outDir, 'checksums.txt'), checksums + '\n', 'utf8');

// ZIP via PowerShell (Windows-native, no extra dependency).
const zipPath = join(repoRoot, 'release', `AI-Tools-Panel-v${version}-portable-win.zip`);
rmSync(zipPath, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path "${outDir}" -DestinationPath "${zipPath}"`], { stdio: 'inherit' });

const size = statSync(zipPath).size;
console.log(`package:portable: wrote ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MB, ${files.length} files)`);
