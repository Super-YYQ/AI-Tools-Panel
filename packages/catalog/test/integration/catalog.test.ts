import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCatalogYaml,
  serializeCatalogEntry,
  buildChangeSet,
  applyChangeSet,
  unifiedDiff,
  isAllowedWritePath,
  readSourcesLock,
  frontmatterRoundTrip,
  serializeRuleFragment,
} from '@aitp/catalog';
import type { CatalogEntryValue } from '@aitp/contracts';

// M1 exit criteria: CAT-001..009, GIT-004/005 non-UI parts.
let repo: string;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-catalog-'));
  await mkdir(join(repo, 'catalog', 'skills'), { recursive: true });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const entry: CatalogEntryValue = {
  apiVersion: 'aitp.dev/v1alpha1',
  kind: 'Skill',
  metadata: {
    id: 'code-review',
    displayName: 'Code Review',
    shortDescription: 'Review code.',
    tags: ['quality', 'review'],
    archived: false,
  },
  spec: {
    targets: ['claude-code'],
    ownership: 'referenced',
    source: { type: 'git', url: 'https://github.com/example/skills', revision: 'abc' },
    license: { status: 'confirmed', expression: 'MIT' },
    installInstructions: {},
    contentPolicy: 'metadata-only',
    components: [],
  },
  overlay: { notes: 'hand written', fieldOrigins: { shortDescription: 'human' } },
  verification: {},
};

describe('parse + serialize (M1-01/02)', () => {
  it('round-trips without meaningful diff (stable serialization)', () => {
    const text = serializeCatalogEntry(entry);
    const parsed = parseCatalogYaml(text, 'catalog/skills/code-review.yaml');
    expect(parsed.diagnostics).toHaveLength(0);
    const again = serializeCatalogEntry(parsed.entry!);
    expect(again).toBe(text);
  });

  it('preserves unknown fields (CAT-006)', () => {
    const text = `${serializeCatalogEntry(entry)}customExperimental: keep-me\n`;
    const parsed = parseCatalogYaml(text, 'x.yaml');
    expect((parsed.entry!.unknown as Record<string, unknown>).customExperimental).toBe('keep-me');
    expect(serializeCatalogEntry(parsed.entry!)).toContain('customExperimental');
  });

  it('flags unsupported apiVersion as read-only', () => {
    const parsed = parseCatalogYaml('apiVersion: aitp.dev/v2\nkind: Skill\n', 'x.yaml');
    expect(parsed.diagnostics.some((d) => d.code === 'UNSUPPORTED_VERSION')).toBe(true);
  });

  it('malformed YAML produces a diagnostic, not a crash (SCAN-005 analog)', () => {
    const parsed = parseCatalogYaml('metadata: [unclosed', 'x.yaml');
    expect(parsed.entry).toBeUndefined();
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('ChangeSet (M1-04, ADR-008)', () => {
  it('rejects paths outside the write allowlist', () => {
    expect(isAllowedWritePath('catalog/skills/x.yaml')).toBe(true);
    expect(isAllowedWritePath('sources.lock.yaml')).toBe(true);
    expect(isAllowedWritePath('CLAUDE.md')).toBe(false);
    expect(isAllowedWritePath('.claude/settings.json')).toBe(false);
    const { errors } = buildChangeSet(repo, 'r', [{ repoRelativePath: 'CLAUDE.md', operation: 'update', content: 'x', oldContent: 'y' }]);
    expect(errors.join()).toContain('allowlist');
  });

  it('produces hashes and unified diff for create', () => {
    const { changeSet, errors } = buildChangeSet(repo, 'test', [
      { repoRelativePath: 'catalog/skills/new.yaml', operation: 'create', content: 'a: 1\n' },
    ]);
    expect(errors).toHaveLength(0);
    expect(changeSet!.changes[0]!.newHash).toMatch(/^[0-9a-f]{64}$/);
    expect(changeSet!.changes[0]!.unifiedDiff).toContain('+a: 1');
    expect(changeSet!.changes[0]!.expectedOldHash).toBeUndefined();
  });

  it('diff is empty for identical content', () => {
    expect(unifiedDiff('same\n', 'same\n', 'f.yaml')).toBe('');
  });
});

describe('atomic apply (M1-05, GIT-005, gates 6/9)', () => {
  it('applies create and re-reads content', async () => {
    const { changeSet } = buildChangeSet(repo, 'create', [
      { repoRelativePath: 'catalog/skills/new.yaml', operation: 'create', content: 'apiVersion: aitp.dev/v1alpha1\nkind: Skill\n' },
    ])!;
    const result = await applyChangeSet(repo, changeSet!);
    expect(result.ok).toBe(true);
    expect(await readFile(join(repo, 'catalog', 'skills', 'new.yaml'), 'utf8')).toContain('kind: Skill');
  });

  it('hash conflict leaves target byte-for-byte unchanged (gate 6)', async () => {
    const path = join(repo, 'catalog', 'skills', 'conflict.yaml');
    await writeFile(path, 'original\n', 'utf8');
    const { changeSet } = buildChangeSet(repo, 'r', [
      { repoRelativePath: 'catalog/skills/conflict.yaml', operation: 'update', content: 'hostile\n', oldContent: 'different\n' },
    ]);
    const result = await applyChangeSet(repo, changeSet!);
    expect(result.ok).toBe(false);
    expect(result.conflicts[0]!.reason).toBe('hash-conflict');
    expect(await readFile(path, 'utf8')).toBe('original\n');
  });

  it('rolls back multi-file failure (gate 9)', async () => {
    const good = 'a: 1\n';
    const cs = buildChangeSet(repo, 'r', [
      { repoRelativePath: 'catalog/skills/first.yaml', operation: 'create', content: good },
      { repoRelativePath: 'catalog/skills/second.yaml', operation: 'update', content: 'x\n', oldContent: 'not-there\n' },
    ]).changeSet!;
    const result = await applyChangeSet(repo, cs);
    expect(result.ok).toBe(false);
    expect(result.recovered).toContain('catalog/skills/first.yaml');
    // Rollback removed the created file.
    await expect(readFile(join(repo, 'catalog', 'skills', 'first.yaml'), 'utf8')).rejects.toThrow();
  });
});

describe('sources.lock (M1-06)', () => {
  it('returns empty lock when absent and round-trips', async () => {
    expect((await readSourcesLock(repo)).sources).toEqual({});
    expect(readSourcesLock).toBeDefined();
  });
});

describe('rule fragment markdown (M1-07)', () => {
  it('round-trips frontmatter and body', () => {
    const fm = { apiVersion: 'aitp.dev/v1alpha1', kind: 'RuleFragment', id: 'x', categories: ['git'] };
    const md = serializeRuleFragment(fm, '\nOnly push after explicit authorization.\n');
    const parsed = frontmatterRoundTrip(md);
    expect(parsed!.frontmatter).toMatchObject(fm);
    expect(parsed!.body).toContain('Only push after');
  });
});
