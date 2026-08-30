/**
 * SQLite-backed InventoryStore (ADR-011: production store behind the
 * InventoryStore interface). better-sqlite3 in synchronous mode; the app-owned
 * database lives under .aitp/ (gitignored, GIT-002).
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO scan_runs (run_id, status, started_at, finished_at, providers, counts, diagnostic_counts)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(run.runId, run.status, run.startedAt, run.finishedAt ?? null, JSON.stringify(run.providers), JSON.stringify(run.counts), JSON.stringify(run.diagnosticCounts));
      const insObs = this.db.prepare('INSERT OR REPLACE INTO observations (observation_id, run_id, artifact_id, data) VALUES (?, ?, ?, ?)');
      for (const o of observations) insObs.run(o.observationId, run.runId, o.artifactId, JSON.stringify(o));
      const insDiag = this.db.prepare('INSERT OR REPLACE INTO diagnostics (run_id, seq, data) VALUES (?, ?, ?)');
      diagnostics.forEach((d, i) => insDiag.run(run.runId, i, JSON.stringify(d)));
    });
    tx();
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
    this.db
      .prepare('INSERT OR REPLACE INTO proposals (proposal_id, artifact_id, data) VALUES (?, ?, ?)')
      .run(proposal.proposalId, proposal.artifactId, JSON.stringify(proposal));
  }

  async listProposals(artifactId?: string): Promise<AnalysisProposalValue[]> {
    const rows = artifactId
      ? (this.db.prepare('SELECT data FROM proposals WHERE artifact_id = ?').all(artifactId) as Array<{ data: string }>)
      : (this.db.prepare('SELECT data FROM proposals').all() as Array<{ data: string }>);
    return rows.map((r) => JSON.parse(r.data) as AnalysisProposalValue);
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
