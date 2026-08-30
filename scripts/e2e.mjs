#!/usr/bin/env node
/**
 * test:e2e — v0.1 runs the full API-level E2E subset (scan → edit → diff →
 * apply flows) via the integration suite against a real Local Agent on a temp
 * Git repo. Browser-level Playwright scenarios are tracked in docs/PROGRESS.md.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const result = spawnSync('npx', ['vitest', 'run', 'integration'], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
