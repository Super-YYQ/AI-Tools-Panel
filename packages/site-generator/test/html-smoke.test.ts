/**
 * §B.7-6 HTML smoke: embedded JSON parses, counts match, renderer and tokens
 * present; empty catalog produces the documented empty-state page.
 */
import { describe, expect, it } from 'vitest';
import { buildSite, DEFAULT_SITE_TITLE } from '@aitp/site-generator';
import { cleanupRepo, extractEmbeddedJson, makeTempRepo, skillYaml, writeCatalogFile } from './helpers.js';
import type { SiteEntry } from '@aitp/site-generator';

describe('HTML smoke', () => {
  it('empty catalog renders the empty-state page', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(repo, 'catalog/.gitkeep', '');
      const { html, entryCount } = await buildSite({ root: repo });
      expect(entryCount).toBe(0);
      expect(html).toContain('暂无目录条目');
      expect(html).toContain(DEFAULT_SITE_TITLE);
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('embeds parseable JSON with matching entry count, renderer script and dark tokens', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(repo, 'catalog/skills/alpha.yaml', skillYaml({ id: 'alpha-entry', displayName: 'Alpha' }));
      await writeCatalogFile(repo, 'catalog/skills/beta.yaml', skillYaml({ id: 'beta-entry', displayName: 'Beta' }));
      const { html, entryCount } = await buildSite({
        root: repo,
        siteTitle: 'Custom Catalog',
        siteUrl: 'https://super-yyq.github.io/AI-Tools-Panel/',
      });
      expect(entryCount).toBe(2);

      const data = extractEmbeddedJson(html) as { entries: SiteEntry[] };
      expect(data.entries).toHaveLength(2);
      expect(data.entries.map((e) => e.displayName)).toEqual(['Alpha', 'Beta']);

      expect(html).toContain('<title>Custom Catalog</title>');
      expect(html).toContain('<link rel="canonical" href="https://super-yyq.github.io/AI-Tools-Panel/">');
      expect(html).toContain('function route');
      expect(html).toContain('hashchange');
      expect(html).toContain('aria-label="全文搜索"');
      // hash-route detail links are built client-side by the renderer; the
      // static HTML carries the route prefix and the ids in the embedded data
      expect(html).toContain('#/entry/');
      // design tokens present in the emitted CSS
      for (const token of ['--bg', '--surface', '--border', '--text', '--accent']) {
        expect(html).toContain(token);
      }
      expect(html).toContain('#0d1117');
    } finally {
      await cleanupRepo(repo);
    }
  });
});
