/** API client. All requests go through the Local Agent; the browser never
 * touches the filesystem (ARCHITECTURE §2). The session token arrives once
 * via the launch URL fragment, is stored for the tab session only, and is
 * stripped from the URL before the router initializes (FUN-001, SEC-003). */
export function bootstrapSession(): void {
  const hash = window.location.hash;
  const m = /[#&]session=([0-9a-f]+)/.exec(hash);
  if (m) {
    sessionStorage.setItem('aitp-session', m[1]!);
    // FUN-001: remove the session fragment before the router reads the hash.
    const cleanedHash = hash.replace(/[#&]?session=[0-9a-f]+/, '');
    history.replaceState(null, '', window.location.pathname + window.location.search + cleanedHash);
  }
}

function sessionToken(): string {
  return sessionStorage.getItem('aitp-session') ?? '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'x-aitp-session': sessionToken() };
  if (init?.body) headers['content-type'] = 'application/json';
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      message = body.message ?? message;
    } catch {
      /* keep status text */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface Health {
  status: string;
  repo: string;
  gitAvailable: boolean;
  providers: Record<string, boolean>;
}

export interface Observation {
  observationId: string;
  artifactId: string;
  provider: string;
  kind: string;
  scope: string;
  canonicalName: string;
  contentHash: string;
  copyRole: string;
  sourceIdentity?: { type: string; canonicalUrl?: string };
  location: { pathToken: string; scope: string };
  summary: Record<string, unknown>;
  sourceEvidence: Array<{ type: string; origin: string; detail?: string }>;
  parser: { name: string; version: string };
}

export interface ReconcileResult {
  items: Array<{ key: string; status: string; observationIds: string[]; catalogPath?: string; suggestions: string[] }>;
  counts: Record<string, number>;
}

export interface InventoryResponse {
  runId: string | null;
  observations: Observation[];
  diagnostics: Array<{ code: string; severity: string; message: string; target?: string }>;
  reconcile: ReconcileResult;
}

export interface ChangeSummary {
  changeSetId: string;
  applyToken: string;
  reason: string;
  changes: Array<{ repoRelativePath: string; operation: string; unifiedDiff: string; newHash: string; expectedOldHash?: string }>;
}

/** FUN-008: typed draft DTOs — the browser never builds YAML. */
export interface TypedDraftEntry {
  kind: 'Skill' | 'Plugin' | 'Marketplace' | 'Hook';
  path?: string;
  entry: {
    metadata: { id: string; displayName: string; shortDescription?: string; tags?: string[] };
    spec?: { targets?: string[]; source?: Record<string, unknown> };
    overlay?: { notes?: string };
    verification?: { sourceDigest?: string };
  };
}

export interface TypedDraftFragment {
  id: string;
  displayName: string;
  targets: string[];
  categories: string[];
  source: { document: string; lines: string };
  body: string;
}

export const api = {
  health: () => request<Health>('/health'),
  startScan: () => request<{ scanId: string }>('/api/v1/scans', { method: 'POST' }),
  cancelScan: (scanId: string) => request<{ ok: boolean }>(`/api/v1/scans/${scanId}/cancel`, { method: 'POST' }),
  scanStatus: (id: string) => request<{ status: string; counts: { added: number; changed: number; missing: number; total: number } }>(`/api/v1/scans/${id}`),
  inventory: () => request<InventoryResponse>('/api/v1/inventory'),
  catalog: () => request<{ entries: Array<{ repoRelativePath: string; entry: Record<string, unknown> }> }>('/api/v1/catalog'),
  gitSummary: () => request<{ branch: string; changedFiles: Array<{ status: string; path: string }> }>('/api/v1/git/summary'),
  gitDiff: () => request<{ diff: string; truncated: boolean }>('/api/v1/git/diff'),
  /** FUN-002: consume the SSE progress stream with the session header. */
  streamScanEvents(scanId: string, onEvent: (event: string, data: unknown) => void, onEnd: () => void): () => void {
    const controller = new AbortController();
    fetch(`/api/v1/scans/${scanId}/events`, {
      headers: { 'x-aitp-session': sessionToken(), accept: 'text/event-stream' },
      signal: controller.signal,
    })
      .then(async (res) => {
        const reader = res.body?.getReader();
        if (!reader) {
          onEnd();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const eventLine = chunk.split('\n').find((l) => l.startsWith('event: '));
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (eventLine) {
              const event = eventLine.slice('event: '.length);
              let data: unknown = null;
              try {
                data = dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null;
              } catch {
                data = null;
              }
              onEvent(event, data);
              if (event === 'done') {
                onEnd();
                return;
              }
            }
          }
        }
        onEnd();
      })
      .catch(() => onEnd());
    return () => controller.abort();
  },
  createTypedDraft: (payload: { reason: string; entries: TypedDraftEntry[]; fragments: TypedDraftFragment[] }) =>
    request<ChangeSummary>('/api/v1/catalog/drafts', { method: 'POST', body: JSON.stringify(payload) }),
  applyChangeSet: (id: string, applyToken: string) =>
    request<{ ok: boolean; applied: string[] }>(`/api/v1/changesets/${id}/apply`, { method: 'POST', body: JSON.stringify({ applyToken }) }),
  ruleContent: (observationId: string) =>
    request<{ observationId: string; lines: Array<{ n: number; text: string }> }>(`/api/v1/rules/${observationId}/content`),
  vendoringPreview: (pathToken: string) =>
    request<{ defaultPolicy: string; gate: { allowed: string[]; blocked: Array<{ path: string; reason: string }> } }>('/api/v1/vendoring/preview', { method: 'POST', body: JSON.stringify({ pathToken }) }),
  privacy: () => request<{ dbPathToken: string; retainedRuns: number; aiEnabled: boolean }>('/api/v1/privacy'),
  clearHistory: () => request<{ ok: boolean }>('/api/v1/history', { method: 'DELETE' }),
  clearProposals: () => request<{ ok: boolean }>('/api/v1/proposals', { method: 'DELETE' }),
};
