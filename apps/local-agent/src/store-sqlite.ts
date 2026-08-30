/**
 * SQLite-backed InventoryStore (ADR-011: production store behind the
 * InventoryStore interface). better-sqlite3 in synchronous mode; the app-owned
 * database lives under .aitp/ (gitignored, GIT-002).
 * Applies the PRI-001/103 sanitization boundary and PRI-102 retention.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sanitizeDiagnostics, sanitizeObservations, sanitizeProposal } from '@aitp/inventory-core';
import type {
  AnalysisProposalValue,
  DiagnosticValue,
  InventoryStore,
  ObservationValue,
  ScanRun,
} from '@aitp/contracts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scan_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  providers TEXT NOT NULL,
  counts TEXT NOT NULL,
  diagnostic_counts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  observation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (observation_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_observations_run ON observations(run_id);
CREATE TABLE IF NOT EXISTS diagnostics (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE IF NOT EXISTS proposals (
  proposal_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_artifact ON proposals(artifact_id);
`;

export class SqliteInventoryStore implements InventoryStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  async saveScanRun(run: ScanRun, observations: ObservationValue[], diagnostics: DiagnosticValue[]): Promise<void> {
    const sanitized = sanitizeObservations(observations);
    const sanitizedDiagnostics = sanitizeDiagnostics(diagnostics);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO scan_runs (run_id, status, started_at, finished_at, providers, counts, diagnostic_counts)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(run.runId, run.status, run.startedAt, run.finishedAt ?? null, JSON.stringify(run.providers), JSON.stringify(run.counts), JSON.stringify(run.diagnosticCounts));
      const insObs = this.db.prepare('INSERT OR REPLACE INTO observations (observation_id, run_id, artifact_id, data) VALUES (?, ?, ?, ?)');
      for (const o of sanitized) insObs.run(o.observationId, run.runId, o.artifactId, JSON.stringify(o));
      const insDiag = this.db.prepare('INSERT OR REPLACE INTO diagnostics (run_id, seq, data) VALUES (?, ?, ?)');
      sanitizedDiagnostics.forEach((d, i) => insDiag.run(run.runId, i, JSON.stringify(d)));
    });
    tx();
    this.pruneRetention();
  }

  /** PRI-102: keep-set semantics — newest 10 successful/partial within 30
   * days; failed/cancelled only the newest 5 within 3 days. Everything else
   * (and its observations/diagnostics) is deleted. */
  private pruneRetention(): void {
    const now = Date.now();
    const successCutoff = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const failedCutoff = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const all = this.db.prepare('SELECT run_id, started_at, status FROM scan_runs').all() as Array<{ run_id: string; started_at: string; status: string }>;
    const success = all
      .filter((r) => r.status === 'completed' || r.status === 'partial')
      .filter((r) => r.started_at >= successCutoff)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 10);
    const failed = all
      .filter((r) => r.status !== 'completed' && r.status !== 'partial')
      .filter((r) => r.started_at >= failedCutoff)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 5);
    const keep = new Set([...success, ...failed].map((r) => r.run_id));
    for (const r of all) {
      if (keep.has(r.run_id)) continue;
      this.db.prepare('DELETE FROM observations WHERE run_id = ?').run(r.run_id);
      this.db.prepare('DELETE FROM diagnostics WHERE run_id = ?').run(r.run_id);
      this.db.prepare('DELETE FROM scan_runs WHERE run_id = ?').run(r.run_id);
    }
  }

  async getLastSuccessfulRun(): Promise<ScanRun | undefined> {
    const row = this.db
      .prepare("SELECT * FROM scan_runs WHERE status IN ('completed','partial') ORDER BY started_at DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : undefined;
  }

  async getScanRun(runId: string): Promise<ScanRun | undefined> {
    const row = this.db.prepare('SELECT * FROM scan_runs WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : undefined;
  }

  async listObservations(runId: string): Promise<ObservationValue[]> {
    const rows = this.db.prepare('SELECT data FROM observations WHERE run_id = ? ORDER BY observation_id').all(runId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as ObservationValue);
  }

  async listDiagnostics(runId: string): Promise<DiagnosticValue[]> {
    const rows = this.db.prepare('SELECT data FROM diagnostics WHERE run_id = ? ORDER BY seq').all(runId) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as DiagnosticValue);
  }

  async saveProposal(proposal: AnalysisProposalValue): Promise<void> {
    const sanitized = sanitizeProposal(proposal);
    this.db
      .prepare('INSERT OR REPLACE INTO proposals (proposal_id, artifact_id, data) VALUES (?, ?, ?)')
      .run(sanitized.proposalId, sanitized.artifactId, JSON.stringify(sanitized));
  }

  async listProposals(artifactId?: string): Promise<AnalysisProposalValue[]> {
    const rows = artifactId
      ? (this.db.prepare('SELECT data FROM proposals WHERE artifact_id = ?').all(artifactId) as Array<{ data: string }>)
      : (this.db.prepare('SELECT data FROM proposals').all() as Array<{ data: string }>);
    return rows.map((r) => JSON.parse(r.data) as AnalysisProposalValue);
  }

  async listRuns(): Promise<ScanRun[]> {
    const rows = this.db.prepare('SELECT * FROM scan_runs ORDER BY started_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map(rowToRun);
  }

  async clearHistory(): Promise<void> {
    this.db.exec('DELETE FROM observations; DELETE FROM diagnostics; DELETE FROM scan_runs;');
  }

  async clearProposals(): Promise<void> {
    this.db.exec('DELETE FROM proposals;');
  }

  close(): void {
    this.db.close();
  }
}

function rowToRun(row: Record<string, unknown>): ScanRun {
  return {
    runId: row.run_id as string,
    status: row.status as ScanRun['status'],
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string) ?? undefined,
    providers: JSON.parse(row.providers as string) as ScanRun['providers'],
    counts: JSON.parse(row.counts as string) as ScanRun['counts'],
    diagnosticCounts: JSON.parse(row.diagnostic_counts as string) as ScanRun['diagnosticCounts'],
  };
}

/** App-owned default database location, gitignored (GIT-002). */
export function defaultDbPath(repoRoot: string): string {
  return join(repoRoot, '.aitp', 'inventory.db');
}
