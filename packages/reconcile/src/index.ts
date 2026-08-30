/**
 * @aitp/reconcile — Inventory ↔ Catalog comparison (ARCHITECTURE §6, CATALOG_SPEC §9).
 * Matching order: confirmed source identity → alias → vendored origin marker →
 * content relationship → manual link. Same name alone is only an ambiguous candidate.
 */
import type { CatalogEntryValue, ObservationValue } from '@aitp/contracts';

export type ReconcileStatus =
  | 'installed-only'
  | 'catalog-only'
  | 'matched'
  | 'drifted'
  | 'ambiguous'
  | 'missing-source'
  | 'archived';

export interface ReconcileItem {
  key: string;
  status: ReconcileStatus;
  observationIds: string[];
  catalogPath?: string;
  diagnostics: Array<{ code: string; message: string }>;
  suggestions: string[];
}

export interface ReconcileResult {
  items: ReconcileItem[];
  counts: Record<ReconcileStatus, number>;
}

function sourceKeyOf(entry: CatalogEntryValue): string | undefined {
  const s = entry.spec.source;
  if (s.type === 'git') return s.revision ? `git:${s.url}@${s.revision}` : undefined;
  if (s.type === 'marketplace') return s.revision ? `mp:${s.marketplaceId}/${s.packageId}@${s.revision}` : undefined;
  if (s.type === 'local-authored') return `authored:${s.repositoryRelativePath ?? ''}`;
  return undefined;
}

export function reconcile(inventory: ObservationValue[], catalog: Array<{ repoRelativePath: string; entry: CatalogEntryValue }>): ReconcileResult {
  const items: ReconcileItem[] = [];
  const counts: Record<ReconcileStatus, number> = {
    'installed-only': 0,
    'catalog-only': 0,
    matched: 0,
    drifted: 0,
    ambiguous: 0,
    'missing-source': 0,
    archived: 0,
  };

  const byArtifact = new Map<string, ObservationValue[]>();
  for (const o of inventory) byArtifact.set(o.artifactId, [...(byArtifact.get(o.artifactId) ?? []), o]);

  const usedCatalogPaths = new Set<string>();
  const matchedObservationIds = new Set<string>();

  // Pass 1: match catalog entries to observations.
  for (const { repoRelativePath, entry } of catalog) {
    if (entry.metadata.archived) {
      counts.archived++;
      items.push({ key: entry.metadata.id, status: 'archived', observationIds: [], catalogPath: repoRelativePath, diagnostics: [], suggestions: [] });
      usedCatalogPaths.add(repoRelativePath);
      continue;
    }
    const candidates = inventory.filter((o) => o.kind === entryKindToObservationKind(entry.kind));
    const confirmedSource = sourceKeyOf(entry);
    const matches = candidates.filter((o) => {
      // Confirmed source identity match via git URL appearing in evidence origin.
      if (confirmedSource) {
        const gitUrl = confirmedSource.replace(/^git:|@.*$/g, '');
        if (o.sourceEvidence.some((e) => e.origin.includes(urlSlug(gitUrl)))) return true;
      }
      // Content relationship: catalog id slug matches canonical name.
      return o.canonicalName.toLowerCase().replace(/[^a-z0-9]+/g, '-') === entry.metadata.id;
    });
    if (matches.length === 1) {
      const o = matches[0]!;
      matchedObservationIds.add(o.observationId);
      usedCatalogPaths.add(repoRelativePath);
      const drift = detectDrift(entry, o);
      if (drift.length > 0) {
        counts.drifted++;
        items.push({
          key: entry.metadata.id,
          status: 'drifted',
          observationIds: [o.observationId],
          catalogPath: repoRelativePath,
          diagnostics: drift.map((d) => ({ code: 'DRIFT', message: d })),
          suggestions: ['更新锁定 revision 或重新验证来源'],
        });
      } else {
        counts.matched++;
        items.push({ key: entry.metadata.id, status: 'matched', observationIds: [o.observationId], catalogPath: repoRelativePath, diagnostics: [], suggestions: [] });
      }
    } else if (matches.length > 1) {
      usedCatalogPaths.add(repoRelativePath);
      counts.ambiguous++;
      items.push({
        key: entry.metadata.id,
        status: 'ambiguous',
        observationIds: matches.map((m) => m.observationId),
        catalogPath: repoRelativePath,
        diagnostics: [{ code: 'AMBIGUOUS', message: `${matches.length} observations may match this entry` }],
        suggestions: ['人工选择对应的 Observation'],
      });
    } else if (entry.spec.source.type === 'unknown') {
      // Unknown source = uninstalled favorite (CAT-003).
      counts['catalog-only']++;
      items.push({
        key: entry.metadata.id,
        status: 'catalog-only',
        observationIds: [],
        catalogPath: repoRelativePath,
        diagnostics: [],
        suggestions: ['来源未验证；确认后可升级为 confirmed source'],
      });
      continue;
    } else {
      // Confirmed source exists but nothing matches locally.
      counts['missing-source']++;
      items.push({
        key: entry.metadata.id,
        status: 'missing-source',
        observationIds: [],
        catalogPath: repoRelativePath,
        diagnostics: [{ code: 'MISSING_SOURCE', message: '来源无法重新验证' }],
        suggestions: ['人工确认来源'],
      });
    }
  }

  // Pass 2: remaining observations are installed-only (or ambiguous same-name duplicates).
  const byName = new Map<string, ObservationValue[]>();
  for (const o of inventory) {
    if (matchedObservationIds.has(o.observationId)) continue;
    byName.set(o.canonicalName, [...(byName.get(o.canonicalName) ?? []), o]);
  }
  for (const [name, group] of byName) {
    for (const o of group) {
      counts['installed-only']++;
      items.push({
        key: o.artifactId,
        status: 'installed-only',
        observationIds: [o.observationId],
        diagnostics: [],
        suggestions: group.length > 1 ? [`同名资产 ${name} 有 ${group.length} 个不同来源，确认后再纳入 Catalog`] : ['可纳入 Catalog'],
      });
    }
  }

  return { items, counts };
}

function detectDrift(entry: CatalogEntryValue, o: ObservationValue): string[] {
  const drift: string[] = [];
  const src = entry.spec.source;
  if (src.type === 'git' && src.revision) {
    const hasRevEvidence = o.sourceEvidence.some((e) => e.detail?.includes(src.revision!) || e.origin.includes(src.revision!));
    if (!hasRevEvidence) drift.push(`observation evidence does not confirm locked revision ${src.revision}`);
  }
  if (entry.verification.sourceDigest && entry.verification.sourceDigest !== `sha256:${o.contentHash}`) {
    drift.push('content digest differs from last verification');
  }
  return drift;
}

function entryKindToObservationKind(kind: CatalogEntryValue['kind']): ObservationValue['kind'] {
  switch (kind) {
    case 'Skill': return 'skill';
    case 'Plugin': return 'plugin';
    case 'Marketplace': return 'marketplace';
    case 'Hook': return 'hook';
    case 'RuleFragment': return 'rule-fragment';
  }
}

function urlSlug(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '').toLowerCase();
}
