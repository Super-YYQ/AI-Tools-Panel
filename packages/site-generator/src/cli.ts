#!/usr/bin/env node
/**
 * aitp-site-gen — build the single-file static catalog site (design doc §B.1).
 * Usage: aitp-site-gen --root <repoRoot> --out site-dist [--site-title "…"] [--site-url <base>]
 * Fail-closed: any diagnostic exits 1 without writing output.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildSite, SiteBuildError } from './index.js';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    out: { type: 'string', default: 'site-dist' },
    'site-title': { type: 'string' },
    'site-url': { type: 'string' },
  },
});

const root = resolve(values.root);
const outDir = resolve(process.cwd(), values.out ?? 'site-dist');

try {
  const result = await buildSite({
    root,
    ...(values['site-title'] !== undefined ? { siteTitle: values['site-title'] } : {}),
    ...(values['site-url'] !== undefined ? { siteUrl: values['site-url'] } : {}),
  });
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, 'index.html');
  await writeFile(outPath, result.html, 'utf8');
  console.log(
    `site:build: ${result.entryCount} entries -> ${outPath} (${Buffer.byteLength(result.html, 'utf8')} bytes)`,
  );
} catch (error) {
  if (error instanceof SiteBuildError) {
    console.error('site:build failed (fail-closed); no site was written:');
    for (const diagnostic of error.diagnostics) console.error(`  - ${diagnostic}`);
    process.exit(1);
  }
  throw error;
}
