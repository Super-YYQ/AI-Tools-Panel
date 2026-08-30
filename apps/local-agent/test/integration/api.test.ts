import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../src/main.js';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import { CodexAdapter } from '@aitp/adapter-codex';
import type { StartedServer } from '../../src/main.js';

const execAsync = promisify(execFile);
// APP-001..005 backend parts; M3 exit criteria; security gate 5.
let repo: string;
let started: StartedServer;
const fixture = resolve(__dirname, '../../../../tests/fixtures');

async function get(path: string, extra?: RequestInit): Promise<Response> {
  return fetch(`http://127.0.0.1:${started.port}${path}`, extra);
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
  await appendFile(join(repo, '.git', 'info', 'exclude'), '.aitp/' + String.fromCharCode(10), 'utf8').catch(() => undefined);
  started = await startServer({
    repoRoot: repo,
    adapters: [new ClaudeAdapter(), new CodexAdapter()],
  });
});

afterEach(async () => {
  await started?.close();
  await rm(repo, { recursive: true, force: true });
});

describe('health (APP-004)', () => {
  it('reports repo and provider availability without auth', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.repo).toBe('ok');
    expect(body.gitAvailable).toBe(true);
    expect(Object.keys(body.providers).sort()).toEqual(['claude-code', 'codex']);
  });
});

describe('session + origin (gate 5)', () => {
  it('rejects cross-origin writes', async () => {
    const res = await get('/api/v1/scans', { method: 'POST', headers: { origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ORIGIN_REJECTED');
  });

  it('rejects writes without session token', async () => {
    const res = await get('/api/v1/scans', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('allows GET without token but allows writes with token + same origin', async () => {
    const res = await get('/api/v1/scans', {
      method: 'POST',
      headers: { origin: `http://127.0.0.1:${started.port}`, 'x-aitp-session': started.sessionToken },
    });
    expect(res.status).toBe(202);
  });
});

describe('scan flow (APP-002, SCAN-001..009)', () => {
  it('scans fixture repo and finds observations from both providers', async () => {
    await get('/api/v1/scans', { method: 'POST', headers: { 'x-aitp-session': started.sessionToken } });
    let inventory: { observations: unknown[]; runId: string | null; diagnostics: unknown[] } | undefined;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      inventory = (await (await get('/api/v1/inventory')).json()) as never;
      if (inventory.observations.length > 0) break;
    }
    expect(inventory!.observations.length).toBeGreaterThan(0);
    const kinds = new Set(inventory!.observations.map((o: { kind: string }) => o.kind));
    expect(kinds.has('skill')).toBe(true);
    expect(kinds.has('rule-document')).toBe(true);
    expect(kinds.has('hook')).toBe(true);
  });

  it('scanning does not modify the repository (first-scan flow completion)', async () => {
    await get('/api/v1/scans', { method: 'POST', headers: { 'x-aitp-session': started.sessionToken } });
    await new Promise((r) => setTimeout(r, 2000));
    const { stdout } = await execAsync('git', ['-C', repo, 'status', '--porcelain']);
    expect(stdout.trim()).toBe('');
  });
});

describe('catalog drafts + ChangeSet (CAT-007, ADR-008)', () => {
  it('create draft → preview diff → apply with token', async () => {
    const draftRes = await get('/api/v1/catalog/drafts', {
      method: 'POST',
      headers: { 'x-aitp-session': started.sessionToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: 'favorite skill',
        changes: [{ repoRelativePath: 'catalog/skills/favorite.yaml', operation: 'create', content: 'apiVersion: aitp.dev/v1alpha1\nkind: Skill\n' }],
      }),
    });
    expect(draftRes.status).toBe(201);
    const draft = await draftRes.json();
    expect(draft.changes[0].unifiedDiff).toContain('+apiVersion');

    const noToken = await get(`/api/v1/changesets/${draft.changeSetId}/apply`, {
      method: 'POST',
      headers: { 'x-aitp-session': started.sessionToken, 'content-type': 'application/json' },
      body: JSON.stringify({ applyToken: 'wrong' }),
    });
    expect(noToken.status).toBe(403);

    const applyRes = await get(`/api/v1/changesets/${draft.changeSetId}/apply`, {
      method: 'POST',
      headers: { 'x-aitp-session': started.sessionToken, 'content-type': 'application/json' },
      body: JSON.stringify({ applyToken: draft.applyToken }),
    });
    expect(applyRes.status).toBe(200);
    const result = await applyRes.json();
    expect(result.applied).toContain('catalog/skills/favorite.yaml');
  });

  it('rejects drafts outside the write allowlist', async () => {
    const res = await get('/api/v1/catalog/drafts', {
      method: 'POST',
      headers: { 'x-aitp-session': started.sessionToken, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'x', changes: [{ repoRelativePath: 'CLAUDE.md', operation: 'update', content: 'hostile' }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('git summary (GIT-003, M3-06)', () => {
  it('returns working tree changes as text', async () => {
    await writeFile(join(repo, 'new-note.txt'), 'x: 1\n', 'utf8');
    const res = await get('/api/v1/git/summary', { headers: { 'x-aitp-session': started.sessionToken } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changedFiles.some((f: { path: string }) => f.path.includes('new-note.txt'))).toBe(true);
  });
});

describe('error envelope (ARCHITECTURE §8)', () => {
  it('returns code/message/requestId on 404', async () => {
    const res = await get('/api/v1/changesets/nope');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
    expect(typeof body.requestId).toBe('string');
  });
});
