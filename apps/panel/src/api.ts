/** API client. All requests go through the Local Agent; the browser never
 * touches the filesystem (ARCHITECTURE §2). Session token comes from the
 * launch URL hash and is stored only for the tab session. */
function sessionToken(): string {
  const hash = window.location.hash;
  const m = /[#&]session=([0-9a-f]+)/.exec(hash);
  if (m) {
    sessionStorage.setItem('aitp-session', m[1]!);
    window.location.hash = hash.replace(/[#&]session=[0-9a-f]+/, '');
    return m[1];
  }
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
  enabled: boolean | 'unknown';
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

export interface VendoringPreview {
  defaultPolicy: string;
  gate: { allowed: string[]; blocked: Array<{ path: string; reason: string }> };
}

export const api = {
  health: () => request<Health>('/health'),
  startScan: () => request<{ scanId: string }>('/api/v1/scans', { method: 'POST' }),
  scanStatus: (id: string) => request<{ status: string; counts: { added: number; changed: number; missing: number; total: number } }>(`/api/v1/scans/${id}`),
  inventory: () => request<InventoryResponse>('/api/v1/inventory'),
  catalog: () => request<{ entries: Array<{ repoRelativePath: string; entry: Record<string, unknown> }> }>('/api/v1/catalog'),
  rules: () => request<{ ruleDocuments: Observation[] }>('/api/v1/rules'),
  gitSummary: () => request<{ branch: string; changedFiles: Array<{ status: string; path: string }> }>('/api/v1/git/summary'),
  createDraft: (changes: Array<{ repoRelativePath: string; operation: 'create' | 'update'; content: string }>, reason: string) =>
    request<{ changeSetId: string; applyToken: string }>('/api/v1/catalog/drafts', { method: 'POST', body: JSON.stringify({ reason, changes }) }),
  getChangeSet: (id: string) => request<{ changes: Array<{ repoRelativePath: string; operation: string; unifiedDiff: string; newHash: string; expectedOldHash?: string }> }>(`/api/v1/changesets/${id}`),
  applyChangeSet: (id: string, applyToken: string) =>
    request<{ ok: boolean; applied: string[] }>(`/api/v1/changesets/${id}/apply`, { method: 'POST', body: JSON.stringify({ applyToken }) }),
  ruleContent: (observationId: string) =>
    request<{ observationId: string; lines: Array<{ n: number; text: string }> }>(`/api/v1/rules/${observationId}/content`),
  vendoringPreview: (pathToken: string) =>
    request<VendoringPreview>('/api/v1/vendoring/preview', { method: 'POST', body: JSON.stringify({ pathToken }) }),
};
