import { describe, it, expect } from 'vitest';
import { reconcile } from '@aitp/reconcile';
import type { CatalogEntryValue, ObservationValue } from '@aitp/contracts';

// ARCHITECTURE §6 status classification (M5-01).
const obs = (overrides: Partial<ObservationValue> = {}): ObservationValue => ({
  observationId: 'obs-1',
  artifactId: 'skill-code-review',
  provider: 'claude-code',
  kind: 'skill',
  scope: 'user',
  canonicalName: 'code-review',
  location: { pathToken: '~/.claude/skills/code-review', scope: 'user' },
  copyRole: 'source',
  enabled: 'unknown',
  contentHash: 'h1',
  summary: {},
  sourceEvidence: [],
  related: [],
  discoveredAt: 't',
  parser: { name: 'x', version: '1' },
  ...overrides,
});

const entry = (overrides: Partial<CatalogEntryValue> = {}): { repoRelativePath: string; entry: CatalogEntryValue } => ({
  repoRelativePath: 'catalog/skills/code-review.yaml',
  entry: {
    apiVersion: 'aitp.dev/v1alpha1',
    kind: 'Skill',
    metadata: { id: 'code-review', displayName: 'Code Review', shortDescription: '', tags: [], archived: false },
    spec: { targets: [], ownership: 'referenced', source: { type: 'unknown' }, license: { status: 'unknown' }, installInstructions: {}, contentPolicy: 'metadata-only', components: [] },
    overlay: { notes: '', fieldOrigins: {} },
    verification: {},
    ...overrides,
  } as CatalogEntryValue,
});

describe('reconcile statuses', () => {
  it('installed-only when inventory has and catalog lacks', () => {
    const r = reconcile([obs()], []);
    expect(r.items[0]!.status).toBe('installed-only');
    expect(r.counts['installed-only']).toBe(1);
  });

  it('catalog-only when catalog has and machine lacks', () => {
    const r = reconcile([], [entry()]);
    expect(r.items[0]!.status).toBe('catalog-only');
  });

  it('matched via content digest recorded at verification time (strategy 2)', () => {
    const e = entry();
    e.entry.verification = { sourceDigest: 'sha256:h1' };
    const r = reconcile([obs()], [e]);
    expect(r.items[0]!.status).toBe('matched');
  });

  it('matched via structured source identity (strategy 1, FUN-02)', () => {
    const o = obs({ sourceIdentity: { type: 'git', canonicalUrl: 'https://github.com/example/skills', revision: 'abc' } });
    const e = entry();
    e.entry.spec.source = { type: 'git', url: 'https://github.com/example/skills', revision: 'abc' };
    const r = reconcile([o], [e]);
    expect(r.items[0]!.status).toBe('matched');
  });

  it('matched via artifact id alias (strategy 3)', () => {
    // artifactId already is skill-code-review; alias matches by id.
    const r = reconcile([obs()], [entry()]);
    expect(r.items[0]!.status).toBe('matched');
  });

  it('name-only similarity never auto-matches — same-name is a suggestion (FUN-03)', () => {
    const e = entry();
    e.entry.verification = {};
    const r = reconcile([obs({ artifactId: 'skill-code-review-ab12cd34' })], [e]);
    // unknown source → catalog-only; the same-name observation is a suggestion.
    expect(r.items.find((i) => i.key === 'code-review')!.status).toBe('catalog-only');
    expect(r.items.find((i) => i.key === 'code-review')!.suggestions.join()).toContain('同名');
  });

  it('drifted when verification digest differs (ADR-009)', () => {
    const e = entry();
    e.entry.verification = { sourceDigest: 'sha256:different' };
    e.entry.spec.source = { type: 'git', url: 'https://github.com/example/skills', revision: 'abc' };
    const o = obs({ sourceIdentity: { type: 'git', canonicalUrl: 'https://github.com/example/skills', revision: 'abc' } });
    const r = reconcile([o], [e]);
    expect(r.items[0]!.status).toBe('drifted');
  });

  it('ambiguous when multiple observations match by alias', () => {
    const r = reconcile([obs({ observationId: 'o1' }), obs({ observationId: 'o2', scope: 'repo', location: { pathToken: 'p2', scope: 'repo' } })], [entry()]);
    expect(r.items[0]!.status).toBe('ambiguous');
  });

  it('url-source favorite with a same-name observation stays catalog-only (FUN-04)', () => {
    const e = entry();
    e.entry.spec.source = { type: 'url', url: 'https://example.com/x' };
    e.entry.metadata.id = 'other-name';
    const r = reconcile([obs()], [e]);
    expect(r.items[0]!.status).toBe('catalog-only');
  });

  it('archived entries are excluded from default matching (CAT-009)', () => {
    const e = entry();
    e.entry.metadata.archived = true;
    const r = reconcile([], [e]);
    expect(r.items[0]!.status).toBe('archived');
  });

  it('reconcile never writes files (CATALOG_SPEC §9)', () => {
    // Pure function — result contains no write operations.
    const r = reconcile([obs()], [entry()]);
    expect(JSON.stringify(r)).not.toContain('operation');
  });
});
