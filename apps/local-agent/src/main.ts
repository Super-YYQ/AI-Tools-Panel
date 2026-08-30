/**
 * @aitp/local-agent — loopback-only local HTTP API (ARCHITECTURE §8,
 * SECURITY_AND_GIT §6). No install/execution/push endpoints (ADR-007/010).
 */
import { resolve, join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type {
  CatalogEntryValue,
  InventoryStore,
  ChangeSetValue,
  ObservationValue,
  ProviderAdapter,
} from '@aitp/contracts';
import { ScanOrchestrator } from './scan.js';
import { MemoryInventoryStore } from './store.js';
import { SqliteInventoryStore, defaultDbPath } from './store-sqlite.js';
import { buildChangeSet, applyChangeSet, FileSystemCatalogStore, readSourcesLock, sha256Hex } from '@aitp/catalog';
import { reconcile } from '@aitp/reconcile';
import { toPathToken, checkRepoRelativePath, checkVendoring, redactText } from '@aitp/security';

const execFileAsync = promisify(execFile);

export interface ServerOptions {
  repoRoot: string;
  host?: string;
  port?: number;
  adapters: ProviderAdapter[];
  store?: InventoryStore;
}

export interface StartedServer {
  server: FastifyInstance;
  port: number;
  sessionToken: string;
  close: () => Promise<void>;
}

const DEFAULT_LIMITS = { maxFileBytes: 512 * 1024, maxFiles: 5000, maxDepth: 8 };

export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const repoRoot = resolve(options.repoRoot);
  let store: InventoryStore;
  if (options.store) {
    store = options.store;
  } else {
    // ADR-011: SQLite is the production store; fall back to in-memory if the
    // native binding is unavailable so the panel still starts (APP-004).
    try {
      store = new SqliteInventoryStore(defaultDbPath(repoRoot));
    } catch {
      store = new MemoryInventoryStore();
    }
  }
  const catalogStore = new FileSystemCatalogStore(repoRoot);
  const sessionToken = randomBytes(24).toString('hex');
  let lastRunId: string | undefined;
  const draftChangeSets = new Map<string, ChangeSetValue>();
  interface ScanEventRecord { status: string; lines: string[]; subscribers: Set<(line: string) => void> }
  const scanEvents = new Map<string, ScanEventRecord>();
  // POST /scans returns a scanId; the persisted ScanRun has its own runId.
  const scanIdToRunId = new Map<string, string>();
  let serverClosed = false;
  const publish = (scanId: string, event: string, data: unknown) => {
    const line = `event: ${event}
data: ${JSON.stringify(data)}

`;
    const record = scanEvents.get(scanId);
    if (!record) return;
    if (event === 'done') record.status = 'done';
    record.lines.push(line);
    for (const sub of record.subscribers) sub(line);
  };

  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await server.register(cookie);

  // Serve the built panel when available (single loopback origin; CSRF/Origin
  // checks then compare against the agent's own host). Never expose directory
  // listings; SPA fallback keeps deep links working.
  // Panel dist is located relative to this module (apps/local-agent/dist -> apps/panel/dist).
  const agentDistDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
  const panelDist = resolve(agentDistDir, '..', 'panel', 'dist');
  const fsPanel = await import('node:fs');
  if (fsPanel.default.existsSync(panelDist)) {
    await server.register(fastifyStatic, { root: panelDist, prefix: '/', list: false });
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url === '/health') {
        void reply.code(404).send(envelope('NOT_FOUND', 'not found', request));
        return;
      }
      void reply.sendFile('index.html');
    });
  }

  // --- Session + write-request Origin check (SECURITY_AND_GIT §6). ---
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;
    if (url === '/health' || url.startsWith('/api/v1/health')) return;
    const isWrite = !['GET', 'HEAD'].includes(request.method);
    // SSE streams also require a session (SECURITY_AND_GIT §6); EventSource
    // cannot set headers, so the one-shot session token may arrive via ?session=.
    if (url.includes('/events')) {
      const queryToken = new URL(url, `http://${request.headers.host ?? 'localhost'}`).searchParams.get('session');
      const provided = (typeof request.headers['x-aitp-session'] === 'string' ? request.headers['x-aitp-session'] : undefined)
        ?? request.cookies['aitp-session']
        ?? (typeof queryToken === 'string' ? queryToken : undefined);
      if (provided !== sessionToken) {
        await reply.code(401).send(envelope('UNAUTHORIZED', 'missing or invalid session token', request));
        return reply;
      }
      return;
    }
    if (isWrite) {
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (origin) {
        try {
          const o = new URL(origin);
          if (o.host !== host) {
            await reply.code(403).send(envelope('ORIGIN_REJECTED', 'cross-origin write requests are rejected', request));
            return reply;
          }
        } catch {
          await reply.code(403).send(envelope('ORIGIN_REJECTED', 'invalid origin', request));
          return reply;
        }
      }
      const token = request.cookies['aitp-session'];
      const headerToken = request.headers['x-aitp-session'];
      const provided = typeof headerToken === 'string' ? headerToken : token;
      if (provided !== sessionToken) {
        await reply.code(401).send(envelope('UNAUTHORIZED', 'missing or invalid session token', request));
        return reply;
      }
    }
  });

  const envelope = (code: string, message: string, request: FastifyRequest, details?: unknown, recovery?: string) => ({
    code,
    message,
    details,
    recovery,
    requestId: request.id,
  });

  // --- Health (APP-004; no path/version detail exposure). ---
  server.get('/health', async () => {
    const providers: Record<string, boolean> = {};
    for (const adapter of options.adapters) providers[adapter.id] = true;
    let gitAvailable = false;
    let gitRootOk = false;
    try {
      await execFileAsync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel']);
      gitAvailable = true;
      gitRootOk = true;
    } catch {
      gitAvailable = false;
    }
    return { status: 'ok', repo: gitRootOk ? 'ok' : 'not-a-git-repository', gitAvailable, providers };
  });

  // --- Scans (M3-03). ---
  server.post('/api/v1/scans', async (_request, reply) => {
    if (scanBusy) {
      await reply.code(409).send(envelope('SCAN_BUSY', 'a scan is already running', _request));
      return reply;
    }
    const scanId = `scan-${Date.now().toString(36)}`;
    const context = {
      repoRoot,
      homeDir: process.env.USERPROFILE ?? process.env.HOME ?? '',
      cwd: repoRoot,
      limits: DEFAULT_LIMITS,
    };
    scanEvents.set(scanId, { status: 'running', lines: [], subscribers: new Set() });
    void (async () => {
      scanBusy = true;
      try {
        const previousObservations = lastRunId ? await store.listObservations(lastRunId) : [];
        const orchestrator = new ScanOrchestrator({ adapters: options.adapters, context });
        const result = await orchestrator.execute(previousObservations, (event) => publish(scanId, 'progress', event));
        if (!serverClosed) {
          await store.saveScanRun(result.run, result.observations, result.diagnostics);
          lastRunId = result.run.runId;
          scanIdToRunId.set(scanId, result.run.runId);
        }
        publish(scanId, 'done', {
          runId: result.run.runId,
          status: result.run.status,
          counts: result.run.counts,
          diagnostics: result.run.diagnosticCounts,
        });
      } catch {
        // Server closed mid-scan or store unavailable: drop the run rather
        // than producing an unhandled rejection during shutdown.
      } finally {
        scanBusy = false;
      }
    })();
    await reply.code(202).send({ scanId, status: 'pending' });
    return reply;
  });

  let scanBusy = false;

  server.get('/api/v1/scans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await store.getScanRun(scanIdToRunId.get(id) ?? id);
    if (!run) {
      await reply.code(404).send(envelope('NOT_FOUND', 'scan run not found', request));
      return reply;
    }
    return run;
  });

  // SSE progress stream (ARCHITECTURE §8 GET /scans/:id/events).
  server.get('/api/v1/scans/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = scanEvents.get(id);
    if (!record) {
      await reply.code(404).send(envelope('NOT_FOUND', 'scan not found', request));
      return reply;
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (line: string) => reply.raw.write(line);
    for (const line of record.lines) send(line);
    if (record.status === 'done') {
      reply.raw.end();
      return reply;
    }
    const sub = (line: string) => {
      send(line);
      if (line.startsWith('event: done')) reply.raw.end();
    };
    record.subscribers.add(sub);
    request.raw.on('close', () => {
      record.subscribers.delete(sub);
    });
    return reply;
  });

  server.get('/api/v1/inventory', async (request) => {
    const runId = (request.query as { runId?: string }).runId ?? lastRunId;
    const observations = runId ? await store.listObservations(runId) : [];
    const diagnostics = runId ? await store.listDiagnostics(runId) : [];
    const catalog = await catalogStore.listEntries();
    const result = reconcile(observations, catalog);
    return { runId: runId ?? null, observations, diagnostics, reconcile: result };
  });

  server.get('/api/v1/artifacts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const runId = (request.query as { runId?: string }).runId ?? lastRunId;
    const observations: ObservationValue[] = runId ? await store.listObservations(runId) : [];
    const matches = observations.filter((o) => o.artifactId === id);
    if (matches.length === 0) {
      await reply.code(404).send(envelope('NOT_FOUND', 'artifact not found', request));
      return reply;
    }
    return { artifactId: id, observations: matches };
  });

  // --- Catalog drafts + ChangeSets (M3-05, ADR-008). ---
  server.post('/api/v1/catalog/drafts', async (request, reply) => {
    const body = request.body as { reason?: string; changes?: Array<{ repoRelativePath: string; operation: 'create' | 'update' | 'archive'; content: string }> };
    if (!body.changes?.length) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'changes required', request));
      return reply;
    }
    const withOld: typeof body.changes = [];
    for (const change of body.changes) {
      const old = await catalogStore.loadRaw(change.repoRelativePath);
      withOld.push({ ...change, ...(old !== undefined ? { oldContent: old } : {}) });
    }
    const { changeSet, errors } = buildChangeSet(repoRoot, body.reason ?? 'catalog draft', withOld);
    if (!changeSet) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'draft rejected', request, errors));
      return reply;
    }
    const applyToken = randomBytes(12).toString('hex');
    const stored = { ...changeSet, applyToken };
    draftChangeSets.set(changeSet.changeSetId, stored);
    await reply.code(201).send({ changeSetId: changeSet.changeSetId, changes: changeSet.changes.map(({ content: _c, ...rest }) => rest), applyToken });
    return reply;
  });

  server.get('/api/v1/changesets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const cs = draftChangeSets.get(id);
    if (!cs) {
      await reply.code(404).send(envelope('NOT_FOUND', 'changeset not found', request));
      return reply;
    }
    return { changeSetId: cs.changeSetId, reason: cs.reason, status: cs.status, changes: cs.changes.map(({ content: _c2, ...rest }) => rest) };
  });

  server.post('/api/v1/changesets/:id/apply', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { applyToken?: string };
    const cs = draftChangeSets.get(id);
    if (!cs) {
      await reply.code(404).send(envelope('NOT_FOUND', 'changeset not found', request));
      return reply;
    }
    if (!body.applyToken || body.applyToken !== cs.applyToken) {
      await reply.code(403).send(envelope('INVALID_TOKEN', 'apply token missing or invalid', request));
      return reply;
    }
    const result = await applyChangeSet(repoRoot, cs);
    if (!result.ok) {
      await reply.code(409).send(envelope('APPLY_CONFLICT', 'changeset application failed', request, { conflicts: result.conflicts, recovered: result.recovered }));
      return reply;
    }
    draftChangeSets.delete(id);
    return { ok: true, applied: result.applied };
  });

  server.get('/api/v1/catalog', async () => {
    const entries = await catalogStore.listEntries();
    return { entries };
  });

  server.get('/api/v1/catalog/entry', async (request, reply) => {
    const { path } = request.query as { path?: string };
    if (!path) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'path query required', request));
      return reply;
    }
    const entry: CatalogEntryValue | undefined = await catalogStore.readEntry(path);
    if (!entry) {
      await reply.code(404).send(envelope('NOT_FOUND', 'entry not found', request));
      return reply;
    }
    return entry;
  });

  server.get('/api/v1/rules', async () => {
    const runId = lastRunId;
    const observations = runId ? await store.listObservations(runId) : [];
    return { ruleDocuments: observations.filter((o) => o.kind === 'rule-document') };
  });

  server.get('/api/v1/sources.lock', async () => readSourcesLock(repoRoot));

  // Redacted, line-indexed content of a repo-scope rule document (RULE-003/RULE-005).
  server.get('/api/v1/rules/:observationId/content', async (request, reply) => {
    const { observationId } = request.params as { observationId: string };
    const runId = (request.query as { runId?: string }).runId ?? lastRunId;
    const observations = runId ? await store.listObservations(runId) : [];
    const obs = observations.find((o) => o.observationId === observationId);
    if (!obs || obs.kind !== 'rule-document' || obs.scope !== 'repo') {
      await reply.code(404).send(envelope('NOT_FOUND', 'rule document not found in current scan', request));
      return reply;
    }
    const check = checkRepoRelativePath(repoRoot, obs.location.pathToken);
    if (!check.ok) {
      await reply.code(400).send(envelope('PATH_REJECTED', `path rejected: ${check.reason}`, request));
      return reply;
    }
    try {
      const text = await fs.readFile(join(repoRoot, obs.location.pathToken), 'utf8');
      const redacted = redactText(text).value;
      const lines = redacted.split('\n').map((line, idx) => ({ n: idx + 1, text: line }));
      return { observationId, lines };
    } catch (e) {
      await reply.code(503).send(envelope('READ_FAILED', 'rule file unreadable', request, String(e)));
      return reply;
    }
  });

  // Local skill import preview (CAT-005, E2E-04): metadata-only by default;
  // vendoring suggestion only lists files passing the gate.
  server.post('/api/v1/vendoring/preview', async (request, reply) => {
    const body = request.body as { pathToken?: string };
    if (!body.pathToken) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'pathToken required', request));
      return reply;
    }
    const check = checkRepoRelativePath(repoRoot, body.pathToken);
    if (!check.ok) {
      await reply.code(400).send(envelope('PATH_REJECTED', `path rejected: ${check.reason}`, request));
      return reply;
    }
    const dir = join(repoRoot, body.pathToken);
    const files: Array<{ path: string; content: string }> = [];
    const walk = async (d: string, rel: string, depth: number): Promise<void> => {
      if (depth > 4 || files.length >= 200) return;
      let entries;
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const full = join(d, e.name);
        if (e.isDirectory()) await walk(full, childRel, depth + 1);
        else if (e.isFile()) {
          try {
            const stat = await fs.stat(full);
            if (stat.size > 256 * 1024) {
              files.push({ path: childRel, content: '' });
              continue;
            }
            files.push({ path: childRel, content: await fs.readFile(full, 'utf8') });
          } catch {
            files.push({ path: childRel, content: '' });
          }
        }
      }
    };
    const targetDir = body.pathToken.endsWith('.md') ? dirname(join(repoRoot, body.pathToken)) : dir;
    const relBase = body.pathToken.endsWith('.md')
      ? body.pathToken.split('/').slice(0, -1).join('/')
      : body.pathToken;
    await walk(targetDir, relBase, 0);
    const gate = checkVendoring(files);
    return { defaultPolicy: 'metadata-only', gate };
  });

  // --- Git summary, read-only native git (M3-06, GIT-003). ---
  server.get('/api/v1/git/summary', async (_request, reply) => {
    try {
      const { stdout: status } = await execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain']);
      const { stdout: branch } = await execFileAsync('git', ['-C', repoRoot, 'branch', '--show-current']);
      const files = status.split('\n').filter(Boolean).map((line) => ({
        status: line.slice(0, 2),
        path: line.slice(3).trim(),
      }));
      return { branch: branch.trim(), changedFiles: files };
    } catch (e) {
      await reply.code(503).send(envelope('GIT_UNAVAILABLE', 'git is not available or not a repository', _request, String(e)));
      return reply;
    }
  });

  const listenPort = options.port ?? 0;
  const host = options.host ?? '127.0.0.1';
  await server.listen({ port: listenPort, host });
  const address = server.server.address();
  const port = typeof address === 'object' && address ? address.port : listenPort;

  return {
    server,
    port,
    sessionToken,
    close: async () => {
      serverClosed = true;
      await server.close();
      // Release the app-owned SQLite handle so Windows can clean temp dirs.
      if (store instanceof SqliteInventoryStore) store.close();
    },
  };
}

export function defaultAdapters(): ProviderAdapter[] {
  // Imported lazily to keep startup light in tests that pass custom adapters.
  throw new Error('use createDefaultAdapters() from createDefaultAdapters module');
}

export async function createDefaultAdapters(): Promise<ProviderAdapter[]> {
  const [{ ClaudeAdapter }, { CodexAdapter }] = await Promise.all([
    import('@aitp/adapter-claude'),
    import('@aitp/adapter-codex'),
  ]);
  return [new ClaudeAdapter(), new CodexAdapter()];
}

export function panelDistPath(): string {
  return join(repoRootOf(import.meta.url), '../../panel/dist');
}

function repoRootOf(url: string): string {
  return resolve(new URL('.', url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
}

export { sha256Hex, toPathToken };
