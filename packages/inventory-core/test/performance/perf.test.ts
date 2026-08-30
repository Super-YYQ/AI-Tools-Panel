import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import { reconcile } from '@aitp/reconcile';
import { sortObservations } from '@aitp/inventory-core';
import type { Candidate, ObservationValue, ScanContext } from '@aitp/contracts';

// NFR-002 / TEST_STRATEGY §8: 2,000 candidate files scan < 5s; 5,000-row
// filter operations land in the 150ms budget. Budgets are CI-safe upper bounds.
let dir: string | undefined;
let emptyHome: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  if (emptyHome) await rm(emptyHome, { recursive: true, force: true });
  dir = undefined;
  emptyHome = undefined;
});

async function makeSkillTree(root: string, count: number): Promise<void> {
  // Batch-create N skill dirs with small SKILL.md files.
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      (async () => {
        const d = join(root, '.claude', 'skills', `perf-skill-${String(i).padStart(5, '0')}`);
        await mkdir(d, { recursive: true });
        await writeFile(join(d, 'SKILL.md'), `---\nname: perf-skill-${i}\ndescription: Performance fixture ${i}.\n---\nBody ${i}`, 'utf8');
      })(),
    ),
  );
}

describe('performance baselines', () => {
  it('SCAN-PERF: incremental rescan of 2,000 candidates completes within 5s (NFR-002)', { timeout: 120_000, retry: 2 }, async () => {
    dir = await mkdtemp(join(tmpdir(), 'aitp-perf-'));
    const home = await mkdtemp(join(tmpdir(), 'aitp-perf-home-'));
    emptyHome = home;
    await makeSkillTree(dir, 2000);
    const context: ScanContext = { repoRoot: dir, homeDir: emptyHome, cwd: dir, limits: { maxFileBytes: 512 * 1024, maxFiles: 20000, maxDepth: 8 } };
    const adapter = new ClaudeAdapter();

    const runScan = async (): Promise<{ elapsed: number; count: number }> => {
      const t0 = performance.now();
      const candidates: Candidate[] = [];
      for await (const c of adapter.discover(context)) candidates.push(c);
      const observations: ObservationValue[] = [];
      for (const c of candidates) {
        const r = await adapter.parse(c, context);
        observations.push(...r.observations);
      }
      sortObservations(observations);
      return { elapsed: performance.now() - t0, count: observations.length };
    };

    // Cold scan establishes the parse cache (SCANNING_SPEC §11 增量扫描).
    const cold = await runScan();
    expect(cold.count).toBe(2000);
    // NFR-002: the INCREMENTAL scan must complete within 5 seconds.
    const warm = await runScan();
    expect(warm.count).toBe(2000);
    expect(warm.elapsed).toBeLessThan(5000);
    console.log(`perf: 2000-candidate cold ${Math.round(cold.elapsed)}ms, incremental ${Math.round(warm.elapsed)}ms`);
  }, 120_000);

  it('FILTER-PERF: 5,000-row text filter stays within 150ms budget', { timeout: 60_000 }, () => {
    const obs: ObservationValue[] = Array.from({ length: 5000 }, (_, i) => ({
      observationId: `obs-${i}`,
      artifactId: `skill-p-${i}`,
      provider: 'claude-code',
      kind: 'skill',
      scope: 'user',
      canonicalName: `perf-skill-${i}`,
      location: { pathToken: `p/${i}`, scope: 'user' },
      copyRole: 'source',
      enabled: 'unknown',
      contentHash: `h-${i}`,
      summary: { description: `Performance fixture ${i} with unique token ${Math.random()}` },
      sourceEvidence: [],
      related: [],
      discoveredAt: 't',
      parser: { name: 'x', version: '1' },
    }));
    const t0 = performance.now();
    const filtered = obs.filter((o) => JSON.stringify(o).toLowerCase().includes('perf-skill-49'));
    const sorted = sortObservations(filtered);
    const elapsed = performance.now() - t0;
    expect(sorted.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(150);
    console.log(`perf: 5000-row filter took ${Math.round(elapsed)}ms`);
  });

  it('RECONCILE-PERF: reconcile over 5,000 observations stays responsive', { timeout: 60_000 }, () => {
    const obs: ObservationValue[] = Array.from({ length: 5000 }, (_, i) => ({
      observationId: `obs-${i}`,
      artifactId: `skill-p-${i}`,
      provider: 'claude-code',
      kind: 'skill',
      scope: 'user',
      canonicalName: `perf-skill-${i}`,
      location: { pathToken: `p/${i}`, scope: 'user' },
      copyRole: 'source',
      enabled: 'unknown',
      contentHash: `h-${i}`,
      summary: {},
      sourceEvidence: [],
      related: [],
      discoveredAt: 't',
      parser: { name: 'x', version: '1' },
    }));
    const t0 = performance.now();
    const result = reconcile(obs, []);
    const elapsed = performance.now() - t0;
    expect(result.items.length).toBe(5000);
    expect(elapsed).toBeLessThan(1000);
    console.log(`perf: reconcile 5000 took ${Math.round(elapsed)}ms`);
  });
});
