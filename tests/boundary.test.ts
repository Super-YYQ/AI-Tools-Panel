import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Package boundary test (M0 exit criterion, ARCHITECTURE.md §4):
 * no reverse dependencies. Sources of truth: package.json workspace deps +
 * actual `@aitp/*` imports found in src.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED: Record<string, string[]> = {
  '@aitp/contracts': [],
  '@aitp/security': ['@aitp/contracts'],
  '@aitp/inventory-core': ['@aitp/contracts', '@aitp/security'],
  '@aitp/catalog': ['@aitp/contracts', '@aitp/security'],
  '@aitp/reconcile': ['@aitp/contracts'],
  '@aitp/adapter-claude': ['@aitp/contracts', '@aitp/security', '@aitp/inventory-core'],
  '@aitp/adapter-codex': ['@aitp/contracts', '@aitp/security', '@aitp/inventory-core'],
  '@aitp/enrichment': ['@aitp/contracts', '@aitp/security'],
  '@aitp/local-agent': ['@aitp/contracts', '@aitp/security', '@aitp/inventory-core', '@aitp/catalog', '@aitp/reconcile', '@aitp/adapter-claude', '@aitp/adapter-codex', '@aitp/enrichment'],
};

// Web UI must not import Node built-ins (ARCHITECTURE §4 prohibition).
const PANEL_FORBIDDEN_IMPORTS = ['node:fs', 'node:path', 'node:child_process', 'node:os'];

function listFiles(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:from|import)\s*['"](@aitp\/[a-z-]+|node:[a-z_]+)['"]/g;

describe('package boundaries (ARCHITECTURE §4, M0)', () => {
  for (const [pkg, allowed] of Object.entries(ALLOWED)) {
    it(`${pkg} does not import outside its allowed set`, () => {
      const base = join(repoRoot, pkg === '@aitp/local-agent' ? 'apps/local-agent' : `packages/${pkg.replace('@aitp/', '')}`);
      const declared = new Set<string>();
      const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      for (const dep of Object.keys(manifest.dependencies ?? {})) {
        if (dep.startsWith('@aitp/')) declared.add(dep);
      }
      // Declared deps must be within the allowed set (no accidental wiring).
      const illegalDeclared = [...declared].filter((d) => !allowed.includes(d));
      expect(illegalDeclared, `${pkg} declares forbidden deps: ${illegalDeclared}`).toEqual([]);

      // Actual imports in src must be within the allowed set.
      const imports = new Set<string>();
      for (const file of listFiles(join(base, 'src'), /\.ts$/)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(IMPORT_RE)) {
          if (m[1]!.startsWith('@aitp/')) imports.add(m[1]!);
        }
      }
      const illegalImports = [...imports].filter((d) => !allowed.includes(d));
      expect(illegalImports, `${pkg} imports forbidden packages: ${illegalImports}`).toEqual([]);
    });
  }

  it('contracts depends on no workspace package (root of the graph)', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages/contracts/package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).filter((d) => d.startsWith('@aitp/'))).toEqual([]);
  });

  it('panel never imports Node built-ins (browser isolation)', () => {
    const src = join(repoRoot, 'apps/panel/src');
    for (const file of listFiles(src, /\.tsx?$/)) {
      const text = readFileSync(file, 'utf8');
      for (const forbidden of PANEL_FORBIDDEN_IMPORTS) {
        expect(text.includes(`'${forbidden}'`), `${file} imports ${forbidden}`).toBe(false);
      }
    }
  });
});
