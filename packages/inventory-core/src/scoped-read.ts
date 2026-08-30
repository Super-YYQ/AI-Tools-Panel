/**
 * SEC-101: scoped, symlink-safe read used by provider scanners. Replaces bare
 * readTextCapped for repo- and user-scope candidate files.
 *
 * Containment strategy: walk the ancestor chain with lstat — if no component
 * is a link, the path is literally inside the (realpathed) scope root. Only
 * when a link component exists do we realpath that link and verify it stays
 * inside the root. This keeps the hot scan path cheap (no per-file realpath).
 */
import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve, dirname } from 'node:path';

export type ScopedReadCode =
  | 'not-found'
  | 'too-large'
  | 'symlink-outside-root'
  | 'not-a-file'
  | 'access-denied';

export type ScopedReadResult =
  | { ok: true; content: string; size: number; mtimeMs: number }
  | { ok: false; code: ScopedReadCode };

type Containment = { kind: 'ok' } | { kind: 'escape' } | { kind: 'denied' } | { kind: 'missing' };

/**
 * Per-directory containment verdict cache. Directories shared by many
 * candidates (e.g. `.claude`, `skills`) are checked once; unique leaf
 * directories are checked once per scan. Bounded to keep memory flat.
 */
const DIR_VERDICT_CACHE = new Map<string, Containment>();
const DIR_VERDICT_CACHE_MAX = 50_000;
const ROOT_REAL_CACHE = new Map<string, string>();

async function dirVerdict(rootReal: string, dir: string): Promise<Containment | undefined> {
  const cached = DIR_VERDICT_CACHE.get(dir);
  if (cached) return cached;
  let verdict: Containment;
  try {
    const lstat = await fs.lstat(dir);
    if (lstat.isSymbolicLink()) {
      try {
        const real = await fs.realpath(dir);
        const rel = relative(rootReal, real);
        verdict = rel.startsWith('..') || isAbsolute(rel) ? { kind: 'escape' } : { kind: 'ok' };
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        verdict = code === 'EACCES' || code === 'EPERM' ? { kind: 'denied' } : { kind: 'escape' };
      }
    } else {
      verdict = { kind: 'ok' };
    }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    verdict = code === 'ENOENT' ? { kind: 'missing' } : code === 'EACCES' || code === 'EPERM' ? { kind: 'denied' } : { kind: 'escape' };
  }
  if (DIR_VERDICT_CACHE.size >= DIR_VERDICT_CACHE_MAX) DIR_VERDICT_CACHE.clear();
  DIR_VERDICT_CACHE.set(dir, verdict);
  return verdict;
}

/** Verify no ancestor component (target itself included) is a link escaping root. */
async function checkLinkContainment(rootReal: string, root: string, target: string): Promise<Containment> {
  let current = target;
  const rootResolved = resolve(root);
  for (let guard = 0; guard < 64; guard++) {
    if (current.length <= rootResolved.length) break;
    const isTarget = current === target;
    const verdict = await dirVerdict(rootReal, current);
    if (verdict && verdict.kind !== 'ok') return verdict;
    if (isTarget && verdict === undefined) return { kind: 'missing' };
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { kind: 'ok' };
}

/** Read a candidate file within a scope root (SEC-101). */
export async function readScopedTextCapped(params: {
  root: string;
  path: string;
  maxBytes?: number;
  allowLinks?: boolean;
}): Promise<ScopedReadResult> {
  const maxBytes = params.maxBytes ?? 512 * 1024;
  const allowLinks = params.allowLinks ?? false;
  const target = resolve(params.root, params.path);
  let rootReal = ROOT_REAL_CACHE.get(params.root);
  if (rootReal === undefined) {
    try {
      rootReal = await fs.realpath(params.root);
    } catch {
      return { ok: false, code: 'not-found' };
    }
    ROOT_REAL_CACHE.set(params.root, rootReal);
  }

  try {
    const lstat = await fs.lstat(target);
    if (lstat.isSymbolicLink()) {
      // Rare path: the candidate itself is a link — full containment check
      // including the target, then decide whether reading through is allowed.
      const containment = await checkLinkContainment(rootReal, params.root, target);
      if (containment.kind === 'escape') return { ok: false, code: 'symlink-outside-root' };
      if (containment.kind === 'denied') return { ok: false, code: 'access-denied' };
      if (containment.kind === 'missing') return { ok: false, code: 'not-found' };
      if (allowLinks) return { ok: false, code: 'symlink-outside-root' };
      const stat = await fs.stat(target).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'EACCES' || e.code === 'EPERM') return { denied: true } as never;
        return undefined;
      });
      if (!stat || (stat as { denied?: boolean }).denied) return { ok: false, code: 'access-denied' };
      const s = stat as { isFile(): boolean; size: number; mtimeMs: number };
      if (!s.isFile()) return { ok: false, code: 'not-a-file' };
      if (s.size > maxBytes) return { ok: false, code: 'too-large' };
      return { ok: true, content: await fs.readFile(target, 'utf8'), size: s.size, mtimeMs: s.mtimeMs };
    }

    // Hot path: the target is not a link. Only the ANCESTORS need link
    // verification (the file itself cannot redirect reads).
    const containment = await checkLinkContainment(rootReal, params.root, dirname(target));
    if (containment.kind === 'escape') return { ok: false, code: 'symlink-outside-root' };
    if (containment.kind === 'denied') return { ok: false, code: 'access-denied' };
    if (containment.kind === 'missing') return { ok: false, code: 'not-found' };

    if (!lstat.isFile()) return { ok: false, code: 'not-a-file' };
    if (lstat.size > maxBytes) return { ok: false, code: 'too-large' };
    return { ok: true, content: await fs.readFile(target, 'utf8'), size: lstat.size, mtimeMs: lstat.mtimeMs };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, code: 'not-found' };
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, code: 'access-denied' };
    return { ok: false, code: 'not-found' };
  }
}

/** Map a scoped read failure to the stable diagnostic code (SCANNING_SPEC §10). */
export function scopedReadDiagnosticCode(code: ScopedReadCode): 'SYMLINK_OUTSIDE_ROOT' | 'FILE_TOO_LARGE' | 'ACCESS_DENIED' | 'ROOT_NOT_FOUND' {
  switch (code) {
    case 'symlink-outside-root':
      return 'SYMLINK_OUTSIDE_ROOT';
    case 'too-large':
      return 'FILE_TOO_LARGE';
    case 'access-denied':
      return 'ACCESS_DENIED';
    default:
      return 'ROOT_NOT_FOUND';
  }
}
