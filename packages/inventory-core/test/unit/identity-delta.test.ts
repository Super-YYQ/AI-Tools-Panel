import { describe, it, expect } from 'vitest';
import {
  computeArtifactId,
  computeObservationId,
  sha256Hex,
  computeDelta,
  canTransitionRun,
  isTerminalRun,
  classifyDuplicates,
  sortCandidates,
} from '@aitp/inventory-core';
import type { Candidate, ObservationValue } from '@aitp/contracts';

// NFR-001 repeatability; SCAN-006 duplicates; ARCHITECTURE §6 state machine.
describe('identity', () => {
  it('same inputs produce identical artifact and observation IDs', () => {
    const a = computeArtifactId('skill', 'code-review', 'git:https://github.com/example/skills@0123456789abcdef');
    const b = computeArtifactId('skill', 'code-review', 'git:https://github.com/example/skills@0123456789abcdef');
    expect(a.id).toBe(b.id);
    expect(a.provisional).toBe(false);
  });

  it('unknown source yields provisional content identity; path is never the ID', () => {
    const a = computeArtifactId('skill', 'mystery');
    expect(a.provisional).toBe(true);
    expect(computeObservationId('claude-code', 'user', 'C:\\Users\\yan\\.claude\\skills\\mystery', sha256Hex('x'))).toBe(
      computeObservationId('claude-code', 'user', 'c:/Users/yan/.claude/skills/mystery', sha256Hex('x')),
    );
  });
});

describe('delta (SCAN-009)', () => {
  const obs = (name: string, hash: string): ObservationValue => ({
    observationId: `obs-${name}`,
    artifactId: `skill-${name}`,
    provider: 'claude-code',
    kind: 'skill',
    scope: 'user',
    canonicalName: name,
    location: { pathToken: `~/.claude/skills/${name}`, scope: 'user' },
    copyRole: 'source',
    enabled: 'unknown',
    contentHash: hash,
    summary: {},
    sourceEvidence: [],
    related: [],
    discoveredAt: 't',
    parser: { name: 'x', version: '1' },
  });

  it('classifies added, changed, missing', () => {
    const prev = [obs('a', '1'), obs('b', '2')];
    const curr = [obs('b', '2x'), obs('c', '3')];
    const delta = computeDelta(prev, curr);
    expect(delta.added.map((o) => o.canonicalName)).toEqual(['c']);
    expect(delta.changed).toHaveLength(1);
    expect(delta.missing.map((o) => o.canonicalName)).toEqual(['a']);
  });
});

describe('scan run state machine', () => {
  it('allows only valid transitions; terminal runs cannot change', () => {
    expect(canTransitionRun('pending', 'running')).toBe(true);
    expect(canTransitionRun('running', 'partial')).toBe(true);
    expect(canTransitionRun('completed', 'running')).toBe(false);
    expect(isTerminalRun('failed')).toBe(true);
    expect(isTerminalRun('running')).toBe(false);
  });
});

describe('duplicate classification (SCAN-006)', () => {
  const obs = (id: string, artifact: string, name: string, hash: string, role = 'source'): ObservationValue => ({
    observationId: id,
    artifactId: artifact,
    provider: 'claude-code',
    kind: 'skill',
    scope: 'user',
    canonicalName: name,
    location: { pathToken: id, scope: 'user' },
    copyRole: role as ObservationValue['copyRole'],
    enabled: 'unknown',
    contentHash: hash,
    summary: {},
    sourceEvidence: [],
    related: [],
    discoveredAt: 't',
    parser: { name: 'x', version: '1' },
  });

  it('same content at different places is a same-content candidate, not silently merged', () => {
    const relations = classifyDuplicates([obs('o1', 'a1', 'dup', 'h1'), obs('o2', 'a2', 'dup', 'h1')]);
    expect(relations).toContainEqual({ type: 'same-content', members: ['o1', 'o2'] });
  });

  it('cache copy of same artifact is derived-copy', () => {
    const relations = classifyDuplicates([obs('o1', 'a1', 'p', 'h1', 'source'), obs('o2', 'a1', 'p', 'h2', 'cache')]);
    expect(relations).toContainEqual({ type: 'derived-copy', members: ['o1', 'o2'] });
  });
});

describe('candidate ordering (SCANNING_SPEC §3)', () => {
  it('is deterministic and stable across calls', () => {
    const candidates: Candidate[] = [
      { provider: 'codex', kind: 'skill', scope: 'user', name: 'b', absolutePath: 'C:\\x\\b', copyRole: 'source' },
      { provider: 'claude-code', kind: 'plugin', scope: 'repo', name: 'z', absolutePath: 'C:\\x\\z', copyRole: 'source' },
      { provider: 'claude-code', kind: 'skill', scope: 'user', name: 'a', absolutePath: 'C:\\x\\a', copyRole: 'source' },
    ];
    const once = sortCandidates(candidates).map((c) => c.name);
    expect(once).toEqual(['a', 'z', 'b']);
    expect(sortCandidates(candidates).map((c) => c.name)).toEqual(once);
  });
});

describe('delta identity (FUN-102)', () => {
  const obsAt = (scope: string, token: string, name = 'code-review'): ObservationValue => ({
    observationId: `obs-${scope}-${token}`,
    artifactId: `skill-${name}`,
    provider: 'claude-code',
    kind: 'skill',
    scope: scope as ObservationValue['scope'],
    canonicalName: name,
    location: { pathToken: token, scope: scope as ObservationValue['scope'] },
    copyRole: 'source',
    enabled: 'unknown',
    contentHash: 'h',
    summary: {},
    sourceEvidence: [],
    related: [],
    discoveredAt: 't',
    parser: { name: 'x', version: '1' },
  });

  it('user and repo skills with the same name stay distinct delta entries', () => {
    const prev = [obsAt('user', '~/.claude/skills/code-review')];
    const curr = [obsAt('user', '~/.claude/skills/code-review'), obsAt('repo', '.claude/skills/code-review')];
    const delta = computeDelta(prev, curr);
    // FUN-102: the repo copy must appear as ADDED, not be collapsed by name.
    expect(delta.added).toHaveLength(1);
    expect(delta.added[0]!.scope).toBe('repo');
    expect(delta.changed).toHaveLength(0);
    expect(delta.missing).toHaveLength(0);
  });

  it('same name at different locations counts as added + missing across runs', () => {
    const prev = [obsAt('user', '~/.claude/skills/code-review')];
    const curr = [obsAt('user', 'C:/moved/.claude/skills/code-review')];
    const delta = computeDelta(prev, curr);
    expect(delta.added).toHaveLength(1);
    expect(delta.missing).toHaveLength(1);
  });
});

describe('privacy boundary (PRI-101/103)', () => {
  it('canonicalizeSourceUrl strips credentials, query and fragment', async () => {
    const { canonicalizeSourceUrl } = await import('@aitp/inventory-core');
    expect(canonicalizeSourceUrl('https://user:pass@internal.example/repo.git?token=x#frag')).toBe(
      'https://internal.example/repo',
    );
    expect(canonicalizeSourceUrl('https://github.com/example/skills/')).toBe('https://github.com/example/skills');
  });

  it('sanitizeObservation redacts credential URLs and name fields (PRI-101)', async () => {
    const { sanitizeObservation } = await import('@aitp/inventory-core');
    const obs = {
      observationId: 'o',
      artifactId: 'a',
      provider: 'claude-code',
      kind: 'plugin',
      scope: 'repo',
      canonicalName: 'plugin user@corp.example',
      sourceIdentity: { type: 'git', canonicalUrl: 'https://user:secretpw@internal.example/repo.git' },
      location: { pathToken: 'p', scope: 'repo' },
      copyRole: 'source',
      enabled: 'unknown',
      contentHash: 'h',
      summary: { manifestName: 'p' },
      sourceEvidence: [{ type: 'manifest', origin: 'C:\\Users\\yan\\leak' }],
      related: [],
      discoveredAt: 't',
      parser: { name: 'p', version: '1' },
    } as never;
    const clean = sanitizeObservation(obs);
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toContain('secretpw');
    expect(serialized).not.toContain('user@corp.example');
    expect(serialized).not.toContain('yan');
    expect(clean.sourceIdentity.canonicalUrl).toBe('https://internal.example/repo');
  });

  it('sanitizeProposal redacts claim values before persistence (PRI-103)', async () => {
    const { sanitizeProposal } = await import('@aitp/inventory-core');
    const proposal = {
      proposalId: 'p1',
      artifactId: 'a',
      task: 'tags',
      claims: [{ field: 'tags', value: 'sk-example000000000000000', confidence: 0.8, evidence: [{ type: 'x', origin: 'y' }] }],
      provider: 'test',
      createdAt: 't',
      inputDigest: 'd',
      status: 'pending',
    } as never;
    const clean = sanitizeProposal(proposal);
    expect(JSON.stringify(clean)).not.toContain('sk-example000000000000000');
  });
});
