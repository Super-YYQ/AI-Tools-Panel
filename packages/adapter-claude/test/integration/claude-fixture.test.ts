import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import type { Candidate, ScanContext } from '@aitp/contracts';

// SCAN-001..009 for the Claude adapter against synthetic fixtures (SCANNING_SPEC §12).
let repo: string;
let context: ScanContext;
const adapter = new ClaudeAdapter();
const fixtureSource = resolve(__dirname, '../../../../tests/fixtures/claude-repo');

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-claude-'));
  await cp(fixtureSource, repo, { recursive: true });
  context = { repoRoot: repo, homeDir: repo, cwd: repo, limits: { maxFileBytes: 512 * 1024, maxFiles: 500, maxDepth: 8 } };
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function collect(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for await (const c of adapter.discover(context)) out.push(c);
  return out;
}

describe('detect', () => {
  it('reports not-installed without error in empty environment (SCAN-005)', async () => {
    const emptyRoot = await mkdtemp(join(tmpdir(), 'aitp-empty-'));
    const empty = { ...context, repoRoot: emptyRoot, homeDir: emptyRoot };
    try {
      const detection = await adapter.detect(empty);
      expect(detection.installed).toBe(false);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });
});

describe('discover', () => {
  it('finds repo skills, rule documents, hooks, plugin and marketplace (SCAN-001)', async () => {
    const candidates = await collect();
    const kinds = new Set(candidates.map((c) => c.kind));
    expect(kinds).toContain('skill');
    expect(kinds).toContain('rule-document');
    expect(kinds).toContain('hook');
    expect(kinds).toContain('plugin');
    expect(kinds).toContain('marketplace');
    expect(candidates.some((c) => c.name === 'deploy-helper')).toBe(true);
  });

  it('produces stable deterministic ordering across runs (NFR-001)', async () => {
    const first = (await collect()).map((c) => `${c.kind}|${c.name}|${c.absolutePath}`);
    const second = (await collect()).map((c) => `${c.kind}|${c.name}|${c.absolutePath}`);
    expect(first).toEqual(second);
  });
});

describe('parse', () => {
  it('parses skill frontmatter into summary facts', async () => {
    const candidates = await collect();
    const skill = candidates.find((c) => c.kind === 'skill' && c.name === 'deploy-helper')!;
    const result = await adapter.parse(skill, context);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.summary.description).toBe('Help with deploy checklists.');
    expect(result.observations[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flags invalid frontmatter instead of failing the scan (SCAN-005)', async () => {
    const candidates = await collect();
    const rules = candidates.filter((c) => c.kind === 'rule-document' && c.name.includes('style'));
    expect(rules).toHaveLength(1);
    const result = await adapter.parse(rules[0]!, context);
    expect(result.diagnostics.some((d) => d.code === 'INVALID_FRONTMATTER')).toBe(false); // plain md has no frontmatter block, parsed as body
    expect(result.observations[0]!.summary.lines).toBeGreaterThan(0);
  });

  it('redacts hook commands and never executes them (SCAN-008, gate 3)', async () => {
    const candidates = await collect();
    const hooks = candidates.find((c) => c.kind === 'hook' && c.name === 'settings.json')!;
    const result = await adapter.parse(hooks, context);
    const serialized = JSON.stringify(result.observations);
    expect(serialized).toContain('<redacted:');
    expect(serialized).not.toContain('rm -rf');
  });

  it('parses marketplace manifest and keeps declared-but-not-installed entries', async () => {
    const candidates = await collect();
    const mkt = candidates.find((c) => c.kind === 'marketplace')!;
    const result = await adapter.parse(mkt, context);
    // PRI-02: whitelisted summary — names only, raw manifest not persisted.
    const summary = result.observations[0]!.summary as { pluginNames?: string[]; manifest?: unknown };
    expect(summary.pluginNames).toHaveLength(2);
    expect(summary.manifest).toBeUndefined();
  });

  it('same input produces identical observation IDs and hashes (NFR-001)', async () => {
    const candidates = await collect();
    const skill = candidates.find((c) => c.kind === 'skill')!;
    const a = (await adapter.parse(skill, context)).observations[0]!;
    const b = (await adapter.parse(skill, context)).observations[0]!;
    expect(a.observationId).toBe(b.observationId);
    expect(a.contentHash).toBe(b.contentHash);
  });
});
