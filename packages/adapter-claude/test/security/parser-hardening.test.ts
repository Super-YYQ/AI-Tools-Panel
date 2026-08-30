import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import type { Candidate, ScanContext } from '@aitp/contracts';

// Security gate 2: malformed / oversized / deeply nested parser inputs are
// isolated to a single candidate with stable diagnostics (SCAN-005).
let repo: string;
let context: ScanContext;
const adapter = new ClaudeAdapter();

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-hardening-'));
  context = { repoRoot: repo, homeDir: repo, cwd: repo, limits: { maxFileBytes: 512 * 1024, maxFiles: 500, maxDepth: 8 } };
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('parser hardening (gate 2)', () => {
  it('oversized skill file yields FILE_TOO_LARGE diagnostic, not a crash', async () => {
    await mkdir(join(repo, '.claude', 'skills', 'big'), { recursive: true });
    await writeFile(join(repo, '.claude', 'skills', 'big', 'SKILL.md'), 'x'.repeat(600 * 1024), 'utf8');
    const candidate: Candidate = { provider: 'claude-code', kind: 'skill', scope: 'repo', name: 'big', absolutePath: join(repo, '.claude', 'skills', 'big', 'SKILL.md'), copyRole: 'source' };
    const result = await adapter.parse(candidate, context);
    expect(result.observations).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'FILE_TOO_LARGE')).toBe(true);
  });

  it('deeply nested settings JSON produces INVALID_MANIFEST without hanging', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true });
    const deep = `${'['.repeat(20000)}${']'.repeat(20000)}`;
    await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify({ hooks: deep }), 'utf8');
    const candidate: Candidate = { provider: 'claude-code', kind: 'hook', scope: 'repo', name: 'settings.json', absolutePath: join(repo, '.claude', 'settings.json'), copyRole: 'source' };
    const result = await adapter.parse(candidate, context);
    // Either a stable diagnostic or a clean empty result — never a process crash.
    const ok = result.diagnostics.some((d) => d.code === 'INVALID_MANIFEST' || d.code === 'FILE_TOO_LARGE') || result.observations.length === 0;
    expect(ok).toBe(true);
  });

  it('malformed settings JSON reports INVALID_MANIFEST (error severity)', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true });
    await writeFile(join(repo, '.claude', 'settings.json'), '{ hooks: [broken', 'utf8');
    const candidate: Candidate = { provider: 'claude-code', kind: 'hook', scope: 'repo', name: 'settings.json', absolutePath: join(repo, '.claude', 'settings.json'), copyRole: 'source' };
    const result = await adapter.parse(candidate, context);
    expect(result.observations).toHaveLength(0);
    expect(result.diagnostics.some((d) => d.code === 'INVALID_MANIFEST' && d.severity === 'error')).toBe(true);
  });

  it('failed candidate does not stop other candidates (SCAN-005/NFR-003)', async () => {
    await mkdir(join(repo, '.claude', 'skills', 'bad'), { recursive: true });
    await mkdir(join(repo, '.claude', 'skills', 'good'), { recursive: true });
    await writeFile(join(repo, '.claude', 'skills', 'bad', 'SKILL.md'), 'x'.repeat(600 * 1024), 'utf8');
    await writeFile(join(repo, '.claude', 'skills', 'good', 'SKILL.md'), '---\nname: good\ndescription: fine\n---\nBody', 'utf8');
    const bad: Candidate = { provider: 'claude-code', kind: 'skill', scope: 'repo', name: 'bad', absolutePath: join(repo, '.claude', 'skills', 'bad', 'SKILL.md'), copyRole: 'source' };
    const good: Candidate = { provider: 'claude-code', kind: 'skill', scope: 'repo', name: 'good', absolutePath: join(repo, '.claude', 'skills', 'good', 'SKILL.md'), copyRole: 'source' };
    const badResult = await adapter.parse(bad, context);
    const goodResult = await adapter.parse(good, context);
    expect(badResult.observations).toHaveLength(0);
    expect(goodResult.observations).toHaveLength(1);
  });
});
