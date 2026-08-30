#!/usr/bin/env node
/** clean.mjs — remove build outputs. */
import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['node_modules']) {
  // keep node_modules unless --deep
}
function removeDist(dir, depth = 0) {
  if (depth > 4) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'dist' || name === 'tsconfig.tsbuildinfo' || name === '.tsbuildinfo') {
      rmSync(p, { recursive: true, force: true });
    } else {
      try {
        if (existsSync(p)) removeDist(p, depth + 1);
      } catch {
        /* ignore */
      }
    }
  }
}
removeDist(root);
console.log('cleaned');
