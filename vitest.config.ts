import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const alias: Record<string, string> = {
  '@aitp/contracts': r('./packages/contracts/src/index.ts'),
  '@aitp/security': r('./packages/security/src/index.ts'),
  '@aitp/inventory-core': r('./packages/inventory-core/src/index.ts'),
  '@aitp/catalog': r('./packages/catalog/src/index.ts'),
  '@aitp/reconcile': r('./packages/reconcile/src/index.ts'),
  '@aitp/adapter-claude': r('./packages/adapter-claude/src/index.ts'),
  '@aitp/adapter-codex': r('./packages/adapter-codex/src/index.ts'),
  '@aitp/enrichment': r('./packages/enrichment/src/index.ts'),
  '@aitp/site-generator': r('./packages/site-generator/src/index.ts'),
};

const project = (name: string, patterns: string[]) => ({
  test: { name, include: patterns },
});

export default defineConfig({
  resolve: { alias },
  test: {
    globals: false,
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/local-agent/test/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
  },
});
