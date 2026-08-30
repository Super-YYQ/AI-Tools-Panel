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

  it('matched on identity match without drift', () => {
    const r = reconcile([obs()], [entry()]);
    expect(r.items[0]!.status).toBe('matched');
  });

  it('drifted when verification digest differs (ADR-009)', () => {
    const e = entry();
    e.entry.verification = { sourceDigest: 'sha256:different' };
    const r = reconcile([obs()], [e]);
    expect(r.items[0]!.status).toBe('drifted');
  });

  it('ambiguous when multiple observations share the catalog id', () => {
    const r = reconcile([obs({ observationId: 'o1' }), obs({ observationId: 'o2', scope: 'repo' })], [entry()]);
    expect(r.items[0]!.status).toBe('ambiguous');
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
