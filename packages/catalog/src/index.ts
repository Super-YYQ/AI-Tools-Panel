/**
 * @aitp/catalog — Git Catalog persistence, ChangeSet and atomic apply.
 * CATALOG_SPEC.md; SECURITY_AND_GIT.md §5 (path allowlist, atomic writes).
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createHash, randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import type {
  ChangeSetValue,
  CatalogEntryValue,
  CatalogStore,
  FileChangeValue,
} from '@aitp/contracts';
import { API_VERSION, CatalogEntry } from '@aitp/contracts';
import { checkRepoRelativePath, resolveSafeReadPath, resolveSafeWritePath } from '@aitp/security';
import { sha256Hex } from './hash.js';

export { sha256Hex, sha256 } from './hash.js';

const ALLOWED_WRITE_ROOTS = ['catalog/', 'sources.lock.yaml', 'snapshots/'];

export function isAllowedWritePath(repoRelativePath: string): boolean {
  const norm = repoRelativePath.split('\\').join('/');
  return ALLOWED_WRITE_ROOTS.some(
    (root) => (root.endsWith('/') && norm.startsWith(root)) || norm === root,
  );
}

export interface CatalogParseResult {
  entry?: CatalogEntryValue;
  diagnostics: Array<{ code: string; message: string; path: string }>;
}

/**
 * Parse a catalog YAML file. Unknown fields are preserved in `.unknown`
 * (CAT-006); unknown apiVersion major blocks writes (read-only visibility).
 */
export function parseCatalogYaml(text: string, path: string): CatalogParseResult {
  const diagnostics: CatalogParseResult['diagnostics'] = [];
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(text) as Record<string, unknown>;
  } catch (e) {
    return { diagnostics: [{ code: 'INVALID_YAML', message: String(e), path }] };
  }
  if (!doc || typeof doc !== 'object') {
    return { diagnostics: [{ code: 'INVALID_YAML', message: 'document is empty', path }] };
  }
  const { unknown, ...rest } = stripKnown(doc);
  const apiVersion = rest.apiVersion;
  if (apiVersion !== API_VERSION) {
    diagnostics.push({
      code: 'UNSUPPORTED_VERSION',
      message: `apiVersion ${String(apiVersion)} is not ${API_VERSION}; entry is read-only`,
      path,
    });
    return { entry: { ...(rest as unknown as CatalogEntryValue), unknown }, diagnostics };
  }
  const knownKinds = ['Skill', 'Plugin', 'Marketplace', 'Hook', 'RuleFragment'];
  if (!knownKinds.includes(String(rest.kind))) {
    diagnostics.push({ code: 'INVALID_KIND', message: `kind ${String(rest.kind)} not supported`, path });
    return { diagnostics };
  }
  // Normalize through the schema so defaults (overlay/verification/etc.) are
  // applied before any consumer reads nested fields (CAT-006).
  const candidate = { ...(rest as unknown as CatalogEntryValue), unknown };
  const validated = CatalogEntry.safeParse(candidate);
  if (!validated.success) {
    diagnostics.push({
      code: 'INVALID_ENTRY',
      message: `entry failed schema validation: ${validated.error.issues[0]?.path.join('.') ?? 'unknown'}`,
      path,
    });
    return { diagnostics };
  }
  return { entry: validated.data as CatalogEntryValue, diagnostics };
}

const KNOWN_TOP_LEVEL = new Set(['apiVersion', 'kind', 'metadata', 'spec', 'overlay', 'verification']);

function stripKnown(doc: Record<string, unknown>): { unknown?: Record<string, unknown> } & Record<string, unknown> {
  const unknownFields: Record<string, unknown> = {};
  for (const key of Object.keys(doc)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      unknownFields[key] = doc[key];
      delete doc[key];
    }
  }
  return Object.keys(unknownFields).length > 0 ? { ...doc, unknown: unknownFields } : doc;
}

/** Deterministic serialization: sorted tags, fixed key order, blank-line separated sections. */
export function serializeCatalogEntry(entry: CatalogEntryValue): string {
  const clean = { ...entry };
  if (clean.unknown && Object.keys(clean.unknown).length === 0) delete clean.unknown;
  if (clean.overlay && Object.keys(clean.overlay.fieldOrigins ?? {}).length === 0) {
    clean.overlay = { ...clean.overlay, fieldOrigins: {} };
  }
  if (clean.metadata.tags) clean.metadata = { ...clean.metadata, tags: [...new Set(clean.metadata.tags)].sort() };
  if (clean.spec.targets) clean.spec = { ...clean.spec, targets: [...new Set(clean.spec.targets)].sort() };
  const { unknown, ...rest } = clean;
  let text = stringifyYaml(unknown ? { ...rest, unknown } : rest, {
    sortMapEntries: false,
    lineWidth: 100,
  });
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

/** Round-trip stability: same object serializes identically (M1-02). */
export function frontmatterRoundTrip(md: string): { frontmatter: Record<string, unknown>; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!match) return undefined;
  try {
    return { frontmatter: parseYaml(match[1]!) as Record<string, unknown>, body: match[2] ?? '' };
  } catch {
    return undefined;
  }
}

export function serializeRuleFragment(fm: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(fm, { lineWidth: 100 })}---\n${body.startsWith('\n') || body === '' ? body : `\n${body}`}`;
}

export function unifiedDiff(oldText: string, newText: string, path: string): string {
  if (oldText === newText) return '';
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, oldText, newText, undefined, undefined, { context: 3 });
}

export interface DraftChangeInput {
  repoRelativePath: string;
  operation: 'create' | 'update' | 'archive';
  content: string;
  oldContent?: string;
}

/**
 * Build a ChangeSet from draft changes. Validates allowlist paths, computes
 * hashes and unified diffs (CAT-007, ADR-008).
 */
export function buildChangeSet(
  repoRoot: string,
  reason: string,
  changes: DraftChangeInput[],
): { changeSet?: ChangeSetValue; errors: string[] } {
  const errors: string[] = [];
  const fileChanges: FileChangeValue[] = [];
  for (const change of changes) {
    const check = checkRepoRelativePath(repoRoot, change.repoRelativePath);
    if (!check.ok) {
      errors.push(`path rejected (${check.reason}): ${change.repoRelativePath}`);
      continue;
    }
    if (!isAllowedWritePath(change.repoRelativePath)) {
      errors.push(`path not in write allowlist: ${change.repoRelativePath}`);
      continue;
    }
    fileChanges.push({
      operation: change.operation,
      repoRelativePath: change.repoRelativePath.split('\\').join('/'),
      expectedOldHash: change.oldContent !== undefined ? sha256Hex(change.oldContent) : undefined,
      newHash: sha256Hex(change.content),
      unifiedDiff: unifiedDiff(change.oldContent ?? '', change.content, change.repoRelativePath),
      content: change.content,
    });
  }
  if (errors.length > 0 || fileChanges.length === 0) return { errors };
  return {
    changeSet: {
      changeSetId: `cs-${randomBytes(8).toString('hex')}`,
      createdAt: new Date().toISOString(),
      reason,
      changes: fileChanges,
      status: 'draft',
    },
    errors: [],
  };
}

export interface ApplyResult {
  ok: boolean;
  applied: string[];
  conflicts: Array<{ path: string; reason: string }>;
  recovered: string[];
  /** SEC-102: entries that could not be restored safely — journal is kept. */
  manualRecoveryRequired: string[];
}

/**
 * Apply a ChangeSet atomically with expected-hash verification, temp file +
 * rename, and a journal for multi-file recovery (GIT-005, CATALOG_SPEC §11).
 */
export async function applyChangeSet(repoRoot: string, changeSet: ChangeSetValue): Promise<ApplyResult> {
  const applied: string[] = [];
  const conflicts: ApplyResult['conflicts'] = [];
  const recovered: string[] = [];
  const manualRecoveryRequired: string[] = [];
  const journal: Array<{ path: string; backup: string | null }> = [];
  const journalPath = join(repoRoot, '.aitp', `journal-${changeSet.changeSetId}.json`);
  await fs.mkdir(join(repoRoot, '.aitp'), { recursive: true });

  const complete = async () => {
    await fs.writeFile(journalPath, JSON.stringify({ status: 'done', changeSetId: changeSet.changeSetId }), 'utf8');
  };

  for (const change of changeSet.changes) {
    const check = checkRepoRelativePath(repoRoot, change.repoRelativePath);
    if (!check.ok || !isAllowedWritePath(change.repoRelativePath)) {
      conflicts.push({ path: change.repoRelativePath, reason: check.reason ?? 'allowlist' });
      continue;
    }
    // SEC-002: realpath/junction containment for the write target.
    const safe = await resolveSafeWritePath(repoRoot, change.repoRelativePath);
    if (!safe.ok) {
      conflicts.push({ path: change.repoRelativePath, reason: `safe-path:${safe.code}` });
      continue;
    }
    const resolved = safe.absolute;
    let oldContent: string | null = null;
    try {
      oldContent = await fs.readFile(resolved, 'utf8');
    } catch {
      oldContent = null;
    }
    const oldHash = oldContent !== null ? createHash('sha256').update(oldContent).digest('hex') : null;
    if (change.expectedOldHash !== undefined && oldHash !== change.expectedOldHash) {
      conflicts.push({ path: change.repoRelativePath, reason: 'hash-conflict' });
      continue;
    }
    if (change.operation === 'update' && oldContent === null) {
      conflicts.push({ path: change.repoRelativePath, reason: 'missing-target' });
      continue;
    }
    if (change.operation === 'create' && oldContent !== null) {
      conflicts.push({ path: change.repoRelativePath, reason: 'already-exists' });
      continue;
    }
    journal.push({ path: change.repoRelativePath, backup: oldContent });
    await fs.writeFile(journalPath, JSON.stringify({ status: 'in-progress', journal }), 'utf8');

    const content = change.operation === 'archive' ? archiveContent(change.content ?? '') : change.content ?? '';
    const tmp = join(dirname(resolved), `.${randomBytes(6).toString('hex')}.tmp`);
    await fs.mkdir(dirname(resolved), { recursive: true });
    try {
      await fs.writeFile(tmp, content, 'utf8');
      // Re-parse before replacing (schema re-check step).
      if (change.repoRelativePath.endsWith('.yaml')) {
        const reParsed = parseYaml(content);
        if (!reParsed || typeof reParsed !== 'object') throw new Error('re-parse failed');
      }
      // SEC-002: recheck the parent containment immediately before rename
      // (write-after-check race guard).
      const recheck = await resolveSafeWritePath(repoRoot, change.repoRelativePath);
      if (!recheck.ok) throw new Error(`safe-path recheck failed: ${recheck.code}`);
      await fs.rename(tmp, recheck.absolute);
      // Post-write verification: realpath still contained and hash matches.
      const written = await fs.readFile(recheck.absolute, 'utf8');
      const realCheck = await resolveSafeReadPath(repoRoot, change.repoRelativePath, { mode: 'file' });
      if (!realCheck.ok) throw new Error(`post-write containment failed: ${realCheck.code}`);
      if (createHash('sha256').update(written).digest('hex') !== change.newHash) {
        throw new Error('post-write hash mismatch');
      }
      applied.push(change.repoRelativePath);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      conflicts.push({ path: change.repoRelativePath, reason: `write-failed:${String(e)}` });
      break;
    }
  }

  const allOk = conflicts.length === 0 && applied.length === changeSet.changes.length;
  if (!allOk) {
    // SEC-102: rollback goes through SafePath like the forward path — an
    // attacker swapping a parent directory for a junction between failure and
    // rollback must not cause out-of-repo writes. Unsafe entries are reported
    // as MANUAL_RECOVERY_REQUIRED and the journal is kept for inspection.
    for (const entry of [...journal].reverse()) {
      const safe = await resolveSafeWritePath(repoRoot, entry.path);
      if (!safe.ok) {
        manualRecoveryRequired.push(`${entry.path} (${safe.code})`);
        continue;
      }
      if (entry.backup === null) {
        await fs.rm(safe.absolute, { force: true });
        // Rollback of a create: success means the file is gone again.
        const verify = await resolveSafeReadPath(repoRoot, entry.path, { mode: 'file' });
        if (verify.ok) {
          manualRecoveryRequired.push(`${entry.path} (post-restore verify: file still present)`);
          continue;
        }
      } else {
        await fs.writeFile(safe.absolute, entry.backup, 'utf8');
        const verify = await resolveSafeReadPath(repoRoot, entry.path, { mode: 'file' });
        if (!verify.ok) {
          manualRecoveryRequired.push(`${entry.path} (post-restore verify: ${verify.code})`);
          continue;
        }
      }
      recovered.push(entry.path);
    }
  }
  await complete();
  if (manualRecoveryRequired.length > 0) {
    // Keep the journal so an operator can recover manually.
    await fs.writeFile(journalPath, JSON.stringify({ status: 'manual-recovery-required', changeSetId: changeSet.changeSetId, manualRecoveryRequired }), 'utf8');
  }
  return { ok: allOk, applied, conflicts, recovered, manualRecoveryRequired };
}

function archiveContent(content: string): string {
  return content.replace(/^archived: false$/m, 'archived: true').replace(/^(archived:)/m, 'archived: true');
}

/**
 * Read/serialize `sources.lock.yaml` (CATALOG_SPEC §8). Offline keeps stale
 * values; AI never writes this file.
 */
export interface SourcesLock {
  apiVersion: string;
  sources: Record<
    string,
    {
      type: string;
      url: string;
      requestedRef?: string;
      resolvedRevision?: string;
      verifiedAt?: string;
      contentDigest?: string;
      stale?: boolean;
    }
  >;
}

export async function readSourcesLock(repoRoot: string): Promise<SourcesLock> {
  try {
    const text = await fs.readFile(join(repoRoot, 'sources.lock.yaml'), 'utf8');
    return parseYaml(text) as SourcesLock;
  } catch {
    return { apiVersion: API_VERSION, sources: {} };
  }
}

export function serializeSourcesLock(lock: SourcesLock): string {
  return stringifyYaml(lock, { lineWidth: 100 });
}

/** In-memory catalog store over a repo root (test + read paths). */
export class FileSystemCatalogStore implements CatalogStore {
  constructor(private readonly repoRoot: string) {}

  async readEntry(repoRelativePath: string): Promise<CatalogEntryValue | undefined> {
    const raw = await this.loadRaw(repoRelativePath);
    if (raw === undefined) return undefined;
    return parseCatalogYaml(raw, repoRelativePath).entry;
  }

  async listEntries(): Promise<Array<{ repoRelativePath: string; entry: CatalogEntryValue }>> {
    const out: Array<{ repoRelativePath: string; entry: CatalogEntryValue }> = [];
    const walk = async (rel: string) => {
      let entries;
      try {
        entries = await fs.readdir(join(this.repoRoot, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const child = `${rel}${e.name}${e.isDirectory() ? '/' : ''}`;
        if (e.isDirectory()) await walk(child);
        else if (e.name.endsWith('.yaml') || e.name.endsWith('.md')) {
          const entry = await this.readEntry(`${rel}${e.name}`);
          if (entry) out.push({ repoRelativePath: `${rel}${e.name}`, entry });
        }
      }
    };
    await walk('catalog/');
    return out;
  }

  async loadRaw(repoRelativePath: string): Promise<string | undefined> {
    // SEC-001/002: catalog reads are restricted to catalog/ files that resolve
    // (realpath) inside the repo root — traversal and junction escapes fail.
    const safe = await resolveSafeReadPath(this.repoRoot, repoRelativePath, {
      prefixes: ['catalog/'],
      extensions: ['.yaml', '.yml', '.md'],
      mode: 'file',
    });
    if (!safe.ok) return undefined;
    try {
      return await fs.readFile(safe.absolute, 'utf8');
    } catch {
      return undefined;
    }
  }
}

export * from './sources-lock.js';
