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
} from '@aitp/contracts';
import {
  buildObservation,
  canonicalJsonHash,
  classifyReadFailure,
  exists,
  parseFrontmatter,
  readTextCapped,
  sha256Hex,
  walkBounded,
} from '@aitp/inventory-core';
import { redactObject } from '@aitp/security';

export const CLAUDE_ADAPTER_VERSION = '1.0.0';

function readFailureDiagnostic(
  provider: 'claude-code',
  target: string,
  kind: 'access-denied' | 'too-large' | 'missing',
  message: string,
): { code: 'ACCESS_DENIED' | 'FILE_TOO_LARGE' | 'ROOT_NOT_FOUND'; severity: 'warning' | 'info'; provider: string; target: string; message: string; recovery: string } {
  if (kind === 'access-denied') {
    return { code: 'ACCESS_DENIED', severity: 'warning', provider, target, message, recovery: 'Grant read permission or exclude this root from scanning.' };
  }
  if (kind === 'too-large') {
    return { code: 'FILE_TOO_LARGE', severity: 'warning', provider, target, message, recovery: 'Increase the configured size limit if this file must be scanned.' };
  }
  return { code: 'ROOT_NOT_FOUND', severity: 'info', provider, target, message, recovery: 'Verify the file exists at scan time.' };
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

  async parse(candidate: Candidate, context: ScanContext): Promise<ParseResult> {
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
      return parseManifest(candidate, pathToken, diagnostics, discoveredAt, 'plugin');
    }
    return parseManifest(candidate, pathToken, diagnostics, discoveredAt, 'marketplace');
  }
}

async function findSkillDirs(root: string, context: ScanContext): Promise<Array<{ name: string; path: string }>> {
  if (!(await exists(root))) return [];
  const out: Array<{ name: string; path: string }> = [];
  try {
    const entries = await import('node:fs').then((fs) => fs.promises.readdir(root, { withFileTypes: true }));
    entries.sort((a, b) => a.name.localeCompare(b.name));
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
  _context: ScanContext,
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
): Promise<ParseResult> {
  const text = await readTextCapped(candidate.absolutePath);
  if (text === undefined) {
    diagnostics.push(readFailureDiagnostic('claude-code', pathToken, await classifyReadFailure(candidate.absolutePath), 'skill file unreadable'));
    return { observations: [], diagnostics };
  }
  const fm = parseFrontmatter(text);
  if (fm.error) {
    diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'claude-code', target: pathToken, message: fm.error, recovery: 'Fix YAML frontmatter delimiters.' });
  }
  const name = String(fm.frontmatter.name ?? candidate.name);
  const description = typeof fm.frontmatter.description === 'string' ? fm.frontmatter.description : '';
  if (!description) {
    diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'claude-code', target: pathToken, message: 'description missing', recovery: 'Add a description to SKILL.md frontmatter.' });
  }
  const summary: Record<string, unknown> = {
    name,
    description,
    frontmatter: fm.frontmatter,
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
    for (const e of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
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
  const text = await readTextCapped(candidate.absolutePath);
  if (text === undefined) {
    diagnostics.push(readFailureDiagnostic('claude-code', pathToken, await classifyReadFailure(candidate.absolutePath), 'rule document unreadable'));
    return { observations: [], diagnostics };
  }
  const fm = parseFrontmatter(text);
  const imports = [...text.matchAll(/@([^\s]+)/g)].map((m) => m[1]!);
  const summary: Record<string, unknown> = {
    role: candidate.name.includes('local') ? 'local' : 'project',
    imports,
    lines: text.split('\n').length,
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
  _context: ScanContext,
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
): Promise<ParseResult> {
  const text = await readTextCapped(candidate.absolutePath);
  if (text === undefined) {
    diagnostics.push(readFailureDiagnostic('claude-code', pathToken, await classifyReadFailure(candidate.absolutePath), 'settings file unreadable'));
    return { observations: [], diagnostics };
  }
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
  diagnostics: DiagnosticValue[],
  discoveredAt: string,
  kind: 'plugin' | 'marketplace',
): Promise<ParseResult> {
  const text = await readTextCapped(candidate.absolutePath);
  if (text === undefined) {
    diagnostics.push(readFailureDiagnostic('claude-code', pathToken, await classifyReadFailure(candidate.absolutePath), 'manifest unreadable'));
    return { observations: [], diagnostics };
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(text) as Record<string, unknown>;
  } catch (e) {
    diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'claude-code', target: pathToken, message: String(e) });
    return { observations: [], diagnostics };
  }
  const name = String(manifest.name ?? candidate.name);
  const summary: Record<string, unknown> = {
    manifestName: name,
    version: manifest.version === undefined ? 'unknown' : String(manifest.version),
    description: typeof manifest.description === 'string' ? manifest.description : '',
    manifest,
    enabledEvidence: kind === 'plugin' ? 'unknown' : undefined,
  };
  const built = buildObservation({
    candidate: { ...candidate, name },
    contentHash: canonicalJsonHash(manifest),
    summary,
    sourceEvidence: [{ type: 'manifest', origin: pathToken }],
    discoveredAt,
    locationToken: pathToken,
  });
  return { observations: [built.observation], diagnostics };
}
