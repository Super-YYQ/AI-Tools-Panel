import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import { CodexAdapter } from '@aitp/adapter-codex';
import type { Candidate, ScanContext } from '@aitp/contracts';

// Security gates 2/3: scanned Hook/Skill/Plugin content is data only —
// malicious commands in fixtures must never create marker files.
let repo: string;
let context: ScanContext;
const fixtureSource = resolve(__dirname, '../../../../tests/fixtures');

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-sec-'));
  await cp(join(fixtureSource, 'claude-repo'), repo, { recursive: true });
  await cp(join(fixtureSource, 'claude-user', '.claude'), join(repo, '.claude-user'), { recursive: true });
  await cp(join(fixtureSource, 'codex-repo'), join(repo, 'codex'), { recursive: true });
  context = { repoRoot: repo, homeDir: repo, cwd: repo, limits: { maxFileBytes: 512 * 1024, maxFiles: 500, maxDepth: 8 } };
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

async function fullScan(adapters: Array<{ discover(context: ScanContext): AsyncIterable<Candidate>; parse(c: Candidate, ctx: ScanContext): Promise<unknown> }>): Promise<void> {
  for (const adapter of adapters) {
    for await (const candidate of adapter.discover(context)) {
      await adapter.parse(candidate, context);
    }
  }
}

describe('no-execution gate (SCAN-008, SECURITY gate 3)', () => {
  it('full scan of malicious fixtures creates no marker files and modifies nothing', async () => {
    const before = (await readdir(repo)).sort();
    await fullScan([new ClaudeAdapter(), new CodexAdapter()]);
    const after = (await readdir(repo)).sort();
    expect(after).toEqual(before);
    // No temp/executable artifacts anywhere in the scanned tree.
    const all = await collectFiles(repo);
    expect(all.every((f) => !f.includes('marker'))).toBe(true);
  });
});

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push(p);
    }
  };
  await walk(dir);
  return out;
}
