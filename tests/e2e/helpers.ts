/**
 * E2E helpers: each scenario runs a real Local Agent on a temp Git repo with
 * synthetic fixtures (isolated HOME). The agent serves the built panel dist
 * itself, so tests exercise the real loopback origin end to end.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(execFile);
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureSource = resolve(repoRoot, 'tests', 'fixtures');

export interface PanelInstance {
  baseURL: string;
  sessionToken: string;
  repo: string;
  stop: () => Promise<void>;
}

/**
 * Start a Local Agent against a fresh fixture repo with an isolated HOME so
 * only synthetic user-level assets are visible.
 */
export async function startPanel(prepare?: (repo: string) => Promise<void>): Promise<PanelInstance> {
  const repo = await mkdtemp(join(tmpdir(), 'aitp-e2e-'));
  await cp(join(fixtureSource, 'claude-repo'), repo, { recursive: true });
  await cp(join(fixtureSource, 'codex-repo'), repo, { recursive: true });
  // REL-101: per-instance fixture preparation keeps E2E deterministic on a
  // clean clone (e.g. creating an untracked .env that git never carries).
  if (prepare) await prepare(repo);
  await execAsync('git', ['init', '-q'], { cwd: repo });
  await execAsync('git', ['-C', repo, 'config', 'user.email', 'e2e@example.com']);
  await execAsync('git', ['-C', repo, 'config', 'user.name', 'E2E']);
  await execAsync('git', ['-C', repo, 'add', '-A']);
  await execAsync('git', ['-C', repo, 'commit', '-qm', 'init']);
  // App-owned local state stays out of the fixture repo's status (GIT-002)
  // without touching the worktree .gitignore.
  await (async () => { const w = await import('node:fs/promises'); try { await w.appendFile(join(repo, '.git', 'info', 'exclude'), '.aitp/' + String.fromCharCode(10)); } catch { /* ignore */ } })();

  const isolatedHome = await mkdtemp(join(tmpdir(), 'aitp-e2e-home-'));
  const agent = spawn(process.execPath, [join(repoRoot, 'apps', 'local-agent', 'dist', 'start.js')], {
    cwd: repo,
    env: { ...process.env, USERPROFILE: isolatedHome, HOME: isolatedHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const { port: agentPort, sessionToken } = await new Promise<{ port: number; sessionToken: string }>((resolvePromise, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('agent did not print startup URL in time')), 30_000);
    agent.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)\/#session=([0-9a-f]+)/.exec(buffer);
      if (m) {
        clearTimeout(timer);
        resolvePromise({ port: Number(m[1]), sessionToken: m[2]! });
      }
    });
    agent.stderr!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    agent.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`agent exited early (${code}): ${buffer.slice(0, 400)}`));
    });
  });

  return {
    baseURL: `http://127.0.0.1:${agentPort}`,
    sessionToken,
    repo,
    stop: async () => {
      agent.kill();
      await rm(repo, { recursive: true, force: true }).catch(() => undefined);
      await rm(isolatedHome, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export type AgentProcess = ChildProcess;
