import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteInventoryStore, defaultDbPath } from '../../src/store-sqlite.js';
import type { ObservationValue, ScanRun, DiagnosticValue, AnalysisProposalValue } from '@aitp/contracts';

// M0-08 SQLite Windows spike (ADR-011) + shared store contract on a temp DB.
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aitp-sqlite-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run: ScanRun = {
  runId: 'run-1',
  status: 'completed',
  startedAt: '2026-08-30T00:00:00Z',
  finishedAt: '2026-08-30T00:00:05Z',
  providers: ['claude-code'],
  counts: { added: 1, changed: 0, missing: 0, total: 1 },
  diagnosticCounts: {},
};

const obs: ObservationValue = {
  observationId: 'obs-1',
  artifactId: 'skill-x',
  provider: 'claude-code',
  kind: 'skill',
  scope: 'user',
  canonicalName: 'x',
  location: { pathToken: 'a/b', scope: 'user' },
  copyRole: 'source',
  enabled: 'unknown',
  contentHash: 'h',
  summary: { description: 'd' },
  sourceEvidence: [],
  related: [],
  discoveredAt: 't',
  parser: { name: 'x', version: '1' },
};

const diag: DiagnosticValue = { code: 'PARTIAL_SCAN', severity: 'warning', provider: 'claude-code', message: 'm' };

describe('SqliteInventoryStore (InventoryStore contract)', () => {
  it('spike: opens WAL database in app-owned path and round-trips a scan run', async () => {
    const store = new SqliteInventoryStore(defaultDbPath(dir));
    try {
      await store.saveScanRun(run, [obs], [diag]);
      const fetched = await store.getScanRun('run-1');
      expect(fetched).toMatchObject({ runId: 'run-1', status: 'completed', counts: run.counts });
      expect(await store.getLastSuccessfulRun()?.then((r) => r?.runId)).toBe('run-1');
      const listed = await store.listObservations('run-1');
      expect(listed).toEqual([obs]);
      expect(await store.listDiagnostics('run-1')).toEqual([diag]);
    } finally {
      store.close();
    }
  });

  it('supports incremental replacement and proposal queries', async () => {
    const store = new SqliteInventoryStore(':memory:');
    try {
      await store.saveScanRun(run, [], []);
      const second: ScanRun = { ...run, runId: 'run-2', status: 'partial', startedAt: '2026-08-30T01:00:00Z' };
      await store.saveScanRun(second, [obs], []);
      // Partial runs are valid baselines; only failed/cancelled never replace (SCANNING_SPEC §3).
      expect((await store.getLastSuccessfulRun())!.runId).toBe('run-2');
      expect((await store.listObservations('run-2')).length).toBe(1);
      expect((await store.listObservations('run-1')).length).toBe(0);

      const proposal: AnalysisProposalValue = {
        proposalId: 'p1',
        artifactId: 'skill-x',
        task: 'summary',
        claims: [],
        provider: 'test',
        createdAt: 't',
        inputDigest: 'd',
        status: 'pending',
      };
      await store.saveProposal(proposal);
      expect(await store.listProposals('skill-x')).toHaveLength(1);
      expect(await store.listProposals('other')).toHaveLength(0);
    } finally {
      store.close();
    }
  });
});

describe('PRI-102 retention semantics', () => {
  it('caps successful runs at 10 regardless of age window', async () => {
    const store = new SqliteInventoryStore(':memory:');
    try {
      for (let i = 0; i < 12; i++) {
        const run: ScanRun = {
          runId: `run-${i}`,
          status: 'completed',
          startedAt: new Date(Date.now() - i * 60_000).toISOString(),
          providers: ['claude-code'],
          counts: { added: 0, changed: 0, missing: 0, total: 0 },
          diagnosticCounts: {},
        };
        await store.saveScanRun(run, [], []);
      }
      const runs = await store.listRuns();
      expect(runs.length).toBe(10);
      // Newest kept, oldest evicted.
      expect(runs.map((r) => r.runId)).not.toContain('run-11');
      expect(runs.map((r) => r.runId)).toContain('run-0');
      // A cancelled run never becomes the last-successful baseline either.
      const cancelled: ScanRun = {
        runId: 'cancelled-1',
        status: 'cancelled',
        startedAt: new Date().toISOString(),
        providers: ['claude-code'],
        counts: { added: 0, changed: 0, missing: 0, total: 0 },
        diagnosticCounts: {},
      };
      await store.saveScanRun(cancelled, [], []);
      expect((await store.getLastSuccessfulRun())!.runId).toBe('run-0');
    } finally {
      store.close();
    }
  });
});
