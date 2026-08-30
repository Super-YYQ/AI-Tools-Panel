/**
 * @aitp/adapter-claude — Claude Code discovery/parsing (SCANNING_SPEC §5).
 * Read-only, data-only parsing; commands and secrets are redacted, never executed.
 */
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type {
  Candidate,
  DetectionResult,
  DiagnosticValue,
  ObservationValue,
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
import { relative, resolve as resolvePath } from 'node:path';
import { redactObject } from '@aitp/security';

export const CLAUDE_ADAPTER_VERSION = '1.1.0';

function identityFromSourceField(source: unknown): SourceIdentityValue | undefined {
  if (typeof source === 'string' && /^https:\/\//.test(source)) {
    return { type: 'git', canonicalUrl: source.replace(/\.git$/, '') };
  }
  return undefined;
}

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
  void resolvePath;
  const result = await readScopedTextCapped({ root, path: relPath });
  if (result.ok) return { ok: true, text: result.content };
  return { ok: false, code: scopedReadDiagnosticCode(result.code) };
}



export class ClaudeAdapter implements ProviderAdapter {
  id = 'claude-code' as const;
  version = CLAUDE_ADAPTER_VERSION;

  async detect(context: ScanContext): Promise<DetectionResult> {
    const configRoot = join(context.homeDir, '.claude');
    if (await exists(configRoot)) {
      return { provider: this.id, installed: true, configRoot };
    }
    // SCANNING_SPEC §3 Detect: missing CLI/user config but existing repo
    // config still allows file scanning — this is not an error state.
    if (await exists(join(context.repoRoot, '.claude'))) {
      return { provider: this.id, installed: true, configRoot: join(context.repoRoot, '.claude'), detail: 'user config missing; repo-level .claude found' };
    }
    return { provider: this.id, installed: false, detail: 'not-installed' };
  }

  async *discover(context: ScanContext): AsyncIterable<Candidate> {
    const userRoot = join(context.homeDir, '.claude');
    // User-level skills.
    for (const skillDir of await findSkillDirs(join(userRoot, 'skills'), context)) {
      yield { provider: this.id, kind: 'skill', scope: 'user', name: skillDir.name, absolutePath: skillDir.path, copyRole: 'source' };
    }
    // Repo-level skills.
    for (const skillDir of await findSkillDirs(join(context.repoRoot, '.claude', 'skills'), context)) {
      yield { provider: this.id, kind: 'skill', scope: 'repo', name: skillDir.name, absolutePath: skillDir.path, copyRole: 'source' };
    }
    // Plugin cache skill copies.
    for (const skillDir of await findSkillDirs(join(userRoot, 'plugins', 'cache'), context)) {
      yield { provider: this.id, kind: 'skill', scope: 'plugin', name: skillDir.name, absolutePath: skillDir.path, copyRole: 'cache' };
    }
    // Rule documents (repo).
    for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
      const p = join(context.repoRoot, ...name.split('/'));
      if (await exists(p)) {
        yield { provider: this.id, kind: 'rule-document', scope: 'repo', name, absolutePath: p, copyRole: 'source' };
      }
    }
    // Modular rules.
    const { files } = await walkBounded(join(context.repoRoot, '.claude', 'rules'), context, {
      maxDepth: context.limits.maxDepth,
      match: (rel, name) => name.endsWith('.md'), // root-relative fallback
    });
    for (const f of files) {
      yield { provider: this.id, kind: 'rule-document', scope: 'repo', name: f.relativeFrom, absolutePath: f.absolutePath, copyRole: 'source' };
    }
    // Hooks in settings files.
    for (const [p, scope] of [
      [join(userRoot, 'settings.json'), 'user'] as const,
      [join(context.repoRoot, '.claude', 'settings.json'), 'repo'] as const,
      [join(context.repoRoot, '.claude', 'settings.local.json'), 'local'] as const,
    ]) {
      if (await exists(p)) {
        yield { provider: this.id, kind: 'hook', scope, name: p.split(/[\\/]/).pop()!, absolutePath: p, copyRole: 'source' };
      }
    }
    // Plugins: declared manifests.
    for (const [root, scope, role] of [
      [context.repoRoot, 'repo', 'declared'] as const,
      [join(userRoot, 'plugins'), 'plugin', 'cache'] as const,
    ]) {
      const { files } = await walkBounded(root, context, {
        maxDepth: Math.min(context.limits.maxDepth, 4),
        match: (rel, name) => name === 'plugin.json' && rel.includes('.claude-plugin/'),
      });
      for (const f of files) {
        const name = f.absolutePath.split(/[\\/]/).slice(-3)[0] ?? 'plugin';
        yield { provider: this.id, kind: 'plugin', scope, name, absolutePath: f.absolutePath, copyRole: role === 'cache' ? 'cache' : 'declared' };
      }
    }
    // Marketplaces.
    const mkt = await walkBounded(context.repoRoot, context, {
      maxDepth: Math.min(context.limits.maxDepth, 5),
      match: (rel, name) => name === 'marketplace.json' && rel.includes('.claude-plugin/'),
    });
    for (const f of mkt.files) {
      const name = f.absolutePath.split(/[\\/]/).slice(-3)[0] ?? 'marketplace';
      yield { provider: this.id, kind: 'marketplace', scope: 'repo', name, absolutePath: f.absolutePath, copyRole: 'declared' };
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
      return parseSkill(candidate, pathToken, context, diagnostics, discoveredAt);
    }
    if (candidate.kind === 'rule-document') {
      return parseRuleDocument(candidate, pathToken, context, diagnostics, discoveredAt);
    }
    if (candidate.kind === 'hook') {
      return parseHooks(candidate, pathToken, context, diagnostics, discoveredAt);
    }
    if (candidate.kind === 'plugin') {
      return parseManifest(candidate, pathToken, context, diagnostics, discoveredAt, 'plugin');
    }
    return parseManifest(candidate, pathToken, context, diagnostics, discoveredAt, 'marketplace');
  }
}

async function findSkillDirs(root: string, context: ScanContext): Promise<Array<{ name: string; path: string }>> {
  if (!(await exists(root))) return [];
  const out: Array<{ name: string; path: string }> = [];
  try {
    const entries = await import('node:fs').then((fs) => fs.promises.readdir(root, { withFileTypes: true }));
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

async function parseSkill(
  candidate: Candidate,
  pathToken: string,
  context: ScanContext,
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
): Promise<ParseResult> {
  const scoped = await scopedRead(candidate, context);
  if (!scoped.ok) {
    diagnostics.push({ code: scoped.code, severity: scoped.code === 'SYMLINK_OUTSIDE_ROOT' ? 'warning' : scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'claude-code', target: pathToken, message: `skill file unreadable (${scoped.code})`, recovery: scoped.code === 'SYMLINK_OUTSIDE_ROOT' ? 'The link target is outside the scanned scope; only the link is recorded.' : undefined });
    return { observations: [], diagnostics };
  }
  const text = scoped.text;
  const fm = parseFrontmatter(text);
  if (fm.error) {
    diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'claude-code', target: pathToken, message: fm.error, recovery: 'Fix YAML frontmatter delimiters.' });
  }
  const name = String(fm.frontmatter.name ?? candidate.name);
  const description = typeof fm.frontmatter.description === 'string' ? fm.frontmatter.description : '';
  if (!description) {
    diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'claude-code', target: pathToken, message: 'description missing', recovery: 'Add a description to SKILL.md frontmatter.' });
  }
  // PRI-02: whitelisted DTO only — raw frontmatter is never persisted.
  const summary: Record<string, unknown> = {
    name,
    description,
    version: typeof fm.frontmatter.version === 'string' ? fm.frontmatter.version : undefined,
    resourceFiles: [] as string[],
    scripts: [] as string[],
  };
  // Resource/script inventory only — never executed. Shallow bounded listing
  // (depth 2) avoids a full walk per skill; large trees stop at maxEntries.
  const skillDir = candidate.absolutePath.replace(/[\\/]SKILL\.md$/, '');
  const maxEntries = 200;
  let entries = 0;
  const listLevel = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 2 || entries >= maxEntries) return;
    let dirents;
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirents.sort((a, b) => compareCodePoints(a.name, b.name))) {
      if (entries >= maxEntries) return;
      const rel = prefix ? prefix + '/' + e.name : e.name;
      if (/SKILL\.md$/.test(rel)) continue;
      if (e.isDirectory()) {
        await listLevel(join(dir, e.name), rel, depth + 1);
      } else if (e.isFile()) {
        entries++;
        if (/\.(sh|ps1|py|js|ts|cmd|bat)$/.test(e.name)) (summary.scripts as string[]).push(rel);
        else (summary.resourceFiles as string[]).push(rel);
      }
    }
  };
  await listLevel(skillDir, '', 0);

  
  const built = buildObservation({
    candidate: { ...candidate, name },
    contentHash: sha256Hex(text),
    summary,
    sourceEvidence: [{ type: 'manifest', origin: pathToken, detail: 'SKILL.md frontmatter' }],
    discoveredAt,
    locationToken: pathToken,
  });
  return { observations: [built.observation], diagnostics };
}

async function parseRuleDocument(
  candidate: Candidate,
  pathToken: string,
  context: ScanContext,
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
): Promise<ParseResult> {
  const scoped = await scopedRead(candidate, context);
  if (!scoped.ok) {
    diagnostics.push({ code: scoped.code, severity: scoped.code === 'SYMLINK_OUTSIDE_ROOT' ? 'warning' : scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'claude-code', target: pathToken, message: `rule document unreadable (${scoped.code})` });
    return { observations: [], diagnostics };
  }
  const text = scoped.text;
  const fm = parseFrontmatter(text);
  const imports = [...text.matchAll(/@([^\s]+)/g)].map((m) => m[1]!);
  const summary: Record<string, unknown> = {
    role: candidate.name.includes('local') ? 'local' : 'project',
    imports,
    lines: text.split('\n').length,
    document: candidate.name,
  };
  const built = buildObservation({
    candidate,
    contentHash: sha256Hex(text),
    summary,
    sourceEvidence: [{ type: 'git-worktree', origin: pathToken }],
    discoveredAt,
    locationToken: pathToken,
  });
  void context;
  if (fm.error) {
    diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'claude-code', target: pathToken, message: fm.error });
  }
  return { observations: [built.observation], diagnostics };
}

async function parseHooks(
  candidate: Candidate,
  pathToken: string,
  context: ScanContext,
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
): Promise<ParseResult> {
  const scoped = await scopedRead(candidate, context);
  if (!scoped.ok) {
    diagnostics.push({ code: scoped.code, severity: scoped.code === 'SYMLINK_OUTSIDE_ROOT' ? 'warning' : scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'claude-code', target: pathToken, message: `settings file unreadable (${scoped.code})` });
    return { observations: [], diagnostics };
  }
  const text = scoped.text;
  let settings: Record<string, unknown>;
  try {
    settings = parseYaml(text) as Record<string, unknown>;
  } catch (e) {
    diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'claude-code', target: pathToken, message: `invalid settings JSON: ${String(e)}` });
    return { observations: [], diagnostics };
  }
  const hooksRaw = settings.hooks;
  const observations: ObservationValue[] = [];
  if (hooksRaw && typeof hooksRaw === 'object') {
    const redacted = redactObject(hooksRaw);
    if (redacted.redactions.length > 0) {
      diagnostics.push({ code: 'SECRET_REDACTED', severity: 'info', provider: 'claude-code', target: pathToken, message: `redacted: ${redacted.redactions.join(', ')}` });
    }
    const built = buildObservation({
      candidate,
      contentHash: sha256Hex(text),
      summary: { events: redacted.value, owner: 'settings' },
      sourceEvidence: [{ type: 'manifest', origin: pathToken }],
      discoveredAt,
      locationToken: pathToken,
    });
    observations.push(built.observation);
  }
  return { observations, diagnostics };
}

async function parseManifest(
  candidate: Candidate,
  pathToken: string,
  context: ScanContext,
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
  kind: 'plugin' | 'marketplace',
): Promise<ParseResult> {
  const scoped = await scopedRead(candidate, context);
  if (!scoped.ok) {
    diagnostics.push({ code: scoped.code, severity: scoped.code === 'SYMLINK_OUTSIDE_ROOT' ? 'warning' : scoped.code === 'ROOT_NOT_FOUND' ? 'info' : 'warning', provider: 'claude-code', target: pathToken, message: `manifest unreadable (${scoped.code})` });
    return { observations: [], diagnostics };
  }
  const text = scoped.text;
  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(text) as Record<string, unknown>;
  } catch (e) {
    diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'claude-code', target: pathToken, message: String(e) });
    return { observations: [], diagnostics };
  }
  const name = String(manifest.name ?? candidate.name);
  // PRI-02: whitelisted manifest DTO — the raw manifest is never persisted.
  // FUN-02: structured source identity from the manifest source field.
  const sourceIdentity = identityFromSourceField(manifest.source) ?? { type: 'unknown' as const };
  const summary: Record<string, unknown> =
    kind === 'plugin'
      ? {
          manifestName: name,
          version: manifest.version === undefined ? 'unknown' : String(manifest.version),
          description: typeof manifest.description === 'string' ? manifest.description : '',
        }
      : {
          manifestName: name,
          pluginNames: Array.isArray(manifest.plugins)
            ? manifest.plugins.map((p) => String((p as Record<string, unknown>).name ?? ''))
            : [],
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
