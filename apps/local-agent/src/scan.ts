/**
 * Scan orchestration (ARCHITECTURE §7 数据流: detect → discover → parse →
 * normalize → persist/delta). One persistence phase at a time; failed/cancelled
 * runs never replace the last-successful baseline.
 */
import type { Candidate, ProviderAdapter, DiagnosticValue, ObservationValue, ScanRun, ScanContext } from '@aitp/contracts';
import { computeDelta, sortCandidates, sortObservations } from '@aitp/inventory-core';

export interface ScanOrchestratorOptions {
  adapters: ProviderAdapter[];
  context: ScanContext;
}

export class ScanOrchestrator {
  private running = false;
  private cancelled = false;

  constructor(private readonly options: ScanOrchestratorOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  cancel(): void {
    if (this.running) this.cancelled = true;
  }

  /**
   * Execute a full scan run. Partial failures do not stop other providers
   * (SCAN-005, NFR-003). Returns the terminal ScanRun + normalized data.
   */
  async execute(
    previousObservations: ObservationValue[],
    onProgress?: (event: { stage: string; provider?: string; done: number; total: number }) => void,
  ): Promise<{ run: ScanRun; observations: ObservationValue[]; diagnostics: DiagnosticValue[] }> {
    if (this.running) throw new Error('another scan is already running');
    this.running = true;
    this.cancelled = false;
    const runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    const run: ScanRun = {
      runId,
      status: 'running',
      startedAt,
      providers: this.options.adapters.map((a) => a.id),
      counts: { added: 0, changed: 0, missing: 0, total: 0 },
      diagnosticCounts: {},
    };
    const observations: ObservationValue[] = [];
    const diagnostics: DiagnosticValue[] = [];
    let hadError = false;

    try {
      for (const adapter of this.options.adapters) {
        if (this.cancelled) break;
        try {
          const detection = await adapter.detect(this.options.context);
          if (!detection.installed) {
            diagnostics.push({
              code: 'PROVIDER_NOT_INSTALLED',
              severity: 'info',
              provider: adapter.id,
              message: detection.detail ?? 'provider not detected',
            });
            continue;
          }
          const candidates: Candidate[] = [];
          for await (const c of adapter.discover(this.options.context)) candidates.push(c);
          let done = 0;
          for (const candidate of sortCandidates(candidates)) {
            if (this.cancelled) break;
            try {
              const result = await adapter.parse(candidate, this.options.context);
              observations.push(...result.observations);
              diagnostics.push(...result.diagnostics);
              if (result.diagnostics.some((d) => d.severity === 'error')) hadError = true;
            } catch (e) {
              hadError = true;
              diagnostics.push({
                code: 'PARTIAL_SCAN',
                severity: 'warning',
                provider: adapter.id,
                target: candidate.name,
                message: `candidate parse failed: ${String(e)}`,
              });
            }
            done++;
            onProgress?.({ stage: 'parse', provider: adapter.id, done, total: candidates.length });
          }
        } catch (e) {
          hadError = true;
          diagnostics.push({ code: 'PARTIAL_SCAN', severity: 'warning', provider: adapter.id, message: `provider scan failed: ${String(e)}` });
        }
      }
    } finally {
      this.running = false;
    }

    const sorted = sortObservations(observations);
    const delta = computeDelta(previousObservations, sorted);
    run.counts = {
      added: delta.added.length,
      changed: delta.changed.length,
      missing: delta.missing.length,
      total: sorted.length,
    };
    for (const d of diagnostics) {
      run.diagnosticCounts[d.code] = (run.diagnosticCounts[d.code] ?? 0) + 1;
    }
    run.status = this.cancelled ? 'cancelled' : hadError ? 'partial' : 'completed';
    run.finishedAt = new Date().toISOString();
    return { run, observations: sorted, diagnostics };
  }
}

