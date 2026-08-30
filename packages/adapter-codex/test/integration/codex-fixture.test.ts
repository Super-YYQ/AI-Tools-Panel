import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexAdapter, chainDirs, buildAgentsChainFromFs } from '@aitp/adapter-codex';
import type { Candidate, ScanContext } from '@aitp/contracts';

// SCAN-002 for the Codex adapter (SCANNING_SPEC §6).
let repo: string;
let context: ScanContext;
const adapter = new CodexAdapter();
const fixtureSource = resolve(__dirname, '../../../../tests/fixtures/codex-repo');

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-codex-'));
  await cp(fixtureSource, repo, { recursive: true });
  context = { repoRoot: repo, homeDir: repo, cwd: join(repo, 'sub'), limits: { maxFileBytes: 512 * 1024, maxFiles: 500, maxDepth: 8 } };
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function collect(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for await (const c of adapter.discover(context)) out.push(c);
  return out;
}

describe('AGENTS.md chain (RULE-001, SCAN-002)', () => {
  it('walks from CWD to Git root, root-first (load order)', () => {
    const dirs = chainDirs(join(repo, 'sub'), repo);
    expect(dirs[0]!.toLowerCase()).toBe(repo.toLowerCase());
    expect(dirs.length).toBeGreaterThanOrEqual(2);
  });

  it('records override beats fallback per directory from the real filesystem (FUN-01)', async () => {
    const chain = await buildAgentsChainFromFs(context);
    // <user> + repo root + sub
    expect(chain.entries.length).toBeGreaterThanOrEqual(3);
    const rootEntry = chain.entries.find((e) => e.dirToken === '.')!;
    expect(rootEntry.selected).toBe('AGENTS.md');
    expect(rootEntry.excluded).toEqual([]);
    const subEntry = chain.entries.find((e) => e.dirToken === 'sub')!;
    expect(subEntry.selected).toBe('AGENTS.override.md');
    expect(subEntry.excluded).toEqual(['AGENTS.md']);
    // No absolute machine paths leak into chain tokens (PRI-001).
    expect(JSON.stringify(chain)).not.toContain(repo.slice(0, 12));
  });
});

describe('discover + parse', () => {
  it('finds repo skills and rule documents', async () => {
    const candidates = await collect();
    expect(candidates.some((c) => c.kind === 'skill' && c.name === 'report')).toBe(true);
    expect(candidates.some((c) => c.kind === 'rule-document' && c.name === 'AGENTS.md')).toBe(true);
    expect(candidates.some((c) => c.kind === 'rule-document' && c.name === 'AGENTS.override.md')).toBe(true);
  });

  it('parses TOML hooks as data with redaction (SCAN-008)', async () => {
    const candidates = await collect();
    const hook = candidates.find((c) => c.kind === 'hook')!;
    const result = await adapter.parse(hook, context);
    const serialized = JSON.stringify(result.observations);
    expect(serialized).toContain('<redacted:');
    expect(serialized).not.toContain('ghp_exampletokenvalue');
  });

  it('distinguishes file-exists vs loaded-in-context (SCANNING_SPEC §6)', async () => {
    const candidates = await collect();
    const overrideDoc = candidates.find((c) => c.name === 'AGENTS.override.md')!;
    const result = await adapter.parse(overrideDoc, context);
    const summary = result.observations[0]!.summary as { loadedInContext?: boolean; chain?: Array<{ dirToken: string; selected: string | null }>; manifest?: unknown };
    expect(summary.loadedInContext).toBe(true);
    expect(Array.isArray(summary.chain)).toBe(true);
    // Chain tokens are repo-relative or '<user>' — never absolute paths.
    expect(summary.chain!.every((e) => !e.dirToken.includes(':'))).toBe(true);
    // PRI-02: raw frontmatter is not persisted.
    expect(summary.manifest).toBeUndefined();
  });

  it('is deterministic across runs (NFR-001)', async () => {
    const a = (await collect()).map((c) => `${c.kind}|${c.name}`);
    const b = (await collect()).map((c) => `${c.kind}|${c.name}`);
    expect(a).toEqual(b);
  });

  it('empty environment yields no candidates and no crash (NFR-003)', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'aitp-empty-'));
    try {
      const empty = { ...context, repoRoot: emptyRoot, cwd: emptyRoot };
      const out = await (async () => {
        const list: Candidate[] = [];
        for await (const c of adapter.discover(empty)) list.push(c);
        return list;
      })();
      expect(out.filter((c) => c.scope !== 'user')).toHaveLength(0);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
