import { describe, it, expect } from 'vitest';
import { resolveSourcesLock, applyResolvedToLock, type SourcesLock } from '@aitp/catalog';

// M5-07: offline resolver keeps revisions and marks stale; never clears data (CATALOG_SPEC §8).
const lock: SourcesLock = {
  apiVersion: 'aitp.dev/v1alpha1',
  sources: {
    'example-skills': {
      type: 'git',
      url: 'https://github.com/example/skills',
      requestedRef: 'v1.2.0',
      resolvedRevision: '0123456789abcdef',
      verifiedAt: '2026-08-29T00:00:00Z',
      contentDigest: 'sha256:example',
    },
  },
};

describe('sources.lock resolver', () => {
  it('offline run keeps revision/digest and marks stale', () => {
    const { sources, changed } = resolveSourcesLock(lock);
    const s = sources['example-skills']!;
    expect(s.resolvedRevision).toBe('0123456789abcdef');
    expect(s.stale).toBe(true);
    expect(changed).toBe(true);
  });

  it('never clears revisions, even with missing digest', () => {
    const sparse: SourcesLock = {
      apiVersion: 'aitp.dev/v1alpha1',
      sources: { x: { type: 'git', url: 'https://github.com/example/x', resolvedRevision: 'abc123' } },
    };
    const { sources } = resolveSourcesLock(sparse);
    expect(sources.x!.resolvedRevision).toBe('abc123');
    expect(sources.x!.contentDigest).toMatch(/^sha256:/);
  });

  it('online resolution without a remote implementation raises a stable error', () => {
    expect(() => resolveSourcesLock(lock, { online: true })).toThrowError(/REMOTE_RESOLVER_UNAVAILABLE/);
  });

  it('applyResolvedToLock round-trips without data loss', () => {
    const { sources } = resolveSourcesLock(lock);
    const next = applyResolvedToLock(lock, sources);
    expect(next.sources['example-skills']!.resolvedRevision).toBe('0123456789abcdef');
    expect(next.sources['example-skills']!.stale).toBe(true);
    expect(next.apiVersion).toBe(lock.apiVersion);
  });
});
