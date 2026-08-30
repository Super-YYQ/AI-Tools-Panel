/**
 * In-memory InventoryStore implementation (ADR-011: store behind interface,
 * in-memory for tests). Applies the PRI-001 sanitization boundary and a
 * PRI-002 retention cap so behavior matches the SQLite store.
 */
import type {
  AnalysisProposalValue,
  DiagnosticValue,
  InventoryStore,
  ObservationValue,
  ScanRun,
} from '@aitp/contracts';
import { sanitizeDiagnostics, sanitizeObservations } from '@aitp/inventory-core';

const MAX_RETAINED_RUNS = 10;

export class MemoryInventoryStore implements InventoryStore {
  private runs = new Map<string, { run: ScanRun; observations: ObservationValue[]; diagnostics: DiagnosticValue[] }>();
  private proposals = new Map<string, AnalysisProposalValue>();

  async saveScanRun(run: ScanRun, observations: ObservationValue[], diagnostics: DiagnosticValue[]): Promise<void> {
    this.runs.set(run.runId, { run, observations: sanitizeObservations(observations), diagnostics: sanitizeDiagnostics(diagnostics) });
    this.prune();
  }

  private prune(): void {
    const success = [...this.runs.values()]
      .filter((r) => r.run.status === 'completed' || r.run.status === 'partial')
      .sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
    for (const entry of success.slice(MAX_RETAINED_RUNS)) {
      this.runs.delete(entry.run.runId);
    }
  }

  async getLastSuccessfulRun(): Promise<ScanRun | undefined> {
    const all = [...this.runs.values()].map((r) => r.run);
    const success = all.filter((r) => r.status === 'completed' || r.status === 'partial');
    return success.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  }

  async getScanRun(runId: string): Promise<ScanRun | undefined> {
    return this.runs.get(runId)?.run;
  }

  async listObservations(runId: string): Promise<ObservationValue[]> {
    return this.runs.get(runId)?.observations ?? [];
  }

  async listDiagnostics(runId: string): Promise<DiagnosticValue[]> {
    return this.runs.get(runId)?.diagnostics ?? [];
  }

  async saveProposal(proposal: AnalysisProposalValue): Promise<void> {
    this.proposals.set(proposal.proposalId, proposal);
  }

  async listProposals(artifactId?: string): Promise<AnalysisProposalValue[]> {
    const all = [...this.proposals.values()];
    return artifactId ? all.filter((p) => p.artifactId === artifactId) : all;
  }

  async listRuns(): Promise<ScanRun[]> {
    return [...this.runs.values()].map((r) => r.run).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async clearHistory(): Promise<void> {
    this.runs.clear();
  }

  async clearProposals(): Promise<void> {
    this.proposals.clear();
  }
}
