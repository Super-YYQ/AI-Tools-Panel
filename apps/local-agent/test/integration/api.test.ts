import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../src/main.js';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import { CodexAdapter } from '@aitp/adapter-codex';
import type { StartedServer } from '../../src/main.js';

const execAsync = promisify(execFile);
// APP-001..005 backend; P0-SEC-01 traversal; P1-SEC-03/04 auth+host; FUN-008 typed drafts.
let repo: string;
let started: StartedServer;
const fixture = resolve(__dirname, '../../../../tests/fixtures');

async function get(path: string, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers['x-aitp-session'] = started.sessionToken;
  return fetch(`http://127.0.0.1:${started.port}${path}`, { headers });
}

async function post(path: string, body: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers['x-aitp-session'] = started.sessionToken;
  return fetch(`http://127.0.0.1:${started.port}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-api-'));
  await cp(join(fixture, 'claude-repo'), repo, { recursive: true });
  await cp(join(fixture, 'codex-repo'), repo, { recursive: true });
  await execAsync('git', ['init', '-q'], { cwd: repo });
  await execAsync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  await execAsync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  await execAsync('git', ['-C', repo, 'add', '-A']);
  await execAsync('git', ['-C', repo, 'commit', '-qm', 'init']);
  // App-owned local state stays out of status checks (GIT-002).
  const { appendFile } = await import('node:fs/promises');
  await appendFile(join(repo, '.git', 'info', 'exclude'), '.aitp/\n', 'utf8').catch(() => undefined);
  started = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter(), new CodexAdapter()] });
});

afterEach(async () => {
  await started?.close();
  await rm(repo, { recursive: true, force: true });
});

describe('health (APP-004)', () => {
  it('reports repo and provider availability without auth', async () => {
    const res = await get('/health', { auth: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repo).toBe('ok');
    expect(body.gitAvailable).toBe(true);
    expect(Object.keys(body.providers).sort()).toEqual(['claude-code', 'codex']);
  });
});

describe('session + origin + host (P1-SEC-03/04, gate 5)', () => {
  it('rejects cross-origin writes', async () => {
    const res = await post('/api/v1/scans', {}, { auth: false, headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ORIGIN_REJECTED');
  });

  it('rejects all API writes without a session token', async () => {
    const res = await post('/api/v1/scans', {}, { auth: false });
    expect(res.status).toBe(401);
  });

  it('requires session on ALL /api/v1 GETs — anonymous reads are rejected (P1-SEC-03)', async () => {
    for (const path of ['/api/v1/inventory', '/api/v1/catalog', '/api/v1/catalog/entry?path=catalog/x.yaml', '/api/v1/rules', '/api/v1/sources.lock', '/api/v1/git/summary']) {
      const res = await get(path, { auth: false });
      expect(res.status, path).toBe(401);
    }
  });

  it('rejects unexpected Host headers (DNS rebinding, P1-SEC-04)', async () => {
    // Node fetch refuses to set the Host header; use http.request directly.
    const { request: httpRequest } = await import('node:http');
    const res = await new Promise<{ status: number; body: string }>((resolvePromise) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: started.port, path: '/health', headers: { host: 'evil.example' } },
        (r: { statusCode: number; on: (e: string, cb: (c: Buffer) => void) => void }) => {
          let data = '';
          r.on('data', (c: Buffer) => (data += c.toString()));
          r.on('end', () => resolvePromise({ status: r.statusCode, body: data }));
        },
      );
      req.end();
    });
    expect(res.status).toBe(403);
    expect(res.body).toContain('HOST_REJECTED');
  });

  it('rejects expired sessions (P1-SEC-04)', async () => {
    await started.close();
    const expired = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter()], sessionTtlMs: 1 });
    try {
      await new Promise((r) => setTimeout(r, 5));
      const res = await fetch(`http://127.0.0.1:${expired.port}/api/v1/inventory`, { headers: { 'x-aitp-session': expired.sessionToken } });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('SESSION_EXPIRED');
    } finally {
      await expired.close();
    }
  });

  it('rejects malformed route bodies (P1-SEC-07)', async () => {
    const res = await post('/api/v1/catalog/drafts', { reason: '', entries: 'not-an-array', fragments: [] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_REQUEST');
  });

  it('rejects oversized changes arrays (P1-SEC-07)', async () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({
      kind: 'Skill',
      entry: { metadata: { id: `x${i}`, displayName: `X ${i}` }, spec: {}, overlay: {} },
    }));
    const res = await post('/api/v1/catalog/drafts', { reason: 'bulk', entries, fragments: [] });
    expect(res.status).toBe(400);
  });
});

describe('SEC-001: catalog entry read traversal (P0)', () => {
  const vectors = [
    '../secret.yaml',
    '../../package.json',
    '..%2F..%2Fpackage.json',
    'catalog/../../AGENTS.md',
    'catalog\\..\\..\\AGENTS.md',
    '//server/share/x.yaml',
    'C:/Windows/win.yaml',
    'catalog/file.yaml:hidden',
    'catalog/../.aitp/inventory.db',
  ];

  it.each(vectors)('rejects traversal vector %s', async (vector) => {
    const res = await get(`/api/v1/catalog/entry?path=${encodeURIComponent(vector)}`);
    expect([400, 404]).toContain(res.status);
    const body = await res.json();
    expect(['PATH_REJECTED', 'NOT_FOUND', 'INVALID_REQUEST']).toContain(body.code);
  });

  it('never returns content outside catalog/ even when the file exists', async () => {
    await writeFile(join(repo, 'outside-secret.yaml'), 'topsecret: true\n', 'utf8');
    const res = await get(`/api/v1/catalog/entry?path=${encodeURIComponent('../outside-secret.yaml')}`);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain('topsecret');
  });

  it('reads a legitimate catalog entry', async () => {
    await mkdir(join(repo, 'catalog', 'skills'), { recursive: true });
    await writeFile(join(repo, 'catalog', 'skills', 'ok.yaml'), 'apiVersion: aitp.dev/v1alpha1\nkind: Skill\n', 'utf8');
    const res = await get('/api/v1/catalog/entry?path=catalog/skills/ok.yaml');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.raw).toContain('kind: Skill');
  });

  it('rejects junction escapes for catalog reads (SEC-002, gate 1)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'aitp-outside-'));
    try {
      await writeFile(join(outside, 'leak.yaml'), 'leak: true\n', 'utf8');
      await mkdir(join(repo, 'catalog'), { recursive: true });
      const junction = join(repo, 'catalog', 'link');
      // Windows junction via mklink /J; fall back to symlink.
      try {
        await execAsync('cmd', ['/c', 'mklink', '/J', junction, outside]);
      } catch {
        await symlink(outside, junction, 'junction').catch(() => undefined);
      }
      const res = await get('/api/v1/catalog/entry?path=catalog/link/leak.yaml');
      const text = await res.text();
      expect(text).not.toContain('leak: true');
      expect([400, 404]).toContain(res.status);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('scan flow (APP-002, SCAN-001..009)', () => {
  it('scans fixture repo and finds observations from both providers', async () => {
    await post('/api/v1/scans', {});
    let inventory: { observations: Array<{ kind: string }>; runId: string | null } | undefined;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      inventory = (await (await get('/api/v1/inventory')).json()) as never;
      if (inventory!.observations.length > 0) break;
    }
    expect(inventory!.observations.length).toBeGreaterThan(0);
    const kinds = new Set(inventory!.observations.map((o) => o.kind));
    expect(kinds.has('skill')).toBe(true);
    expect(kinds.has('rule-document')).toBe(true);
    expect(kinds.has('hook')).toBe(true);
  });

  it('scanning does not modify the repository (first-scan flow completion)', async () => {
    await post('/api/v1/scans', {});
    await new Promise((r) => setTimeout(r, 2500));
    const { stdout } = await execAsync('git', ['-C', repo, 'status', '--porcelain']);
    expect(stdout.trim()).toBe('');
  });

  it('cancel endpoint is available (FUN-003)', async () => {
    await post('/api/v1/scans', {});
    const res = await post('/api/v1/scans/none/cancel', {});
    // Unknown scan id → 409 NOT_CANCELLABLE (no scan running with that id).
    expect([409, 200]).toContain(res.status);
  });
});

describe('typed catalog drafts + ChangeSet (FUN-008, ADR-008)', () => {
  it('typed entry draft → preview diff → apply with token', async () => {
    const draftRes = await post('/api/v1/catalog/drafts', {
      reason: 'favorite skill',
      entries: [
        {
          kind: 'Skill',
          entry: {
            metadata: { id: 'favorite', displayName: 'Favorite', shortDescription: 'typed draft', tags: ['demo'] },
            spec: { source: { type: 'unknown' } },
            overlay: { notes: '' },
          },
        },
      ],
      fragments: [],
    });
    expect(draftRes.status).toBe(201);
    const draft = await draftRes.json();
    expect(draft.changes[0].unifiedDiff).toContain('+apiVersion');
    expect(draft.changes[0].repoRelativePath).toBe('catalog/skills/favorite.yaml');

    const noToken = await post(`/api/v1/changesets/${draft.changeSetId}/apply`, { applyToken: 'wrong-token' });
    expect(noToken.status).toBe(403);

    const applyRes = await post(`/api/v1/changesets/${draft.changeSetId}/apply`, { applyToken: draft.applyToken });
    expect(applyRes.status).toBe(200);
    const result = await applyRes.json();
    expect(result.applied).toContain('catalog/skills/favorite.yaml');
    // Server-side serialization: fixed YAML shape.
    const yaml = await (await import('node:fs/promises')).readFile(join(repo, 'catalog', 'skills', 'favorite.yaml'), 'utf8');
    expect(yaml).toContain('shortDescription: typed draft');
    expect(yaml).toContain('contentPolicy: metadata-only');
  });

  it('rule fragment draft via typed DTO (FUN-008)', async () => {
    const draftRes = await post('/api/v1/catalog/drafts', {
      reason: 'fragment',
      entries: [],
      fragments: [
        {
          id: 'git-rule',
          displayName: 'Git rule',
          targets: ['codex', 'claude-code'],
          categories: ['git'],
          source: { document: 'AGENTS.md', lines: '1-2' },
          body: 'Only push after explicit authorization.',
        },
      ],
    });
    expect(draftRes.status).toBe(201);
    const draft = await draftRes.json();
    await post(`/api/v1/changesets/${draft.changeSetId}/apply`, { applyToken: draft.applyToken });
    const md = await (await import('node:fs/promises')).readFile(join(repo, 'catalog', 'rule-fragments', 'git-rule.md'), 'utf8');
    expect(md).toContain('kind: RuleFragment');
    expect(md).toContain('claude-code');
  });

  it('rejects drafts targeting paths outside the write allowlist', async () => {
    const res = await post('/api/v1/catalog/drafts', {
      reason: 'x',
      entries: [{ kind: 'Skill', path: 'CLAUDE.md', entry: { metadata: { id: 'x', displayName: 'X' }, spec: {}, overlay: {} } }],
      fragments: [],
    });
    expect(res.status).toBe(400);
  });
});

describe('git summary + diff (GIT-003, M3-06, FUN-006)', () => {
  it('returns working tree changes as text', async () => {
    await writeFile(join(repo, 'new-note.txt'), 'x: 1\n', 'utf8');
    const res = await get('/api/v1/git/summary');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changedFiles.some((f: { path: string }) => f.path.includes('new-note.txt'))).toBe(true);
  });

  it('returns read-only diff limited to app-owned paths', async () => {
    await mkdir(join(repo, 'catalog'), { recursive: true });
    await writeFile(join(repo, 'catalog', 'new.yaml'), 'x: 1\n', 'utf8');
    await writeFile(join(repo, 'AGENTS.md'), 'modified\n', 'utf8');
    const res = await get('/api/v1/git/diff');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.diff).toContain('catalog/new.yaml');
    expect(body.diff).not.toContain('AGENTS.md');
  });
});

describe('privacy: restart recovery + retention (PRI-003/002)', () => {
  it('restores the last successful scan after restart', async () => {
    await post('/api/v1/scans', {});
    let observations = 0;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const inv = (await (await get('/api/v1/inventory')).json()) as { observations: unknown[] };
      if (inv.observations.length > 0) {
        observations = inv.observations.length;
        break;
      }
    }
    expect(observations).toBeGreaterThan(0);
    await started.close();
    const restarted = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter(), new CodexAdapter()] });
    try {
      const inv = (await (await fetch(`http://127.0.0.1:${restarted.port}/api/v1/inventory`, { headers: { 'x-aitp-session': restarted.sessionToken } })).json()) as { runId: string | null; observations: unknown[] };
      expect(inv.runId).not.toBeNull();
      expect(inv.observations.length).toBeGreaterThan(0);
    } finally {
      await restarted.close();
    }
    // Reopen a server for afterEach teardown consistency.
    started = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter(), new CodexAdapter()] });
  });

  it('clears history on explicit request (PRI-006)', async () => {
    const res = await fetch(`http://127.0.0.1:${started.port}/api/v1/history`, { method: 'DELETE', headers: { 'x-aitp-session': started.sessionToken } });
    expect(res.status).toBe(200);
    const inv = (await (await get('/api/v1/inventory')).json()) as { runId: string | null };
    expect(inv.runId).toBeNull();
  });
});

describe('error envelope (ARCHITECTURE §8)', () => {
  it('returns code/message/requestId on 404', async () => {
    const res = await get('/api/v1/changesets/cs-00000000');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
    expect(typeof body.requestId).toBe('string');
  });
});
