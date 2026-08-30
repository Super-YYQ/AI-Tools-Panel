import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../src/main.js';
import { MemoryInventoryStore } from '../../src/store.js';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import { CodexAdapter } from '@aitp/adapter-codex';
import { buildPayload } from '@aitp/enrichment';
import type { StartedServer } from '../../src/main.js';
import type { Candidate, DetectionResult, ParseResult, ProviderAdapter, ScanContext } from '@aitp/contracts';

const execAsync = promisify(execFile);
// Phase 1 test list (rule symlink, vendoring junction), Phase 2 acceptance
// (secret absence in DB/HTTP/log/Catalog/AI payload) and Phase 3 terminal
// states (cancel → cancelled, provider exception → partial/failed).
let repo: string;
let started: StartedServer;
const fixture = resolve(__dirname, '../../../../tests/fixtures');

/** Fake secret used across this suite; example secrets in test code are test data. */
const MARKER = 'ghp_exampletokenvalue0000000000';

async function get(path: string, token?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${started.port}${path}`, { headers: token ? { 'x-aitp-session': token } : {} });
}

/** Bind the generic get/post helpers to a specific server instance. */
function bindTo(server: StartedServer): {
  get: (path: string) => Promise<Response>;
  post: (path: string, body: unknown) => Promise<Response>;
} {
  return {
    get: (path) => fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { 'x-aitp-session': server.sessionToken } }),
    post: (path, body) =>
      fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-aitp-session': server.sessionToken },
        body: JSON.stringify(body),
      }),
  };
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${started.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-aitp-session': token } : {}) },
    body: JSON.stringify(body),
  });
}

async function scanAndWait(): Promise<void> {
  await post('/api/v1/scans', {}, started.sessionToken);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const inv = (await (await get('/api/v1/inventory', started.sessionToken)).json()) as { observations: unknown[] };
    if (inv.observations.length > 0) return;
  }
  throw new Error('scan did not produce observations');
}

function readSSE(scanId: string): Promise<{ done: unknown }> {
  return new Promise((resolvePromise, reject) => {
    fetch(`http://127.0.0.1:${started.port}/api/v1/scans/${scanId}/events`, {
      headers: { 'x-aitp-session': started.sessionToken },
    }).then((res) => {
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const tick = (): void => {
        reader!.read().then(({ done, value }) => {
          if (done) {
            resolvePromise({ done: null });
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          if (buffer.includes('event: done')) {
            const idx = buffer.indexOf('event: done');
            const tail = buffer.slice(idx);
            const dataLine = tail.split('\n').find((l) => l.startsWith('data: '));
            resolvePromise({ done: dataLine ? JSON.parse(dataLine.slice(6)) : null });
            void reader!.cancel();
            return;
          }
          tick();
        }, reject);
      };
      tick();
    }, reject);
  });
}

interface ScenarioAdapterOptions { failDiscover?: boolean; slowParseMs?: number; candidateCount?: number }

/** Minimal fake adapter for terminal-state tests. */
function fakeAdapter(options: ScenarioAdapterOptions = {}): ProviderAdapter {
  const self: ProviderAdapter = {
    id: 'claude-code',
    version: 'fake',
    async detect(): Promise<DetectionResult> {
      return { provider: 'claude-code', installed: true };
    },
    async *discover(context: ScanContext): AsyncIterable<Candidate> {
      if (options.failDiscover) throw new Error('discovery exploded');
      const count = options.candidateCount ?? 3;
      for (let i = 0; i < count; i++) {
        yield { provider: 'claude-code', kind: 'skill', scope: 'repo', name: `fake-${i}`, absolutePath: join(context.repoRoot, `fake-${i}`), copyRole: 'source' };
      }
    },
    async parse(candidate: Candidate): Promise<ParseResult> {
      if (options.slowParseMs) await new Promise((r) => setTimeout(r, options.slowParseMs));
      return {
        observations: [
          {
            observationId: `obs-${candidate.name}`,
            artifactId: `skill-${candidate.name}`,
            provider: 'claude-code',
            kind: 'skill',
            scope: 'repo',
            canonicalName: candidate.name,
            sourceIdentity: { type: 'unknown' },
            location: { pathToken: candidate.name, scope: 'repo' },
            copyRole: 'source',
            enabled: 'unknown',
            contentHash: `h-${candidate.name}`,
            summary: {},
            sourceEvidence: [],
            related: [],
            discoveredAt: 't',
            parser: { name: 'fake', version: '1' },
          },
        ],
        diagnostics: [],
      };
    },
  };
  return self;
}

describe('boundary + terminal-state suite', () => {
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'aitp-bnd-'));
    await cp(join(fixture, 'claude-repo'), repo, { recursive: true });
    await cp(join(fixture, 'codex-repo'), repo, { recursive: true });
    await execAsync('git', ['init', '-q'], { cwd: repo });
    await execAsync('git', ['-C', repo, 'config', 'user.email', 't@t']);
    await execAsync('git', ['-C', repo, 'config', 'user.name', 'T']);
    await execAsync('git', ['-C', repo, 'add', '-A']);
    await execAsync('git', ['-C', repo, 'commit', '-qm', 'init']);
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(repo, '.git', 'info', 'exclude'), '.aitp/\n', 'utf8').catch(() => undefined);
    started = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter(), new CodexAdapter()] });
  });

  afterEach(async () => {
    await started?.close();
    await rm(repo, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('rule document swapped to a symlink is refused at read time (Phase 1: rule symlink)', async () => {
    await scanAndWait();
    const inv = (await (await get('/api/v1/inventory', started.sessionToken)).json()) as { observations: Array<{ observationId: string; canonicalName: string; kind: string }> };
    const rule = inv.observations.find((o) => o.kind === 'rule-document' && o.canonicalName === 'testing.md');
    expect(rule).toBeDefined();

    const outside = await mkdtemp(join(tmpdir(), 'aitp-out-rule-'));
    try {
      const secretBody = `Secret inside: ${MARKER}\n`;
      await writeFile(join(outside, 'leak.md'), secretBody, 'utf8');
      // Swap the rules directory for a junction escaping the repo — file
      // symlinks require elevated privileges on Windows, junctions do not.
      const rulesDir = join(repo, '.claude', 'rules');
      await rm(rulesDir, { recursive: true, force: true });
      let linked = false;
      try {
        await execAsync('cmd', ['/c', 'mklink', '/J', rulesDir, outside]);
        linked = true;
      } catch {
        await symlink(outside, rulesDir, 'junction').then(() => (linked = true)).catch(() => undefined);
      }
      if (!linked) {
        console.log('skip: junction creation unavailable');
        return;
      }

      const res = await get(`/api/v1/rules/${rule!.observationId}/content`, started.sessionToken);
      expect([400, 404]).toContain(res.status);
      expect(await res.text()).not.toContain(MARKER);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('vendoring preview through a junction escape is rejected (Phase 1: vendoring junction)', async () => {
    await scanAndWait();
    const outside = await mkdtemp(join(tmpdir(), 'aitp-out-vend-'));
    try {
      await writeFile(join(outside, 'secret-file.md'), `Secret inside: ${MARKER}\n`, 'utf8');
      // Replace the whole skill directory with a junction to outside.
      const skillDir = join(repo, '.claude', 'skills', 'notes');
      await rm(skillDir, { recursive: true, force: true });
      let linked = false;
      try {
        await execAsync('cmd', ['/c', 'mklink', '/J', skillDir, outside]);
        linked = true;
      } catch {
        await symlink(outside, skillDir, 'junction').then(() => (linked = true)).catch(() => undefined);
      }
      if (!linked) {
        console.log('skip: junction creation unavailable');
        return;
      }
      const res = await post('/api/v1/vendoring/preview', { pathToken: '.claude/skills/notes' }, started.sessionToken);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('PATH_REJECTED');
      expect(JSON.stringify(body)).not.toContain(MARKER);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('Phase 2 acceptance: fixture secrets never reach DB, HTTP, log or Catalog', async () => {
    // Seed secrets into every Phase 2 location before scanning.
    await writeFile(
      join(repo, '.claude', 'skills', 'deploy-helper', 'SKILL.md'),
      '---\nname: deploy-helper\ndescription: d.\ninternalToken: ' + MARKER + '\n---\nBody with ' + MARKER + '\n',
      'utf8',
    );
    await writeFile(
      join(repo, 'myplugin', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'repo-plugin', description: 'd', version: '0.3.0', apiKey: MARKER }),
      'utf8',
    );
    await writeFile(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'example-marketplace', ownerToken: MARKER, plugins: [{ name: 'a', source: './myplugin' }, { name: 'b', source: 'x' }] }),
      'utf8',
    );
    await writeFile(join(repo, '.claude', 'rules', 'testing.md'), 'Run tests. Token ' + MARKER + '\n', 'utf8');
    await writeFile(join(repo, '.claude', 'settings.json'), '{ hooks: ["x", "' + MARKER + '"', 'utf8'); // malformed + secret → diagnostic

    // Commit the seeded state so the post-scan status check still proves the
    // scan itself modified nothing.
    await execAsync('git', ['-C', repo, 'add', '-A']);
    await execAsync('git', ['-C', repo, 'commit', '-qm', 'seed-secrets']);

    await scanAndWait();
    const invRaw = await (await get('/api/v1/inventory', started.sessionToken)).text();
    expect(invRaw).not.toContain(MARKER);

    // SQLite bytes (PRI-001 persistence boundary incl. diagnostics).
    const db = await readFile(join(repo, '.aitp', 'inventory.db'), 'latin1');
    expect(db).not.toContain(MARKER);

    // Structured log (ARCH-004).
    const log = await readFile(join(repo, '.aitp', 'agent.log').replace('.log', '.log'), 'utf8').catch(() => '');
    expect(log).not.toContain(MARKER);

    // Catalog untouched by scanning; no secret written into Git files.
    const { stdout } = await execAsync('git', ['-C', repo, 'status', '--porcelain']);
    expect(stdout.trim()).toBe('');

    // AI payload (P1-PRI-05): derived from the same sanitized observations.
    const inv = JSON.parse(invRaw) as { observations: Array<never> };
    const { payload } = buildPayload(inv.observations, 'summary');
    expect(JSON.stringify(payload)).not.toContain(MARKER);
  });

  it('cancel during a running scan reaches the cancelled terminal state (FUN-003)', async () => {
    await started.close();
    started = await startServer({ repoRoot: repo, adapters: [fakeAdapter({ slowParseMs: 1200, candidateCount: 3 })] });

    const { scanId } = (await (await post('/api/v1/scans', {}, started.sessionToken)).json()) as { scanId: string };
    const donePromise = readSSE(scanId);
    await new Promise((r) => setTimeout(r, 800)); // let the scan start
    const cancelRes = await post(`/api/v1/scans/${scanId}/cancel`, {}, started.sessionToken);
    expect(cancelRes.status).toBe(200);

    const { done } = await donePromise;
    expect(done).toMatchObject({ status: 'cancelled' });
    // The persisted run reached the same terminal state (no running zombie).
    const run = (await (await get(`/api/v1/scans/${scanId}`, started.sessionToken)).json()) as { status: string };
    expect(run.status).toBe('cancelled');
  });

  it('provider discovery exception still publishes a terminal partial event (FUN-003)', async () => {
    await started.close();
    started = await startServer({ repoRoot: repo, adapters: [fakeAdapter({ failDiscover: true }), fakeAdapter({ candidateCount: 2 })] });

    const { scanId } = (await (await post('/api/v1/scans', {}, started.sessionToken)).json()) as { scanId: string };
    const { done } = await readSSE(scanId);
    expect(done).toMatchObject({ status: 'partial' });
    const run = (await (await get(`/api/v1/scans/${scanId}`, started.sessionToken)).json()) as { status: string; diagnosticCounts: Record<string, number> };
    expect(run.status).toBe('partial');
    expect(run.diagnosticCounts.PARTIAL_SCAN).toBeGreaterThan(0);
  });

  it('persistence failure publishes a terminal failed event, not a hang (FUN-003)', async () => {
    await started.close();
    class FailingStore extends MemoryInventoryStore {
      override async saveScanRun(): Promise<void> {
        throw new Error('disk on fire');
      }
    }
    started = await startServer({ repoRoot: repo, adapters: [fakeAdapter({ candidateCount: 1 })], store: new FailingStore() });

    const { scanId } = (await (await post('/api/v1/scans', {}, started.sessionToken)).json()) as { scanId: string };
    const { done } = await readSSE(scanId);
    expect(done).toMatchObject({ status: 'failed' });
  });
});

describe('reaudit additions (SEC-101/103/104, FUN-101)', () => {
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'aitp-bnd-'));
    await cp(join(fixture, 'claude-repo'), repo, { recursive: true });
    await cp(join(fixture, 'codex-repo'), repo, { recursive: true });
    await execAsync('git', ['init', '-q'], { cwd: repo });
    await execAsync('git', ['-C', repo, 'config', 'user.email', 't@t']);
    await execAsync('git', ['-C', repo, 'config', 'user.name', 'T']);
    await execAsync('git', ['-C', repo, 'add', '-A']);
    await execAsync('git', ['-C', repo, 'commit', '-qm', 'init']);
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(repo, '.git', 'info', 'exclude'), '.aitp\n', 'utf8').catch(() => undefined);
    started = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter(), new CodexAdapter()] });
  });

  afterEach(async () => {
    await started?.close();
    await rm(repo, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  });

  it('scanner does not follow a file symlink escaping the repo (SEC-101)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'aitp-out-s101-'));
    try {
      await writeFile(join(outside, 'private.md'), `Secret inside: ${MARKER}\n`, 'utf8');
      // Swap the scanned CLAUDE.md for a symlink to an outside file. File
      // symlinks need elevated privileges on Windows — skip when unavailable
      // (CI Windows runners exercise this path).
      const claudeMd = join(repo, 'CLAUDE.md');
      await rm(claudeMd, { force: true });
      try {
        await symlink(join(outside, 'private.md'), claudeMd, 'file');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log('skip: fixture file missing for symlink swap');
          return;
        }
        console.log('skip: file symlink privilege unavailable');
        return;
      }
      await post('/api/v1/scans', {}, started.sessionToken);
      let inv: { observations: Array<{ canonicalName: string }>; diagnostics: Array<{ code: string; target?: string }> } | undefined;
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 200));
        inv = (await (await get('/api/v1/inventory', started.sessionToken)).json()) as never;
        if (inv!.diagnostics.some((d) => d.code === 'SYMLINK_OUTSIDE_ROOT')) break;
      }
      expect(inv!.diagnostics.some((d) => d.code === 'SYMLINK_OUTSIDE_ROOT')).toBe(true);
      // The outside content was never ingested.
      expect(JSON.stringify(inv)).not.toContain('Secret inside');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('cancelled scan does not replace the delta baseline (FUN-101)', async () => {
    const { get: getOn, post: postOn } = bindTo(started);
    // Establish a completed baseline with the real adapters.
    await postOn('/api/v1/scans', {});
    let baselineRunId: string | null = null;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const inv = (await (await getOn('/api/v1/inventory')).json()) as { runId: string | null; observations: unknown[] };
      if (inv.observations.length > 0) {
        baselineRunId = inv.runId;
        break;
      }
    }
    expect(baselineRunId).not.toBeNull();

    // Restart with a slow fake adapter, start a scan and cancel it.
    await started.close();
    const slow = await startServer({ repoRoot: repo, adapters: [fakeAdapter({ slowParseMs: 1200, candidateCount: 3 })] });
    try {
      const { get: getSlow, post: postSlow } = bindTo(slow);
      const { scanId } = (await (await postSlow('/api/v1/scans', {})).json()) as { scanId: string };
      await new Promise((r) => setTimeout(r, 400));
      await postSlow(`/api/v1/scans/${scanId}/cancel`, {});
      await new Promise((r) => setTimeout(r, 2500));
      const inv = (await (await getSlow('/api/v1/inventory')).json()) as { runId: string | null };
      // The cancelled run is stored for history but the baseline is untouched:
      // it must still point at the persisted real baseline, never the
      // cancelled scan's run.
      expect(inv.runId).not.toBeNull();
      expect(inv.runId).not.toBe(scanId);
      const cancelledRun = (await (await getSlow(`/api/v1/scans/${scanId}`)).json()) as { status: string };
      expect(cancelledRun.status).toBe('cancelled');
    } finally {
      await slow.close();
    }
  });

  it('accepts bracketed IPv6 Host headers (SEC-104)', async () => {
    const { request: httpRequest } = await import('node:http');
    const res = await new Promise<{ status: number; body: string }>((resolvePromise) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: started.port, path: '/health', headers: { host: '[::1]:13099' } },
        (r: { statusCode: number; on: (e: string, cb: (c: Buffer) => void) => void }) => {
          let data = '';
          r.on('data', (c: Buffer) => (data += c.toString()));
          r.on('end', () => resolvePromise({ status: r.statusCode ?? 0, body: data }));
        },
      );
      req.on('error', (e: Error) => resolvePromise({ status: 0, body: String(e) }));
      req.setTimeout(3000, () => {
        req.destroy();
        resolvePromise({ status: 0, body: 'timeout' });
      });
      req.end();
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('HOST_REJECTED');
  });

  it('rejects non-loopback bind hosts at startup (SEC-103)', async () => {
    await expect(startServer({ repoRoot: repo, adapters: [new ClaudeAdapter()], host: '0.0.0.0' })).rejects.toThrow(/BIND_HOST_REJECTED/);
  });
});
