/**
 * SafePath API (SEC-001/SEC-002): every filesystem read/write on repo content
 * must go through these resolvers. Checks are layered:
 *   lexical (repo-relative, no `..`, no drive/UNC/ADS)
 *   → allowlist prefix / extension
 *   → realpath containment of the nearest existing ancestor
 *   → final-target regular-file (read) / not-a-link (write) validation
 * Business code must never call join(root, input) directly.
 */
import { promises as fs } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export type SafePathCode =
  | 'EMPTY_PATH'
  | 'ABSOLUTE_PATH'
  | 'TRAVERSAL'
  | 'DEVICE_PATH'
  | 'ADS'
  | 'OUTSIDE_ROOT'
  | 'PREFIX_NOT_ALLOWED'
  | 'EXTENSION_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'NOT_A_FILE'
  | 'NOT_A_DIRECTORY'
  | 'PATH_IS_LINK'
  | 'ESCAPES_ROOT';

export type SafePathResult =
  | { ok: true; absolute: string }
  | { ok: false; code: SafePathCode };

export interface SafePathOptions {
  /** Repo-relative prefixes the path must start with, e.g. ['catalog/']. */
  prefixes?: string[];
  /** Allowed file extensions (with dot), e.g. ['.yaml', '.md']. */
  extensions?: string[];
  /** Expect the final target to be a regular file (read) or a directory. */
  mode?: 'file' | 'directory' | 'any';
}

function lexicalCheck(root: string, input: string): SafePathResult {
  if (!input || input.trim() === '') return { ok: false, code: 'EMPTY_PATH' };
  if (/^[a-zA-Z]:/.test(input) || input.startsWith('\\\\') || input.startsWith('//')) return { ok: false, code: 'DEVICE_PATH' };
  if (isAbsolute(input)) return { ok: false, code: 'ABSOLUTE_PATH' };
  const segments = input.split(/[\\/]/);
  if (segments.some((s) => s === '..')) return { ok: false, code: 'TRAVERSAL' };
  if (input.includes(':')) return { ok: false, code: 'ADS' };
  const resolved = resolve(root, input);
  const rel = relative(resolve(root), resolved);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, code: 'OUTSIDE_ROOT' };
  return { ok: true, absolute: resolved };
}

function normalized(input: string): string {
  return input.split('\\').join('/');
}

/** realpath containment: resolve the deepest existing ancestor inside root. */
async function containedRealPath(root: string, target: string): Promise<SafePathResult> {
  let probe = target;
  const rootReal = await fs.realpath(root).catch(() => resolve(root));
  // Walk up until an existing component is found.
  for (let guard = 0; guard < 64; guard++) {
    try {
      const real = await fs.realpath(probe);
      const rel = relative(rootReal, real);
      if (rel.startsWith('..') || isAbsolute(rel)) return { ok: false, code: 'ESCAPES_ROOT' };
      return { ok: true, absolute: target };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        const parent = resolve(probe, '..');
        if (parent === probe) return { ok: false, code: 'NOT_FOUND' };
        probe = parent;
        continue;
      }
      return { ok: false, code: 'ESCAPES_ROOT' };
    }
  }
  return { ok: false, code: 'NOT_FOUND' };
}

/** Read path: lexical → allowlist → realpath containment → regular file/dir. */
export async function resolveSafeReadPath(root: string, input: string, options: SafePathOptions = {}): Promise<SafePathResult> {
  const lexical = lexicalCheck(root, input);
  if (!lexical.ok) return lexical;
  const abs = lexical.absolute;
  const norm = normalized(input);
  if (options.prefixes && !options.prefixes.some((p) => norm === p.replace(/\/$/, '') || norm.startsWith(p))) {
    return { ok: false, code: 'PREFIX_NOT_ALLOWED' };
  }
  if (options.extensions && !options.extensions.some((e) => norm.toLowerCase().endsWith(e))) {
    return { ok: false, code: 'EXTENSION_NOT_ALLOWED' };
  }
  const contained = await containedRealPath(root, abs);
  if (!contained.ok) return contained;
  const mode = options.mode ?? 'file';
  if (mode !== 'any') {
    try {
      const real = await fs.realpath(abs);
      const st = await fs.stat(real);
      if (mode === 'file' && !st.isFile()) return { ok: false, code: 'NOT_A_FILE' };
      if (mode === 'directory' && !st.isDirectory()) return { ok: false, code: 'NOT_A_DIRECTORY' };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, code: 'NOT_FOUND' };
      return { ok: false, code: 'ESCAPES_ROOT' };
    }
  }
  return { ok: true, absolute: abs };
}

/**
 * Write path for targets that may not exist yet: lexical → allowlist →
 * realpath of nearest existing ancestor → reject writing through links.
 * Callers MUST re-run this immediately before rename (write-after-check).
 */
export async function resolveSafeWritePath(root: string, input: string, options: SafePathOptions = {}): Promise<SafePathResult> {
  const lexical = lexicalCheck(root, input);
  if (!lexical.ok) return lexical;
  const abs = lexical.absolute;
  const norm = normalized(input);
  if (options.prefixes && !options.prefixes.some((p) => norm === p.replace(/\/$/, '') || norm.startsWith(p))) {
    return { ok: false, code: 'PREFIX_NOT_ALLOWED' };
  }
  if (options.extensions && !options.extensions.some((e) => norm.toLowerCase().endsWith(e))) {
    return { ok: false, code: 'EXTENSION_NOT_ALLOWED' };
  }
  try {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) return { ok: false, code: 'PATH_IS_LINK' };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, code: 'ESCAPES_ROOT' };
  }
  return containedRealPath(root, abs);
}

export function safePathErrorCode(result: SafePathResult): string {
  return result.ok ? 'OK' : `PATH_${result.code}`;
}
