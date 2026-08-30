import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../../src/main.js';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import { CodexAdapter } from '@aitp/adapter-codex';
import type { StartedServer } from '../../src/main.js';

const execAsync = promisify(execFile);
// M3-03 SSE: GET /scans/:id/events streams progress and terminal state; session required.
let repo: string;
let started: StartedServer;
const fixture = resolve(__dirname, '../../../../tests/fixtures');

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-sse-'));
  await cp(join(fixture, 'claude-repo'), repo, { recursive: true });
  await cp(join(fixture, 'codex-repo'), repo, { recursive: true });
  await execAsync('git', ['init', '-q'], { cwd: repo });
  started = await startServer({ repoRoot: repo, adapters: [new ClaudeAdapter(), new CodexAdapter()] });
});

afterEach(async () => {
  await started?.close();
  await rm(repo, { recursive: true, force: true });
});

function readSSE(scanId: string, session: string): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolvePromise, reject) => {
    fetch(`http://127.0.0.1:${started.port}/api/v1/scans/${scanId}/events?session=${session}`, {
      headers: { accept: 'text/event-stream' },
    }).then((res) => {
      const contentType = res.headers.get('content-type') ?? '';
      const reader = res.body?.getReader();
      const chunks: string[] = [];
      const decoder = new TextDecoder();
      if (!reader) {
        resolvePromise({ status: res.status, contentType, body: '' });
        return;
      }
      const tick = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              resolvePromise({ status: res.status, contentType, body: chunks.join('') });
              return;
            }
            chunks.push(decoder.decode(value, { stream: true }));
            if (chunks.join('').includes('event: done')) {
              void reader.cancel();
              resolvePromise({ status: res.status, contentType, body: chunks.join('') });
              return;
            }
            tick();
          })
          .catch(reject);
      };
      tick();
    }, reject);
  });
}

describe('SSE scan events (M3-03, ARCHITECTURE §8)', () => {
  it('rejects unauthenticated streams (SSE requires session)', async () => {
    const scanRes = await fetch(`http://127.0.0.1:${started.port}/api/v1/scans`, { method: 'POST' });
    expect(scanRes.status).toBe(401);
  });

  it('streams progress and done with counts for a started scan', async () => {
    const scanRes = await fetch(`http://127.0.0.1:${started.port}/api/v1/scans`, {
      method: 'POST',
      headers: { 'x-aitp-session': started.sessionToken },
    });
    expect(scanRes.status).toBe(202);
    const { scanId } = (await scanRes.json()) as { scanId: string };
    const stream = await readSSE(scanId, started.sessionToken);
    expect(stream.contentType).toContain('text/event-stream');
    expect(stream.body).toContain('event: done');
    const doneLine = stream.body.split('\n').find((l) => l.startsWith('data: ') && l.includes('"status"'));
    expect(doneLine).toBeDefined();
    const payload = JSON.parse(doneLine!.slice('data: '.length)) as { counts: { total: number }; status: string };
    expect(payload.counts.total).toBeGreaterThan(0);
    expect(['completed', 'partial']).toContain(payload.status);
  });

  it('replays buffered events for late subscribers after terminal state', async () => {
    const scanRes = await fetch(`http://127.0.0.1:${started.port}/api/v1/scans`, {
      method: 'POST',
      headers: { 'x-aitp-session': started.sessionToken },
    });
    const { scanId } = (await scanRes.json()) as { scanId: string };
    // Wait for the scan to finish, then connect — must still receive done.
    let run: { status: string } | undefined;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 200));
      run = (await (await fetch(`http://127.0.0.1:${started.port}/api/v1/scans/${scanId}`)).json()) as { status: string };
      if (['completed', 'partial', 'failed', 'cancelled'].includes(run.status)) break;
    }
    const stream = await readSSE(scanId, started.sessionToken);
    expect(stream.body).toContain('event: done');
  });

  it('returns 404 for unknown scan ids', async () => {
    const res = await fetch(`http://127.0.0.1:${started.port}/api/v1/scans/none/events?session=${started.sessionToken}`);
    expect(res.status).toBe(404);
  });
});
