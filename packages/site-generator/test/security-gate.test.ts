/**
 * §B.7-2 security gate: non-https URLs are not published; sensitive content
 * inside whitelisted fields fails the build, naming entry id + field.
 */
import { describe, expect, it } from 'vitest';
import { buildSite, SiteBuildError } from '@aitp/site-generator';
import { cleanupRepo, extractEmbeddedJson, makeTempRepo, skillYaml, writeCatalogFile } from './helpers.js';
import type { SiteEntry } from '@aitp/site-generator';

const TOKEN_LIKE = 'ghp_' + 'a'.repeat(30);

describe('source URL gate', () => {
  it('omits url for http:// (non-https) sources', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/skills/http-only.yaml',
        skillYaml({ id: 'http-only', source: 'type: url\n    url: http://example.com/skills' }),
      );
      const { html } = await buildSite({ root: repo });
      const data = extractEmbeddedJson(html) as { entries: SiteEntry[] };
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0]!.source).toEqual({ type: 'url' });
    } finally {
      await cleanupRepo(repo);
    }
  });

  it('omits url for git ssh remotes but keeps https git urls', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/skills/ssh-remote.yaml',
        skillYaml({ id: 'ssh-remote', source: 'type: git\n    url: git@example.com:team/repo.git' }),
      );
      await writeCatalogFile(
        repo,
        'catalog/skills/https-remote.yaml',
        skillYaml({ id: 'https-remote', source: 'type: git\n    url: https://github.com/team/repo' }),
      );
      const { html } = await buildSite({ root: repo });
      const data = extractEmbeddedJson(html) as { entries: SiteEntry[] };
      const ssh = data.entries.find((e) => e.id === 'ssh-remote')!;
      const https = data.entries.find((e) => e.id === 'https-remote')!;
      expect(ssh.source).toEqual({ type: 'git' });
      expect(https.source.url).toBe('https://github.com/team/repo');
    } finally {
      await cleanupRepo(repo);
    }
  });
});

describe('fail-closed output scan', () => {
  const cases: Array<{ name: string; notes: string; pattern: string }> = [
    { name: 'windows path', notes: 'install from C:\\Users\\admin\\tools', pattern: 'windows-drive-path' },
    { name: 'unix home path', notes: 'see /home/admin/tools', pattern: 'unix-user-path' },
    { name: 'env var path', notes: 'located under %USERPROFILE%\\x', pattern: 'env-user-path' },
    { name: 'redaction marker', notes: 'value was <redacted:api-key>', pattern: 'redaction-marker' },
    { name: 'token-like value', notes: `use ${TOKEN_LIKE} locally`, pattern: 'github-token' },
    { name: 'private key', notes: '-----BEGIN PRIVATE KEY-----', pattern: 'private-key' },
    { name: 'email', notes: 'contact admin@example.com', pattern: 'email' },
  ];

  for (const c of cases) {
    it(`fails on ${c.name} in a whitelisted field, naming entry and field`, async () => {
      const repo = await makeTempRepo();
      try {
        await writeCatalogFile(
          repo,
          'catalog/skills/dirty.yaml',
          skillYaml({ id: 'dirty-entry', notes: c.notes }),
        );
        const error = await buildSite({ root: repo }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SiteBuildError);
        const diagnostics = (error as SiteBuildError).diagnostics.join('\n');
        expect(diagnostics).toContain('dirty-entry');
        expect(diagnostics).toContain('notes');
        expect(diagnostics).toContain(c.pattern);
      } finally {
        await cleanupRepo(repo);
      }
    });
  }

  it('fails with entry attribution inside nested installInstructions', async () => {
    const repo = await makeTempRepo();
    try {
      await writeCatalogFile(
        repo,
        'catalog/skills/nested.yaml',
        skillYaml({
          id: 'nested-entry',
          notes: 'clean notes',
        }).replace(
          '    claude-code: install via marketplace',
          '    claude-code: clone D:\\repos\\thing first',
        ),
      );
      const error = await buildSite({ root: repo }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SiteBuildError);
      const diagnostics = (error as SiteBuildError).diagnostics.join('\n');
      expect(diagnostics).toContain('nested-entry');
      expect(diagnostics).toContain('installInstructions.claude-code');
    } finally {
      await cleanupRepo(repo);
    }
  });
});
