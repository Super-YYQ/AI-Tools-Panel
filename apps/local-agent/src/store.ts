/**
 * In-memory InventoryStore implementation (ADR-011: store behind interface,
 * in-memory for tests; SQLite can replace without contract change).
 */
import type {
  AnalysisProposalValue,
  DiagnosticValue,
  InventoryStore,
  ObservationValue,
  ScanRun,
} from '@aitp/contracts';

export class MemoryInventoryStore implements InventoryStore {
  private runs = new Map<string, { run: ScanRun; observations: ObservationValue[]; diagnostics: DiagnosticValue[] }>();
  private proposals = new Map<string, AnalysisProposalValue>();

  async saveScanRun(run: ScanRun, observations: ObservationValue[], diagnostics: DiagnosticValue[]): Promise<void> {
    this.runs.set(run.runId, { run, observations, diagnostics });
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
}
