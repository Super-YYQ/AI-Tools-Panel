/**
 * @aitp/local-agent — loopback-only local HTTP API (ARCHITECTURE §8,
 * SECURITY_AND_GIT §6). v0.1.1 hardening (audit 2026-08-30):
 *  - SEC-001/002: every repo file read/write goes through SafePath resolvers
 *    (lexical + allowlist + realpath/junction containment).
 *  - SEC-003/004: all /api/v1/** requires a session; /health stays anonymous.
 *    Strict Host (loopback only), Origin check on writes, session idle TTL,
 *    rate limit, security headers/CSP. Session token is never in the query.
 *  - SEC-006: route inputs validated with Zod at runtime.
 *  - PRI-003: last successful scan restored on startup.
 *  - FUN-003: scan cancellation with terminal event.
 *  - FUN-006: read-only git diff endpoint (app-owned paths only).
 *  - FUN-008: typed catalog draft DTOs; the server is the only YAML serializer.
 *  - ARCH-003/004: in-memory structure TTLs + minimal structured local log.
 * No install/execution/push endpoints (ADR-007/010).
 */
import { resolve, join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { stat as statCb, rename as renameCb, unlink as unlinkCb } from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import type {
  CatalogEntryValue,
  ChangeSetValue,
  InventoryStore,
  ObservationValue,
  ProviderAdapter,
} from '@aitp/contracts';
import { API_VERSION } from '@aitp/contracts';
import { ScanOrchestrator } from './scan.js';
import { MemoryInventoryStore } from './store.js';
import { SqliteInventoryStore, defaultDbPath } from './store-sqlite.js';
import { buildChangeSet, applyChangeSet, FileSystemCatalogStore, readSourcesLock, serializeCatalogEntry, serializeRuleFragment } from '@aitp/catalog';
import { reconcile } from '@aitp/reconcile';
import { checkVendoring, resolveSafeReadPath } from '@aitp/security';

const execFileAsync = promisify(execFile);
const statAsync = promisify(statCb);
const renameAsync = promisify(renameCb);
const unlinkAsync = promisify(unlinkCb);

export interface ServerOptions {
  repoRoot: string;
  host?: string;
  port?: number;
  adapters: ProviderAdapter[];
  store?: InventoryStore;
  /** Session idle TTL in ms (SEC-004). Default 30 minutes. */
  sessionTtlMs?: number;
}

export interface StartedServer {
  server: FastifyInstance;
  port: number;
  sessionToken: string;
  close: () => Promise<void>;
}

const DEFAULT_LIMITS = { maxFileBytes: 512 * 1024, maxFiles: 5000, maxDepth: 8 };
const RATE_LIMIT = { windowMs: 60_000, max: 600 };
const MAX_DIFF_BYTES = 256 * 1024;

// --- Runtime route schemas (SEC-006) ---
const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/);
const CatalogEntryInput = z.object({
  kind: z.enum(['Skill', 'Plugin', 'Marketplace', 'Hook']),
  path: z
    .string()
    .regex(/^[a-z0-9][a-z0-9/._-]{0,120}$/)
    .optional(),
  entry: z.object({
    metadata: z.object({
      id: IdSchema,
      displayName: z.string().min(1).max(200),
      shortDescription: z.string().max(500).default(''),
      tags: z.array(z.string().regex(/^[a-z0-9-]{1,32}$/)).max(10).default([]),
    }),
    spec: z
      .object({
        targets: z.array(z.enum(['claude-code', 'codex'])).max(4).default([]),
        source: z
          .union([
            z.object({ type: z.literal('git'), url: z.string().url().max(300), revision: z.string().max(80).optional(), subdirectory: z.string().max(200).optional() }),
            z.object({ type: z.literal('marketplace'), marketplaceId: z.string().max(120), packageId: z.string().max(120), revision: z.string().max(80).optional() }),
            z.object({ type: z.literal('url'), url: z.string().url().max(300) }),
            z.object({ type: z.literal('local-authored'), repositoryRelativePath: z.string().max(200).optional() }),
            z.object({ type: z.literal('unknown') }),
          ])
          .default({ type: 'unknown' }),
      })
      .default({}),
    overlay: z.object({ notes: z.string().max(2000).default('') }).default({ notes: '' }),
  }),
});
const RuleFragmentInput = z.object({
  id: IdSchema,
  displayName: z.string().min(1).max(200),
  targets: z.array(z.enum(['claude-code', 'codex'])).max(4).default(['claude-code', 'codex']),
  categories: z.array(z.string().regex(/^[a-z-]{1,32}$/)).max(8).default([]),
  source: z.object({ document: z.string().max(200), lines: z.string().regex(/^\d+-\d+$/) }),
  body: z.string().min(1).max(64 * 1024),
});
const DraftsBody = z
  .object({
    reason: z.string().min(1).max(200),
    entries: z.array(CatalogEntryInput).max(10).default([]),
    fragments: z.array(RuleFragmentInput).max(10).default([]),
  })
  .refine((v) => v.entries.length + v.fragments.length > 0, { message: 'at least one entry or fragment required' });

const ALLOWED_BIND_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const repoRoot = resolve(options.repoRoot);
  // SEC-103: loopback binding is a hard invariant, not a default — a LAN or
  // wildcard host must fail startup instead of being silently overridden.
  if (options.host !== undefined && !ALLOWED_BIND_HOSTS.has(options.host)) {
    throw new Error(`BIND_HOST_REJECTED: refusing to bind ${options.host}; only 127.0.0.1, ::1 and localhost are allowed`);
  }
  const store: InventoryStore = options.store ?? (await openDefaultStore(repoRoot));
  const catalogStore = new FileSystemCatalogStore(repoRoot);
  const sessionToken = randomBytes(24).toString('hex');
  const sessionTtlMs = options.sessionTtlMs ?? 30 * 60 * 1000;
  let lastRunId: string | undefined;
  const draftChangeSets = new Map<string, { cs: ChangeSetValue; applyToken: string; expiresAt: number }>();
  const scanIdToRunId = new Map<string, string>();
  interface ScanEventRecord { status: string; lines: string[]; subscribers: Set<(line: string) => void> }
  const scanEvents = new Map<string, ScanEventRecord>();
  const sessionsLastSeen = new Map<string, number>([[sessionToken, Date.now()]]);
  const rateBuckets = new Map<string, { windowStart: number; count: number }>();
  let serverClosed = false;
  let currentScan: { scanId: string; orchestrator: ScanOrchestrator } | undefined;
  const logPath = join(repoRoot, '.aitp', 'agent.log');

  // PRI-003: restore the last successful/partial scan so the UI shows the
  // persisted inventory immediately after a restart.
  try {
    const last = await store.getLastSuccessfulRun();
    if (last) lastRunId = last.runId;
  } catch {
    /* fresh store */
  }

  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  await server.register(cookie);

  // Panel dist (single loopback origin for CSRF/Origin checks).
  const agentDistDir = dirname(fileURLToPath(new URL('.', import.meta.url)));
  const panelDist = resolve(agentDistDir, '..', 'panel', 'dist');
  if (existsSync(panelDist)) {
    await server.register(fastifyStatic, { root: panelDist, prefix: '/', list: false });
    server.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url === '/health') {
        void reply.code(404).send(envelope('NOT_FOUND', 'not found', request));
        return;
      }
      void reply.sendFile('index.html');
    });
  }

  function envelope(code: string, message: string, request: FastifyRequest, details?: unknown, recovery?: string) {
    return { code, message, details, recovery, requestId: request.id };
  }

  // --- Structured, privacy-safe local log (ARCH-004). ---
  async function logEvent(event: string, fields: Record<string, string | number | boolean | undefined>): Promise<void> {
    try {
      await fs.mkdir(join(repoRoot, '.aitp'), { recursive: true });
      try {
        const st = await statAsync(logPath);
        if (st.size > 1024 * 1024) {
          await unlinkAsync(logPath + '.1').catch(() => undefined);
          await renameAsync(logPath, logPath + '.1').catch(() => undefined);
        }
      } catch {
        /* no file yet */
      }
      const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields }) + '\n';
      await fs.appendFile(logPath, line, 'utf8');
    } catch {
      /* logging must never break the request */
    }
  }

  // --- Session / Host / Origin / rate limit / headers (SEC-003/004). ---
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.url;

    // Strict loopback Host (DNS rebinding): parse with URL so bracketed IPv6
    // hosts like [::1]:12345 resolve to the bare hostname (SEC-104).
    const hostHeader = (request.headers.host ?? '').toLowerCase();
    let hostname = '';
    try {
      hostname = new URL(`http://${hostHeader}`).hostname;
    } catch {
      hostname = hostHeader;
    }
    if (!['127.0.0.1', '::1', '[::1]', 'localhost'].includes(hostname)) {
      await reply.code(403).send(envelope('HOST_REJECTED', 'host header is not loopback', request));
      return reply;
    }

    // Fixed-window rate limit per remote address.
    const now = Date.now();
    const bucket = rateBuckets.get(request.ip);
    if (!bucket || now - bucket.windowStart > RATE_LIMIT.windowMs) {
      rateBuckets.set(request.ip, { windowStart: now, count: 1 });
    } else {
      bucket.count++;
      if (bucket.count > RATE_LIMIT.max) {
        await reply.code(429).send(envelope('RATE_LIMITED', 'too many requests', request));
        return reply;
      }
    }

    if (url === '/health') return;

    const isWrite = !['GET', 'HEAD'].includes(request.method);
    if (isWrite) {
      const origin = request.headers.origin;
      if (origin) {
        try {
          const o = new URL(origin);
          if (o.host !== request.headers.host) {
            await reply.code(403).send(envelope('ORIGIN_REJECTED', 'cross-origin write requests are rejected', request));
            return reply;
          }
        } catch {
          await reply.code(403).send(envelope('ORIGIN_REJECTED', 'invalid origin', request));
          return reply;
        }
      }
    }

    // All /api/v1/** (GET included) and SSE require a session; token arrives
    // via header or cookie — never the URL query (SEC-003).
    if (url.startsWith('/api/v1/')) {
      const headerToken = request.headers['x-aitp-session'];
      const provided = typeof headerToken === 'string' ? headerToken : request.cookies['aitp-session'];
      const lastSeen = provided ? sessionsLastSeen.get(provided) : undefined;
      if (!provided || lastSeen === undefined) {
        await reply.code(401).send(envelope('UNAUTHORIZED', 'missing or invalid session token', request));
        return reply;
      }
      if (now - lastSeen > sessionTtlMs) {
        sessionsLastSeen.delete(provided);
        await reply.code(401).send(envelope('SESSION_EXPIRED', 'session expired after idle timeout', request, undefined, 'Reload the panel with a fresh launch URL.'));
        return reply;
      }
      sessionsLastSeen.set(provided, now);
    }
  });

  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    return payload;
  });

  server.addHook('onRequest', async (request) => {
    (request as unknown as { _t?: number })._t = Date.now();
  });
  server.addHook('onResponse', async (request, reply) => {
    const started = (request as unknown as { _t?: number })._t;
    void logEvent('http', {
      requestId: request.id,
      route: request.url.split('?')[0],
      method: request.method,
      status: reply.statusCode,
      durationMs: started ? Date.now() - started : undefined,
    });
  });

  // --- Health (APP-004; anonymous; no path/version detail). ---
  server.get('/health', async () => {
    const providers: Record<string, boolean> = {};
    for (const adapter of options.adapters) providers[adapter.id] = true;
    let gitAvailable = false;
    try {
      await execFileAsync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel']);
      gitAvailable = true;
    } catch {
      gitAvailable = false;
    }
    return { status: 'ok', repo: gitAvailable ? 'ok' : 'not-a-git-repository', gitAvailable, providers };
  });

  let scanBusy = false;
  const publish = (scanId: string, event: string, data: unknown) => {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const record = scanEvents.get(scanId);
    if (!record) return;
    if (event === 'done') record.status = 'done';
    record.lines.push(line);
    for (const sub of record.subscribers) sub(line);
  };

  // --- Scans (M3-03 + FUN-003 cancel + terminal event on crash). ---
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
      const orchestrator = new ScanOrchestrator({ adapters: options.adapters, context });
      currentScan = { scanId, orchestrator };
      try {
        const previousObservations = lastRunId ? await store.listObservations(lastRunId) : [];
        const result = await orchestrator.execute(previousObservations, (event) => publish(scanId, 'progress', event));
        if (!serverClosed) {
          await store.saveScanRun(result.run, result.observations, result.diagnostics);
          // FUN-101: cancelled/failed runs are stored for history but never
          // replace the delta baseline (SCANNING_SPEC §3 Persist and Delta).
          if (result.run.status === 'completed' || result.run.status === 'partial') {
            lastRunId = result.run.runId;
          }
          scanIdToRunId.set(scanId, result.run.runId);
        }
        publish(scanId, 'done', {
          runId: result.run.runId,
          status: result.run.status,
          counts: result.run.counts,
          diagnostics: result.run.diagnosticCounts,
        });
        void logEvent('scan', { runId: result.run.runId, status: result.run.status, total: result.run.counts.total });
      } catch {
        // FUN-003: a crashing scan must still reach a terminal state.
        publish(scanId, 'done', { status: 'failed', error: 'scan failed' });
        void logEvent('scan', { scanId, status: 'failed' });
      } finally {
        scanBusy = false;
        currentScan = undefined;
      }
    })();
    await reply.code(202).send({ scanId, status: 'pending' });
    return reply;
  });

  server.post('/api/v1/scans/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (currentScan?.scanId === id) {
      currentScan.orchestrator.cancel();
      return { ok: true, status: 'cancelling' };
    }
    await reply.code(409).send(envelope('NOT_CANCELLABLE', 'scan is not running', request));
    return reply;
  });

  server.get('/api/v1/scans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await store.getScanRun(scanIdToRunId.get(id) ?? id);
    if (!run) {
      await reply.code(404).send(envelope('NOT_FOUND', 'scan run not found', request));
      return reply;
    }
    return run;
  });

  // SSE progress stream; session required; no query tokens.
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
    if (!/^[a-z0-9-]{1,120}$/.test(id)) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'invalid artifact id', request));
      return reply;
    }
    const runId = (request.query as { runId?: string }).runId ?? lastRunId;
    const observations: ObservationValue[] = runId ? await store.listObservations(runId) : [];
    const matches = observations.filter((o) => o.artifactId === id);
    if (matches.length === 0) {
      await reply.code(404).send(envelope('NOT_FOUND', 'artifact not found', request));
      return reply;
    }
    return { artifactId: id, observations: matches };
  });

  // --- Catalog reads: SafePath enforced (SEC-001). ---
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
    const safe = await resolveSafeReadPath(repoRoot, path, {
      prefixes: ['catalog/'],
      extensions: ['.yaml', '.yml', '.md'],
      mode: 'file',
    });
    if (!safe.ok) {
      const notFound = safe.code === 'NOT_FOUND';
      await reply.code(notFound ? 404 : 400).send(envelope(notFound ? 'NOT_FOUND' : 'PATH_REJECTED', `catalog read rejected: ${safe.code}`, request));
      return reply;
    }
    const raw = await fs.readFile(safe.absolute, 'utf8');
    return { path, raw };
  });

  // --- Typed catalog drafts (FUN-008): server-side serialization only. ---
  server.post('/api/v1/catalog/drafts', async (request, reply) => {
    const parsedBody = DraftsBody.safeParse(request.body);
    if (!parsedBody.success) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'draft payload failed validation', request, parsedBody.error.issues));
      return reply;
    }
    const body = parsedBody.data;
    const changes: Array<{ repoRelativePath: string; operation: 'create' | 'update' | 'archive'; content: string }> = [];
    for (const item of body.entries) {
      const kindDir = `${item.kind.toLowerCase()}s`;
      const target = item.path ?? `catalog/${kindDir}/${item.entry.metadata.id}.yaml`;
      const entry: CatalogEntryValue = {
        apiVersion: API_VERSION,
        kind: item.kind,
        metadata: {
          id: item.entry.metadata.id,
          displayName: item.entry.metadata.displayName,
          shortDescription: item.entry.metadata.shortDescription,
          tags: [...new Set(item.entry.metadata.tags)].sort(),
          archived: false,
        },
        spec: {
          targets: [...new Set(item.entry.spec.targets)].sort() as CatalogEntryValue['spec']['targets'],
          ownership: 'unknown',
          source: item.entry.spec.source,
          license: { status: 'unknown' },
          installInstructions: {},
          contentPolicy: 'metadata-only',
          components: [],
        },
        overlay: {
          notes: item.entry.overlay.notes,
          fieldOrigins: { shortDescription: 'human' },
        },
        verification: {},
      };
      changes.push({ repoRelativePath: target, operation: 'create', content: serializeCatalogEntry(entry) });
    }
    for (const fragment of body.fragments) {
      const frontmatter = {
        apiVersion: API_VERSION,
        kind: 'RuleFragment',
        id: fragment.id,
        displayName: fragment.displayName,
        targets: [...new Set(fragment.targets)].sort(),
        categories: [...new Set(fragment.categories)].sort(),
        source: { document: fragment.source.document, lines: fragment.source.lines },
        fieldOrigins: { categories: 'human' },
      };
      changes.push({
        repoRelativePath: `catalog/rule-fragments/${fragment.id}.md`,
        operation: 'create',
        content: serializeRuleFragment(frontmatter, `\n${fragment.body.replace(/\r\n/g, '\n')}\n`),
      });
    }
    const withOld: Array<{ repoRelativePath: string; operation: 'create' | 'update' | 'archive'; content: string; oldContent?: string }> = [];
    for (const change of changes) {
      const old = await catalogStore.loadRaw(change.repoRelativePath);
      withOld.push({ ...change, ...(old !== undefined ? { oldContent: old } : {}) });
    }
    const { changeSet, errors } = buildChangeSet(repoRoot, body.reason, withOld);
    if (!changeSet) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'draft rejected', request, errors));
      return reply;
    }
    const applyToken = randomBytes(12).toString('hex');
    // ARCH-003: drafts expire after 30 minutes.
    draftChangeSets.set(changeSet.changeSetId, { cs: changeSet, applyToken, expiresAt: Date.now() + 30 * 60 * 1000 });
    await reply.code(201).send({
      changeSetId: changeSet.changeSetId,
      changes: changeSet.changes.map(({ content: _c, ...rest }) => rest),
      applyToken,
    });
    return reply;
  });

  function pruneDrafts(): void {
    const now = Date.now();
    for (const [id, d] of draftChangeSets) {
      if (d.expiresAt < now) draftChangeSets.delete(id);
    }
    // ARCH-003: terminal SSE buffers are pruned once the cache grows.
    if (scanEvents.size > 8) {
      for (const [id, record] of scanEvents) {
        if (record.status === 'done' && record.subscribers.size === 0) scanEvents.delete(id);
      }
    }
  }

  server.get('/api/v1/changesets/:id', async (request, reply) => {
    pruneDrafts();
    const { id } = request.params as { id: string };
    if (!/^cs-[0-9a-f]{8,64}$/.test(id)) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'invalid changeset id', request));
      return reply;
    }
    const entry = draftChangeSets.get(id);
    if (!entry) {
      await reply.code(404).send(envelope('NOT_FOUND', 'changeset not found or expired', request));
      return reply;
    }
    return {
      changeSetId: entry.cs.changeSetId,
      reason: entry.cs.reason,
      status: entry.cs.status,
      changes: entry.cs.changes.map(({ content: _c, ...rest }) => rest),
    };
  });

  server.post('/api/v1/changesets/:id/apply', async (request, reply) => {
    pruneDrafts();
    const { id } = request.params as { id: string };
    const parsed = z.object({ applyToken: z.string().min(8).max(64) }).safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'applyToken required', request));
      return reply;
    }
    const entry = draftChangeSets.get(id);
    if (!entry) {
      await reply.code(404).send(envelope('NOT_FOUND', 'changeset not found or expired', request));
      return reply;
    }
    if (parsed.data.applyToken !== entry.applyToken) {
      await reply.code(403).send(envelope('INVALID_TOKEN', 'apply token missing or invalid', request));
      return reply;
    }
    const result = await applyChangeSet(repoRoot, entry.cs);
    void logEvent('apply', { changeSetId: id, ok: result.ok, applied: result.applied.length });
    if (!result.ok) {
      await reply.code(409).send(envelope('APPLY_CONFLICT', 'changeset application failed', request, { conflicts: result.conflicts, recovered: result.recovered }));
      return reply;
    }
    draftChangeSets.delete(id);
    return { ok: true, applied: result.applied };
  });

  // --- Rules: redacted, line-indexed content of repo rule documents. ---
  server.get('/api/v1/rules', async () => {
    const observations = lastRunId ? await store.listObservations(lastRunId) : [];
    return { ruleDocuments: observations.filter((o) => o.kind === 'rule-document') };
  });

  server.get('/api/v1/rules/:observationId/content', async (request, reply) => {
    const { observationId } = request.params as { observationId: string };
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(observationId)) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'invalid observation id', request));
      return reply;
    }
    const observations = lastRunId ? await store.listObservations(lastRunId) : [];
    const obs = observations.find((o) => o.observationId === observationId);
    if (!obs || obs.kind !== 'rule-document' || obs.scope !== 'repo') {
      await reply.code(404).send(envelope('NOT_FOUND', 'rule document not found in current scan', request));
      return reply;
    }
    const safe = await resolveSafeReadPath(repoRoot, obs.location.pathToken, { extensions: ['.md'], mode: 'file' });
    if (!safe.ok) {
      await reply.code(400).send(envelope('PATH_REJECTED', `rule read rejected: ${safe.code}`, request));
      return reply;
    }
    try {
      const text = await fs.readFile(safe.absolute, 'utf8');
      const lines = text.split('\n').map((line, idx) => ({ n: idx + 1, text: line }));
      return { observationId, lines };
    } catch (e) {
      await reply.code(503).send(envelope('READ_FAILED', 'rule file unreadable', request, String(e)));
      return reply;
    }
  });

  // --- Vendoring preview (metadata-only remains the default; FUN-009). ---
  server.post('/api/v1/vendoring/preview', async (request, reply) => {
    const parsed = z.object({ pathToken: z.string().min(1).max(200) }).safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send(envelope('INVALID_REQUEST', 'pathToken required', request));
      return reply;
    }
    const safe = await resolveSafeReadPath(repoRoot, parsed.data.pathToken, { mode: 'directory' });
    if (!safe.ok) {
      await reply.code(400).send(envelope('PATH_REJECTED', `vendoring preview rejected: ${safe.code}`, request));
      return reply;
    }
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
    await walk(safe.absolute, parsed.data.pathToken.replace(/\/$/, ''), 0);
    const gate = checkVendoring(files);
    return { defaultPolicy: 'metadata-only', gate };
  });

  server.get('/api/v1/sources.lock', async () => readSourcesLock(repoRoot));

  // --- Git summary + read-only app-owned diff (FUN-006, GIT-003). ---
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

  server.get('/api/v1/git/diff', async (_request, reply) => {
    try {
      // FUN-006: read-only diff restricted to app-owned paths. Untracked files
      // need a synthetic diff (git diff ignores them); no git state is mutated.
      const appOwned = (p: string): boolean => p === 'sources.lock.yaml' || p.startsWith('catalog/') || p.startsWith('snapshots/');
      const { stdout: status } = await execFileAsync('git', ['-C', repoRoot, 'status', '--porcelain', '-uall']);
      const changed = status
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ st: line.slice(0, 2), path: line.slice(3).trim() }))
        .filter((f) => appOwned(f.path));
      let diff = '';
      let truncated = false;
      for (const f of changed) {
        if (f.st.trim() === '??') {
          diff += `--- /dev/null
+++ b/${f.path}
`;
          const content = await fs.readFile(join(repoRoot, f.path), 'utf8').catch(() => '');
          diff += content.split('\n').map((l) => `+${l}`).join('\n') + '\n'
        } else {
          const { stdout } = await execFileAsync('git', ['-C', repoRoot, 'diff', 'HEAD', '--', f.path]);
          diff += stdout;
        }
        if (diff.length > MAX_DIFF_BYTES) {
          truncated = true;
          diff = diff.slice(0, MAX_DIFF_BYTES);
          break;
        }
      }
      return { diff, truncated };
    } catch (e) {
      await reply.code(503).send(envelope('GIT_UNAVAILABLE', 'git diff failed', _request, String(e)));
      return reply;
    }
  });

  // --- Privacy controls (PRI-002/006): retention + explicit cleanup. ---
  server.delete('/api/v1/history', async () => {
    if (store instanceof SqliteInventoryStore) store.clearHistory();
    if (store instanceof MemoryInventoryStore) store.clearHistory();
    lastRunId = undefined;
    return { ok: true };
  });

  server.delete('/api/v1/proposals', async () => {
    if (store instanceof SqliteInventoryStore) store.clearProposals();
    if (store instanceof MemoryInventoryStore) store.clearProposals();
    return { ok: true };
  });

  server.get('/api/v1/privacy', async () => {
    const runs = await store.listRuns();
    return {
      dbPathToken: '<app-owned>/.aitp/inventory.db',
      retainedRuns: runs.length,
      aiEnabled: false,
    };
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
      if (store instanceof SqliteInventoryStore) store.close();
    },
  };
}

async function openDefaultStore(repoRoot: string): Promise<InventoryStore> {
  // ADR-011: SQLite is the production store; fall back to in-memory if the
  // native binding is unavailable so the panel still starts (APP-004).
  try {
    return new SqliteInventoryStore(defaultDbPath(repoRoot));
  } catch {
    return new MemoryInventoryStore();
  }
}

export async function createDefaultAdapters(): Promise<ProviderAdapter[]> {
  const [{ ClaudeAdapter }, { CodexAdapter }] = await Promise.all([
    import('@aitp/adapter-claude'),
    import('@aitp/adapter-codex'),
  ]);
  return [new ClaudeAdapter(), new CodexAdapter()];
}
