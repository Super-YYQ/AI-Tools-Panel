import { describe, it, expect } from 'vitest';
import {
  Observation,
  ChangeSet,
  AnalysisProposal,
  CatalogEntry,
  DiagnosticCode,
  API_VERSION,
} from '@aitp/contracts';

// M0-04 — schema contracts accept valid and reject invalid documents.
describe('contracts schema', () => {
  it('accepts a minimal valid observation', () => {
    const parsed = Observation.safeParse({
      observationId: 'obs-1',
      artifactId: 'skill-code-review',
      provider: 'claude-code',
      kind: 'skill',
      scope: 'user',
      canonicalName: 'code-review',
      location: { pathToken: '~/.claude/skills/code-review/SKILL.md', scope: 'user' },
      contentHash: 'abc',
      discoveredAt: '2026-01-01T00:00:00Z',
      parser: { name: 'x', version: '1' },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects observation with unknown provider', () => {
    expect(
      Observation.safeParse({
        observationId: 'obs-1',
        artifactId: 'x',
        provider: 'cursor',
        kind: 'skill',
        scope: 'user',
        canonicalName: 'x',
        location: { pathToken: 'a', scope: 'user' },
        contentHash: 'h',
        discoveredAt: 't',
        parser: { name: 'x', version: '1' },
      }).success,
    ).toBe(false);
  });

  it('ChangeSet only allows create|update|archive (ADR-008)', () => {
    const base = { changeSetId: 'cs', createdAt: 't', reason: 'r', changes: [] };
    expect(ChangeSet.safeParse({ ...base, changes: [{ operation: 'delete', repoRelativePath: 'x', newHash: 'h', unifiedDiff: '' }] }).success).toBe(false);
    expect(ChangeSet.safeParse({ ...base, changes: [{ operation: 'create', repoRelativePath: 'x', newHash: 'h', unifiedDiff: '' }] }).success).toBe(true);
  });

  it('AnalysisProposal requires confidence and evidence per claim', () => {
    const proposal = {
      proposalId: 'p1',
      artifactId: 'a',
      task: 'summary',
      claims: [{ field: 'tags', value: ['x'], confidence: 0.8, evidence: [{ type: 'manifest', origin: 'o' }] }],
      provider: 'test',
      createdAt: 't',
      inputDigest: 'd',
    };
    expect(AnalysisProposal.safeParse(proposal).success).toBe(true);
    expect(AnalysisProposal.safeParse({ ...proposal, claims: [{ field: 'tags', value: ['x'], confidence: 2 }] }).success).toBe(false);
  });

  it('CatalogEntry preserves unknown fields (CAT-006)', () => {
    const entry = {
      apiVersion: API_VERSION,
      kind: 'Skill',
      metadata: { id: 'x', displayName: 'X' },
      spec: {},
    };
    const parsed = CatalogEntry.parse(entry);
    expect(parsed.overlay).toBeDefined();
    expect(DiagnosticCode.options.length).toBeGreaterThan(5);
  });
});
