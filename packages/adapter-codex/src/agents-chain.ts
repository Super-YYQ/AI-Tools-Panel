/**
 * FUN-01 (P1): real AGENTS.md loading chain built from the filesystem.
 * For every directory from the Git root to the CWD (plus the user-level Codex
 * home), records which candidate document is actually selected (override beats
 * fallback), which candidates are excluded, and the global load order.
 * Directory identity is expressed as repo-relative tokens — never absolute
 * machine paths (PRI-001).
 */
import { exists } from '@aitp/inventory-core';
import { join, relative, isAbsolute, resolve } from 'node:path';

export interface AgentsChainEntry {
  /** Repo-relative directory token, or '<user>' for user-level docs. */
  dirToken: string;
  scope: 'user' | 'repo';
  candidates: string[];
  selected: string | null;
  excluded: string[];
  reason: string;
  loadOrder: number;
}

export interface AgentsChain {
  entries: AgentsChainEntry[];
  /** The document tokens actually loaded in this context, in order. */
  loaded: Array<{ document: string; dirToken: string }>;
}

const OVERRIDE = 'AGENTS.override.md';
const FALLBACK = 'AGENTS.md';

/** Directories from CWD up to the Git root, ordered root-first (load order). */
export function chainDirs(cwd: string, repoRoot: string): string[] {
  const out: string[] = [];
  let current = resolve(cwd);
  const root = resolve(repoRoot);
  for (let i = 0; i < 32; i++) {
    out.unshift(current);
    if (current.toLowerCase() === root.toLowerCase()) break;
    const parent = resolve(current, '..');
    if (parent === current) break;
    if (!root.toLowerCase().startsWith(parent.toLowerCase())) break; // parent above root
    current = parent;
  }
  return out;
}

export async function buildAgentsChainFromFs(context: { repoRoot: string; homeDir: string; cwd: string }): Promise<AgentsChain> {
  const entries: AgentsChainEntry[] = [];
  let loadOrder = 0;

  // 1. User-level global document (selected via override/fallback at <user>).
  const userDir = join(context.homeDir, '.codex');
  const userCandidates = [OVERRIDE, FALLBACK];
  let userSelected: string | null = null;
  const userExcluded: string[] = [];
  for (const candidate of userCandidates) {
    if (userSelected === null && (await exists(join(userDir, candidate)))) userSelected = candidate;
    else if (await exists(join(userDir, candidate))) userExcluded.push(candidate);
  }
  entries.push({
    dirToken: '<user>',
    scope: 'user',
    candidates: userCandidates,
    selected: userSelected,
    excluded: userExcluded,
    reason: userSelected ? `${userSelected} selected at user level` : 'no user-level document',
    loadOrder: userSelected ? loadOrder++ : -1,
  });

  // 2. Git root → CWD, root-first; override beats fallback per directory.
  const dirs = chainDirs(context.cwd, context.repoRoot);
  for (const dir of dirs) {
    const repoRel = relative(context.repoRoot, dir).split('\\').join('/');
    const dirToken = repoRel === '' ? '.' : repoRel;
    const candidates = [OVERRIDE, FALLBACK];
    let selected: string | null = null;
    const excluded: string[] = [];
    for (const candidate of candidates) {
      if (selected === null && (await exists(join(dir, candidate)))) selected = candidate;
      else if (await exists(join(dir, candidate))) excluded.push(candidate);
    }
    entries.push({
      dirToken,
      scope: 'repo',
      candidates,
      selected,
      excluded,
      reason: selected === OVERRIDE ? 'override present; fallback excluded' : selected === FALLBACK ? 'fallback used (no override)' : 'no rule document in this directory',
      loadOrder: selected ? loadOrder++ : -1,
    });
  }

  return {
    entries,
    loaded: entries
      .filter((e) => e.selected !== null)
      .map((e) => ({ document: e.selected!, dirToken: e.dirToken })),
  };
}

/** Whether a scanned document at absPath is the selected document of its directory. */
export function isLoadedInContext(chain: AgentsChain, absPath: string, context: { repoRoot: string; homeDir: string }): boolean {
  const norm = absPath.split('\\').join('/');
  for (const entry of chain.entries) {
    if (entry.selected === null) continue;
    const base =
      entry.dirToken === '<user>'
        ? join(context.homeDir, '.codex').split('\\').join('/')
        : join(context.repoRoot, entry.dirToken === '.' ? '' : entry.dirToken).split('\\').join('/');
    for (const candidate of entry.candidates) {
      const docPath = `${base}/${candidate}`.replace(/\/{2,}/g, '/');
      if (norm.toLowerCase() === docPath.toLowerCase()) {
        return entry.selected === candidate;
      }
    }
  }
  void isAbsolute;
  return false;
}
