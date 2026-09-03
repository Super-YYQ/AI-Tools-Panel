/**
 * §B.7-5 determinism: no timestamps anywhere; same catalog input produces
 * byte-identical output, independent of file creation/enumeration order.
 */
import { describe, expect, it } from 'vitest';
import { buildSite } from '@aitp/site-generator';
import { cleanupRepo, makeTempRepo, skillYaml, writeCatalogFile } from './helpers.js';

describe('deterministic output', () => {
  it('two builds over the same root are byte-identical', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(repo, 'catalog/skills/one.yaml', skillYaml({ id: 'entry-one', tags: ['b-tag', 'a-tag'] }));
      await writeCatalogFile(
        repo,
        'catalog/rule-fragments/two.md',
        ['---', 'apiVersion: aitp.dev/v1alpha1', 'kind: RuleFragment', 'id: entry-two', 'displayName: Entry Two', 'targets:', '  - codex', '---', '', 'body suppressed', ''].join('\n'),
      );
      const first = await buildSite({ root: repo });
      const second = await buildSite({ root: repo });
      expect(Buffer.compare(Buffer.from(first.html, 'utf8'), Buffer.from(second.html, 'utf8'))).toBe(0);
      expect(first.html).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no timestamps
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('output does not depend on file creation order across roots', async () => {
    const repoA = await makeTempRepo();
    const repoB = await makeTempRepo();
    try {
      await writeCatalogFile(repoA, 'catalog/skills/aaa.yaml', skillYaml({ id: 'aaa' }));
      await writeCatalogFile(repoA, 'catalog/skills/zzz.yaml', skillYaml({ id: 'zzz' }));
      await writeCatalogFile(repoB, 'catalog/skills/zzz.yaml', skillYaml({ id: 'zzz' }));
      await writeCatalogFile(repoB, 'catalog/skills/aaa.yaml', skillYaml({ id: 'aaa' }));
      const a = await buildSite({ root: repoA });
      const b = await buildSite({ root: repoB });
      expect(a.html).toBe(b.html);
    } finally {
      await cleanupRepo(repoA);
      await cleanupRepo(repoB);
    }
  });
});
