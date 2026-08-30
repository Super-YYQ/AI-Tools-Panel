/**
 * sources.lock resolver (M5-07, CATALOG_SPEC §8). v1 is offline-deterministic:
 * remote resolution requires explicit online mode; offline runs keep the last
 * known values and mark them stale — never clearing revisions.
 */
import type { SourcesLock } from './index.js';
import { sha256Hex } from './hash.js';

export interface ResolveOptions {
  /** v1 default false: no network I/O from panel flows (NFR-007). */
  online?: boolean;
  now?: string;
}

export interface ResolvedSource {
  key: string;
  type: string;
  url: string;
  requestedRef?: string;
  resolvedRevision?: string;
  verifiedAt?: string;
  contentDigest?: string;
  stale?: boolean;
}

/**
 * Re-validate a lock file. Offline: every source keeps revision + digest and
 * gains `stale: true`. Online resolver for git URLs arrives with M5-07 remote
 * support; attempting it without a network implementation raises a stable
 * error instead of silently degrading.
 */
export function resolveSourcesLock(lock: SourcesLock, options: ResolveOptions = {}): { sources: Record<string, ResolvedSource>; changed: boolean } {
  const now = options.now ?? new Date().toISOString();
  const out: Record<string, ResolvedSource> = {};
  let changed = false;
  for (const [key, src] of Object.entries(lock.sources ?? {})) {
    if (options.online) {
      throw new Error('REMOTE_RESOLVER_UNAVAILABLE: online source resolution is not enabled in v1');
    }
    const stale = src.resolvedRevision !== undefined;
    out[key] = {
      key,
      type: src.type,
      url: src.url,
      requestedRef: src.requestedRef,
      resolvedRevision: src.resolvedRevision,
      verifiedAt: src.verifiedAt,
      contentDigest: src.contentDigest ?? `sha256:${sha256Hex(`${src.url}@${src.resolvedRevision ?? ''}`)}`,
      stale: stale ? true : undefined,
    };
    if (stale && !src.stale) changed = true;
  }
  void now;
  return { sources: out, changed };
}

/** Serialize resolved sources back into the lock shape without clearing data. */
export function applyResolvedToLock(lock: SourcesLock, resolved: Record<string, ResolvedSource>): SourcesLock {
  const sources: SourcesLock['sources'] = {};
  for (const [key, r] of Object.entries(resolved)) {
    sources[key] = {
      type: r.type,
      url: r.url,
      requestedRef: r.requestedRef,
      resolvedRevision: r.resolvedRevision,
      verifiedAt: r.verifiedAt,
      contentDigest: r.contentDigest,
      stale: r.stale,
    };
  }
  return { apiVersion: lock.apiVersion, sources };
}
