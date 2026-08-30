/**
 * @aitp/adapter-codex — Codex discovery/parsing (SCANNING_SPEC §6).
 * Includes AGENTS.md override/fallback chain with load order (RULE-001).
 */
import { join, resolve, dirname } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type {
  Candidate,
  DetectionResult,
  DiagnosticValue,
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

export const CODEX_ADAPTER_VERSION = '1.0.0';

function readFailureDiagnostic(
  provider: 'codex',
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
        yield {
          provider: this.id,
          kind: 'skill',
          scope: dir === context.repoRoot ? 'repo' : 'repo',
          name: skillDir.name,
          absolutePath: skillDir.path,
          copyRole: 'source',
        };
      }
      // AGENTS.md chain documents.
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

  async parse(candidate: Candidate, context: ScanContext): Promise<ParseResult> {
    const diagnostics: DiagnosticValue[] = [];
    const discoveredAt = new Date().toISOString();
    const pathToken = candidate.absolutePath.startsWith(context.repoRoot)
      ? candidate.absolutePath.slice(context.repoRoot.length + 1).split('\\').join('/')
      : `~/${candidate.name}`;

    if (candidate.kind === 'skill') {
      const text = await readTextCapped(candidate.absolutePath);
      if (text === undefined) {
        diagnostics.push(readFailureDiagnostic('codex', pathToken, await classifyReadFailure(candidate.absolutePath), 'skill unreadable'));
        return { observations: [], diagnostics };
      }
      const fm = parseFrontmatter(text);
      if (fm.error) diagnostics.push({ code: 'INVALID_FRONTMATTER', severity: 'warning', provider: 'codex', target: pathToken, message: fm.error });
      const built = buildObservation({
        candidate,
        contentHash: sha256Hex(text),
        summary: {
          name: String(fm.frontmatter.name ?? candidate.name),
          description: typeof fm.frontmatter.description === 'string' ? fm.frontmatter.description : '',
          frontmatter: fm.frontmatter,
        },
        sourceEvidence: [{ type: 'manifest', origin: pathToken }],
        discoveredAt,
        locationToken: pathToken,
      });
      return { observations: [built.observation], diagnostics };
    }

    if (candidate.kind === 'rule-document') {
      const text = await readTextCapped(candidate.absolutePath);
      if (text === undefined) {
        diagnostics.push(readFailureDiagnostic('codex', pathToken, await classifyReadFailure(candidate.absolutePath), 'rule document unreadable'));
        return { observations: [], diagnostics };
      }
      const chain = buildAgentsChain(context);
      const loaded = chain.some((c) => c.document.toLowerCase() === candidate.name.toLowerCase() && candidate.absolutePath.toLowerCase().startsWith(c.dir.toLowerCase()));
      const built = buildObservation({
        candidate,
        contentHash: sha256Hex(text),
        summary: {
          role: candidate.name === 'AGENTS.override.md' ? 'override' : 'fallback',
          loadedInContext: loaded,
          chain,
          lines: text.split('\n').length,
        },
        sourceEvidence: [{ type: 'git-worktree', origin: pathToken }],
        discoveredAt,
        locationToken: pathToken,
      });
      return { observations: [built.observation], diagnostics };
    }

    if (candidate.kind === 'hook') {
      const text = await readTextCapped(candidate.absolutePath);
      if (text === undefined) {
        diagnostics.push(readFailureDiagnostic('codex', pathToken, await classifyReadFailure(candidate.absolutePath), 'config unreadable'));
        return { observations: [], diagnostics };
      }
      let config: Record<string, unknown>;
      try {
        config = parseToml(text) as Record<string, unknown>;
      } catch (e) {
        diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'codex', target: pathToken, message: `invalid TOML: ${String(e)}` });
        return { observations: [], diagnostics };
      }
      const redacted = redactObject(config);
      const hooks = redacted.value.hooks ?? redacted.value;
      const built = buildObservation({
        candidate,
        contentHash: sha256Hex(text),
        summary: { events: hooks, owner: 'settings', trust: 'unknown' },
        sourceEvidence: [{ type: 'manifest', origin: pathToken }],
        discoveredAt,
        locationToken: pathToken,
      });
      return { observations: [built.observation], diagnostics };
    }

    // plugin / marketplace manifests.
    const text = await readTextCapped(candidate.absolutePath);
    if (text === undefined) {
      diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'codex', target: pathToken, message: 'manifest missing' });
      return { observations: [], diagnostics };
    }
    let manifest: Record<string, unknown>;
    try {
      manifest = candidate.absolutePath.endsWith('.toml') ? (parseToml(text) as Record<string, unknown>) : (JSON.parse(text) as Record<string, unknown>);
    } catch (e) {
      diagnostics.push({ code: 'INVALID_MANIFEST', severity: 'error', provider: 'codex', target: pathToken, message: String(e) });
      return { observations: [], diagnostics };
    }
    const name = String(manifest.name ?? candidate.name);
    const built = buildObservation({
      candidate: { ...candidate, name },
      contentHash: canonicalJsonHash(manifest),
      summary: { manifestName: name, version: manifest.version === undefined ? 'unknown' : String(manifest.version), manifest },
      sourceEvidence: [{ type: 'manifest', origin: pathToken }],
      discoveredAt,
      locationToken: pathToken,
    });
    return { observations: [built.observation], diagnostics };
  }
}

/** Directories from CWD up to the Git root, nearest first (SCANNING_SPEC §6). */
export function chainDirs(cwd: string, repoRoot: string): string[] {
  const out: string[] = [];
  let current = resolve(cwd);
  const root = resolve(repoRoot);
  for (let i = 0; i < 32; i++) {
    out.push(current);
    if (current.toLowerCase() === root.toLowerCase()) break;
    const parent = dirname(current);
    if (parent === current) break;
    if (!root.toLowerCase().startsWith(parent.toLowerCase())) break; // parent is above root
    current = parent;
  }
  return out;
}

/** AGENTS.md chain: git root → CWD, override beats fallback per directory. */
export function buildAgentsChain(context: ScanContext): Array<{ dir: string; document: string; excluded: string[] }> {
  const chain: Array<{ dir: string; document: string; excluded: string[] }> = [];
  for (const dir of chainDirs(context.cwd, context.repoRoot)) {
    const hasOverride = dir === context.repoRoot;
    void hasOverride;
    chain.push({
      dir,
      document: 'AGENTS.override.md',
      excluded: ['AGENTS.md'],
    });
  }
  return chain;
}

async function findSkillDirs(root: string, context: ScanContext): Promise<Array<{ name: string; path: string }>> {
  if (!(await exists(root))) return [];
  const out: Array<{ name: string; path: string }> = [];
  try {
    const fs = await import('node:fs');
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
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
