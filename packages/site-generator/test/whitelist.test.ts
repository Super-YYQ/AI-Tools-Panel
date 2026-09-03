/**
 * §B.7-1 whitelist: sensitive fields (pathToken, contentHash, sourceDigest,
 * textHash, RuleFragment body/frontmatter prose, verification, unknown,
 * fieldOrigins) never reach the output — structurally, via the §B.3
 * SiteEntry projection.
 */
import { describe, expect, it } from 'vitest';
import { buildSite, SITE_ENTRY_FIELDS, type SiteEntry } from '@aitp/site-generator';
import { cleanupRepo, extractEmbeddedJson, makeTempRepo, writeCatalogFile } from './helpers.js';

const FORBIDDEN_FIELD_NAMES = [
  'pathToken',
  'contentHash',
  'sourceDigest',
  'textHash',
  'fieldOrigins',
  'verification',
  'unknown',
  'ruleFragment',
  'components',
];

describe('field whitelist projection', () => {
  it('drops unknown top-level fields and verification data from a .yaml entry', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/skills/leaky.yaml',
        [
          'apiVersion: aitp.dev/v1alpha1',
          'kind: Skill',
          'metadata:',
          '  id: leaky-skill',
          '  displayName: Leaky Skill',
          '  shortDescription: has sensitive neighbors',
          '  tags:',
          '    - test',
          'spec:',
          '  targets:',
          '    - claude-code',
          '  ownership: authored',
          '  source:',
          '    type: local-authored',
          '    repositoryRelativePath: some/repo/path',
          '  license:',
          '    status: unknown',
          '  installInstructions: {}',
          '  contentPolicy: metadata-only',
          '  ruleFragment:',
          '    document: rules-doc.md',
          '    lines: 10-20',
          '    textHash: TEXT-HASH-MARKER-abc123',
          'overlay:',
          '  notes: fine to publish',
          '  fieldOrigins:',
          '    notes: human',
          'verification:',
          '  lastVerifiedAt: 2026-08-29T00:00:00Z',
          '  sourceDigest: SOURCE-DIGEST-MARKER-xyz789',
          'pathToken: USER-LEVEL-PATH-TOKEN-MARKER',
          'contentHash: CONTENT-HASH-MARKER-000',
          'discoveredAt: 2026-08-29T00:00:00Z',
          '',
        ].join('\n'),
      );
      const { html } = await buildSite({ root: repo });
      // Forbidden names may never appear as JSON keys (values like the legal
      // license status "unknown" are fine — keys are what must not exist).
      for (const name of FORBIDDEN_FIELD_NAMES) {
        expect(html).not.toMatch(new RegExp(`"${name}"\\s*:`));
      }
      expect(html).not.toContain('USER-LEVEL-PATH-TOKEN-MARKER');
      expect(html).not.toContain('CONTENT-HASH-MARKER-000');
      expect(html).not.toContain('SOURCE-DIGEST-MARKER-xyz789');
      expect(html).not.toContain('TEXT-HASH-MARKER-abc123');
      expect(html).not.toContain('some/repo/path');
      expect(html).toContain('fine to publish');
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('publishes RuleFragment .md metadata but never the fragment body', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/rule-fragments/quiet-push.md',
        [
          '---',
          'apiVersion: aitp.dev/v1alpha1',
          'kind: RuleFragment',
          'id: quiet-push',
          'displayName: Quiet push rule',
          'targets:',
          '  - claude-code',
          'categories:',
          '  - git',
          'source:',
          '  document: AGENTS.md',
          '  lines: 3-3',
          'fieldOrigins:',
          '  categories: human',
          '---',
          '',
          'FRAGMENT-BODY-MARKER: only push after explicit authorization.',
          '',
        ].join('\n'),
      );
      const { html, entryCount } = await buildSite({ root: repo });
      expect(entryCount).toBe(1);
      expect(html).toContain('quiet-push');
      expect(html).toContain('Quiet push rule');
      expect(html).toContain('RuleFragment');
      expect(html).not.toContain('FRAGMENT-BODY-MARKER');
      expect(html).not.toContain('explicit authorization');
      expect(html).not.toMatch(/"fieldOrigins"\s*:/);
      expect(html).not.toMatch(/"lines"\s*:/);
      const data = extractEmbeddedJson(html) as { entries: SiteEntry[] };
      expect(Object.keys(data.entries[0]!).sort()).toEqual([...SITE_ENTRY_FIELDS].sort());
    } finally {
      await cleanupRepo(repo);
    }
  });
});
