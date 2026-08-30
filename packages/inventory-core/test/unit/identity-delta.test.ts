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
