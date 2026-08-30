/**
 * @aitp/adapter-codex — Codex discovery/parsing (SCANNING_SPEC §6).
 * v0.1.1: summaries are whitelisted DTOs (PRI-02), structured sourceIdentity
 * (FUN-02) and a real filesystem AGENTS chain (FUN-01).
 */
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type {
  Candidate,
  DetectionResult,
  DiagnosticValue,
  ParseResult,
  ProviderAdapter,
  ScanContext,
  SourceIdentityValue,
} from '@aitp/contracts';
import {
  buildObservation,
  canonicalJsonHash,
  compareCodePoints,
  exists,
  parseFrontmatter,
  readScopedTextCapped,
  scopedReadDiagnosticCode,
  sha256Hex,
  walkBounded,
  ParseResultCache,
} from '@aitp/inventory-core';
import { relative } from 'node:path';
import { redactObject } from '@aitp/security';
import { buildAgentsChainFromFs, isLoadedInContext, chainDirs } from './agents-chain.js';

export const CODEX_ADAPTER_VERSION = '1.1.0';
export { chainDirs, buildAgentsChainFromFs, buildAgentsChainFromFs as buildAgentsChain };
export type { AgentsChain, AgentsChainEntry } from './agents-chain.js';

/** SEC-101: scope root for a candidate — repo files bound to repoRoot, user files to homeDir. */
function scopeRootFor(candidate: Candidate, context: ScanContext): { root: string; relPath: string } {
  const norm = candidate.absolutePath.split('\\').join('/');
  const repoNorm = context.repoRoot.split('\\').join('/');
  if (norm.toLowerCase().startsWith(repoNorm.toLowerCase())) {
    return { root: context.repoRoot, relPath: relative(context.repoRoot, candidate.absolutePath) };
  }
  return { root: context.homeDir, relPath: relative(context.homeDir, candidate.absolutePath) };
}

async function scopedRead(
  candidate: Candidate,
  context: ScanContext,
): Promise<{ ok: true; text: string } | { ok: false; code: 'SYMLINK_OUTSIDE_ROOT' | 'FILE_TOO_LARGE' | 'ACCESS_DENIED' | 'ROOT_NOT_FOUND' }> {
  const { root, relPath } = scopeRootFor(candidate, context);
  const result = await readScopedTextCapped({ root, path: relPath });
  if (result.ok) return { ok: true, text: result.content };
  return { ok: false, code: scopedReadDiagnosticCode(result.code) };
}


function identityFromSourceField(source: unknown): SourceIdentityValue | undefined {
  if (typeof source === 'string' && /^https:\/\//.test(source)) {
    return { type: 'git', canonicalUrl: source.replace(/\.git$/, '') };
  }
  return undefined;
}

export class CodexAdapter implements ProviderAdapter {
  id = 'codex' as const;
  version = CODEX_ADAPTER_VERSION;

  async detect(context: ScanContext): Promise<DetectionResult> {
    const configRoot = join(context.homeDir, '.agents');
    if (await exists(configRoot)) return { provider: this.id, installed: true, configRoot };
    // Repo-level AGENTS.md/.agents assets are scannable without user config.
    const repoAgents = await exists(join(context.repoRoot, 'AGENTS.md'));
    const repoAgentsDir = await exists(join(context.repoRoot, '.agents'));
    if (repoAgents || repoAgentsDir) {
      return { provider: this.id, installed: true, detail: 'user config missing; repo-level Codex assets found' };
    }
    return { provider: this.id, installed: false, detail: 'not-installed' };
  }

  async *discover(context: ScanContext): AsyncIterable<Candidate> {
    // Skills: user level + every directory from CWD to Git root (SCANNING_SPEC §6).
    for (const skillDir of await findSkillDirs(join(context.homeDir, '.agents', 'skills'), context)) {
      yield { provider: this.id, kind: 'skill', scope: 'user', name: skillDir.name, absolutePath: skillDir.path, copyRole: 'source' };
    }
    for (const dir of chainDirs(context.cwd, context.repoRoot)) {
      for (const skillDir of await findSkillDirs(join(dir, '.agents', 'skills'), context)) {
        yield { provider: this.id, kind: 'skill', scope: 'repo', name: skillDir.name, absolutePath: skillDir.path, copyRole: 'source' };
      }
      for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
        const p = join(dir, name);
        if (await exists(p)) {
          yield { provider: this.id, kind: 'rule-document', scope: 'repo', name, absolutePath: p, copyRole: 'source' };
        }
      }
    }
    // User-level AGENTS documents.
    const codexHome = join(context.homeDir, '.codex');
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      const p = join(codexHome, name);
      if (await exists(p)) {
        yield { provider: this.id, kind: 'rule-document', scope: 'user', name, absolutePath: p, copyRole: 'source' };
      }
    }
    // Hooks/config.
    for (const [p, scope] of [
      [join(codexHome, 'config.toml'), 'user'] as const,
      [join(context.repoRoot, '.codex', 'config.toml'), 'repo'] as const,
    ]) {
      if (await exists(p)) {
        yield { provider: this.id, kind: 'hook', scope, name: 'config.toml', absolutePath: p, copyRole: 'source' };
      }
    }
    // Plugins: .codex-plugin/plugin.json.
    for (const root of [context.repoRoot, codexHome]) {
      const { files } = await walkBounded(root, context, {
        maxDepth: Math.min(context.limits.maxDepth, 4),
        match: (_rel, name) => name === 'plugin.json' && _rel.includes('.codex-plugin/'),
      });
      for (const f of files) {
        const name = f.absolutePath.split(/[\\/]/).slice(-3)[0] ?? 'plugin';
        yield {
          provider: this.id,
          kind: 'plugin',
          scope: root === context.repoRoot ? 'repo' : 'user',
          name,
          absolutePath: f.absolutePath,
          copyRole: root === context.repoRoot ? 'declared' : 'cache',
        };
      }
    }
    // Catalog sources declared in repo.
    const src = await walkBounded(context.repoRoot, context, {
      maxDepth: Math.min(context.limits.maxDepth, 4),
      match: (_rel, name) => name === 'catalog-sources.json' || name === 'marketplace.json',
    });
    for (const f of src.files) {
      if (f.absolutePath.includes('.claude-plugin')) continue;
      yield { provider: this.id, kind: 'marketplace', scope: 'repo', name: f.relativeFrom, absolutePath: f.absolutePath, copyRole: 'declared' };
    }
  }

  private readonly parseCache = new ParseResultCache();

  /** SCANNING_SPEC §11: repeat scans reuse parse output keyed by path+size+mtime. */
  async parse(candidate: Candidate, context: ScanContext): Promise<ParseResult> {
    const { stat } = await import('node:fs/promises');
    let size = 0;
    let mtimeMs = 0;
    try {
      const st = await stat(candidate.absolutePath);
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      return { observations: [], diagnostics: [] };
    }
    const cached = this.parseCache.get(candidate.absolutePath, size, mtimeMs, this.version);
    if (cached) {
      return {
        observations: cached.observations as ParseResult['observations'],
        diagnostics: cached.diagnostics as ParseResult['diagnostics'],
      };
    }
    const result = await this.parseUncached(candidate, context);
    this.parseCache.set(candidate.absolutePath, {
      size,
      mtimeMs,
      parserVersion: this.version,
      observations: result.observations,
      diagnostics: result.diagnostics,
    });
    return result;
  }

  private async parseUncached(candidate: Candidate, context: ScanContext): Promise<ParseResult> {
    const diagnostics: DiagnosticValue[] = [];
    const discoveredAt = new Date().toISOString();
    const pathToken = candidate.absolutePath.startsWith(context.repoRoot)
      ? candidate.absolutePath.slice(context.repoRoot.length + 1).split('\\').join('/')
      : `~/${candidate.name}`;

    if (candidate.kind === 'skill') {
      const scoped = await scopedRead(candidate, context);
      if (!scoped.ok) {
        diagnostics.push({ code: scoped.code, severity: scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'codex', target: pathToken, message: 'skill unreadable (${scoped.code})' });
        return { observations: [], diagnostics };
      }
      const text = scoped.text;
      const fm = parseFrontmatter(text);
      if (fm.error) diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'codex', target: pathToken, message: fm.error });
      // PRI-02: whitelisted summary — raw frontmatter is never persisted.
      const built = buildObservation({
        candidate,
        contentHash: sha256Hex(text),
        summary: {
          name: String(fm.frontmatter.name ?? candidate.name),
          description: typeof fm.frontmatter.description === 'string' ? fm.frontmatter.description : '',
        },
        sourceEvidence: [{ type: 'manifest', origin: pathToken }],
        discoveredAt,
        locationToken: pathToken,
      });
      return { observations: [built.observation], diagnostics };
    }

    if (candidate.kind === 'rule-document') {
      const scoped = await scopedRead(candidate, context);
      if (!scoped.ok) {
        diagnostics.push({ code: scoped.code, severity: scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'codex', target: pathToken, message: 'rule document unreadable (${scoped.code})' });
        return { observations: [], diagnostics };
      }
      const text = scoped.text;
      const chain = await buildAgentsChainFromFs(context);
      const loaded = isLoadedInContext(chain, candidate.absolutePath, context);
      const built = buildObservation({
        candidate,
        contentHash: sha256Hex(text),
        summary: {
          role: candidate.name === 'AGENTS.override.md' ? 'override' : 'fallback',
          loadedInContext: loaded,
          chain: chain.entries,
          lines: text.split('\n').length,
          document: candidate.name,
        },
        sourceEvidence: [{ type: 'git-worktree', origin: pathToken }],
        discoveredAt,
        locationToken: pathToken,
      });
      return { observations: [built.observation], diagnostics };
    }

    if (candidate.kind === 'hook') {
      const scoped = await scopedRead(candidate, context);
      if (!scoped.ok) {
        diagnostics.push({ code: scoped.code, severity: scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'codex', target: pathToken, message: 'config unreadable (${scoped.code})' });
        return { observations: [], diagnostics };
      }
      const text = scoped.text;
      let config: Record<string, unknown>;
      try {
        config = parseToml(text) as Record<string, unknown>;
      } catch (e) {
        diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'codex', target: pathToken, message: `invalid TOML: ${String(e)}` });
        return { observations: [], diagnostics };
      }
      const redacted = redactObject(config.hooks ?? config);
      const built = buildObservation({
        candidate,
        contentHash: sha256Hex(text),
        summary: { events: redacted.value, owner: 'settings', trust: 'unknown' },
        sourceEvidence: [{ type: 'manifest', origin: pathToken }],
        discoveredAt,
        locationToken: pathToken,
      });
      return { observations: [built.observation], diagnostics };
    }

    // plugin / marketplace manifests.
    const scoped = await scopedRead(candidate, context);
    if (!scoped.ok) {
      diagnostics.push({ code: scoped.code, severity: scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'codex', target: pathToken, message: `manifest unreadable (${scoped.code})` });
      return { observations: [], diagnostics };
    }
    const text = scoped.text;
    let manifest: Record<string, unknown>;
    try {
      manifest = candidate.absolutePath.endsWith('.toml') ? (parseToml(text) as Record<string, unknown>) : (JSON.parse(text) as Record<string, unknown>);
    } catch (e) {
      diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'codex', target: pathToken, message: String(e) });
      return { observations: [], diagnostics };
    }
    const name = String(manifest.name ?? candidate.name);
    // PRI-02: whitelisted manifest DTO; FUN-02: structured source identity.
    const sourceIdentity = identityFromSourceField(manifest.source) ?? { type: 'unknown' as const };
    const summary =
      candidate.kind === 'plugin'
        ? {
            manifestName: name,
            version: manifest.version === undefined ? 'unknown' : String(manifest.version),
            description: typeof manifest.description === 'string' ? manifest.description : '',
          }
        : {
            manifestName: name,
            pluginNames: Array.isArray(manifest.plugins) ? manifest.plugins.map((p) => String((p as Record<string, unknown>).name ?? '')) : [],
          };
    const built = buildObservation({
      candidate: { ...candidate, name },
      contentHash: canonicalJsonHash(manifest),
      summary,
      sourceIdentity,
      sourceEvidence: [{ type: 'manifest', origin: pathToken }],
      discoveredAt,
      locationToken: pathToken,
    });
    return { observations: [built.observation], diagnostics };
  }
}

async function findSkillDirs(root: string, context: ScanContext): Promise<Array<{ name: string; path: string }>> {
  if (!(await exists(root))) return [];
  const out: Array<{ name: string; path: string }> = [];
  try {
    const fs = await import('node:fs');
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    entries.sort((a, b) => compareCodePoints(a.name, b.name));
    for (const e of entries) {
      if (e.isDirectory() && (await exists(join(root, e.name, 'SKILL.md')))) {
        out.push({ name: e.name, path: join(root, e.name, 'SKILL.md') });
        if (out.length >= context.limits.maxFiles) break;
      }
    }
  } catch {
    return out;
  }
  return out;
}
