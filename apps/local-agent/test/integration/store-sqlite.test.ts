import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteInventoryStore, defaultDbPath, STORE_SCHEMA_VERSION, openStoreWithRecovery } from '../../src/store-sqlite.js';
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

describe('M7-04 schema version + corrupt-database recovery drill', () => {
  it('records the schema version in store_meta on a fresh database', async () => {
    const dbPath = defaultDbPath(dir);
    const store = new SqliteInventoryStore(dbPath);
    try {
      expect(store.recovery).toEqual({ action: 'none' });
      const opened = openStoreWithRecovery(dbPath);
      try {
        const row = opened.db.prepare("SELECT value FROM store_meta WHERE key = 'schema_version'").get() as { value: string };
        expect(Number(row.value)).toBe(STORE_SCHEMA_VERSION);
      } finally {
        opened.db.close();
      }
    } finally {
      store.close();
    }
  });

  it('recovers from a corrupt database: backs up (never deletes) and rebuilds usable store', async () => {
    const dbPath = defaultDbPath(dir);
    await mkdir(join(dir, '.aitp'), { recursive: true });
    // Garbage bytes that are not a SQLite file (torn write / disk corruption).
    await writeFile(dbPath, Buffer.from('this is not a database at all — corrupt drill payload'.repeat(40), 'utf8'));
    const store = new SqliteInventoryStore(dbPath);
    try {
      expect(store.recovery.action).toBe('backed-up-corrupt-db');
      const backupPath = store.recovery.action === 'backed-up-corrupt-db' ? store.recovery.backupPath : '';
      expect(backupPath).toContain('.bak');
      // The corrupt original is preserved for forensics, not silently deleted.
      const preserved = await readFile(backupPath, 'utf8');
      expect(preserved).toContain('corrupt drill payload');
      // The rebuilt store is fully usable.
      await store.saveScanRun(run, [obs], [diag]);
      expect((await store.getLastSuccessfulRun())?.runId).toBe('run-1');
      expect(await store.listObservations('run-1')).toEqual([obs]);
      // Exactly one backup file was created (next to the DB under .aitp/).
      const files = await readdir(join(dir, '.aitp'));
      expect(files.filter((f) => f.includes('.corrupt-') && f.endsWith('.bak'))).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('opens an existing healthy database without backup or rebuild', async () => {
    const dbPath = defaultDbPath(dir);
    const first = new SqliteInventoryStore(dbPath);
    await first.saveScanRun(run, [obs], []);
    first.close();
    const second = new SqliteInventoryStore(dbPath);
    try {
      expect(second.recovery).toEqual({ action: 'none' });
      expect((await second.getLastSuccessfulRun())?.runId).toBe('run-1');
    } finally {
      second.close();
    }
  });
});
