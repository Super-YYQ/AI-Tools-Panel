/**
 * §B.7-3 invalid input: broken YAML / schema violations / unsupported
 * versions produce diagnostics and no site; §B.7-4 archived entries are
 * excluded.
 */
import { describe, expect, it } from 'vitest';
import { buildSite, SiteBuildError } from '@aitp/site-generator';
import { cleanupRepo, extractEmbeddedJson, makeTempRepo, skillYaml, writeCatalogFile } from './helpers.js';
import type { SiteEntry } from '@aitp/site-generator';

describe('invalid input is a build failure', () => {
  it('broken YAML yields an INVALID_YAML diagnostic naming the file', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(repo, 'catalog/skills/broken.yaml', 'apiVersion: aitp.dev/v1alpha1\nkind: [unclosed\n');
      const error = await buildSite({ root: repo }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SiteBuildError);
      const diagnostics = (error as SiteBuildError).diagnostics.join('\n');
      expect(diagnostics).toContain('INVALID_YAML');
      expect(diagnostics).toContain('catalog/skills/broken.yaml');
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('schema-invalid entries yield INVALID_ENTRY and no site', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/skills/bad-id.yaml',
        ['apiVersion: aitp.dev/v1alpha1', 'kind: Skill', 'metadata:', '  id: "Not A Valid ID!"', '  displayName: Bad', ''].join('\n'),
      );
      const error = await buildSite({ root: repo }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SiteBuildError);
      expect((error as SiteBuildError).diagnostics.join('\n')).toContain('INVALID_ENTRY');
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('unsupported apiVersion fails closed instead of publishing unknown data', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/skills/future.yaml',
        ['apiVersion: aitp.dev/v9', 'kind: Skill', 'metadata:', '  id: future-skill', '  displayName: Future', ''].join('\n'),
      );
      const error = await buildSite({ root: repo }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SiteBuildError);
      expect((error as SiteBuildError).diagnostics.join('\n')).toContain('UNSUPPORTED_VERSION');
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('.md without frontmatter yields INVALID_FRONTMATTER', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(repo, 'catalog/rule-fragments/plain.md', 'just prose, no frontmatter\n');
      const error = await buildSite({ root: repo }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SiteBuildError);
      expect((error as SiteBuildError).diagnostics.join('\n')).toContain('INVALID_FRONTMATTER');
    } finally {
      await cleanupRepo(repo);
    }
  });
});

describe('archived entries', () => {
  it('are excluded from the site while live entries remain', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(repo, 'catalog/skills/live.yaml', skillYaml({ id: 'live-entry' }));
      await writeCatalogFile(
        repo,
        'catalog/skills/old.yaml',
        skillYaml({ id: 'archived-entry', archived: true, notes: 'archived notes' }),
      );
      const { html, entryCount } = await buildSite({ root: repo });
      expect(entryCount).toBe(1);
      const data = extractEmbeddedJson(html) as { entries: SiteEntry[] };
      expect(data.entries.map((e) => e.id)).toEqual(['live-entry']);
      expect(html).not.toContain('archived-entry');
      expect(html).toContain('live-entry');
    } finally {
      await cleanupRepo(repo);
    }
  });
});
