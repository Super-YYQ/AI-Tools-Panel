/**
 * @aitp/reconcile — Inventory ↔ Catalog comparison (ARCHITECTURE §6, CATALOG_SPEC §9).
 * v0.1.1 (FUN-03/04): deterministic match pipeline using structured evidence —
 *   1 confirmed structured source identity
 *   2 content digest relationship (verification.sourceDigest)
 *   3 alias (artifact id)
 *   4 name heuristic → suggestion only, never an automatic match
 * Uninstalled favorites (unknown/url source) are catalog-only, never
 * missing-source. Reconcile never writes files.
 */
import type { CatalogEntryValue, ObservationValue, SourceIdentityValue } from '@aitp/contracts';

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

function entryKindToObservationKind(kind: CatalogEntryValue['kind']): ObservationValue['kind'] {
  switch (kind) {
    case 'Skill': return 'skill';
    case 'Plugin': return 'plugin';
    case 'Marketplace': return 'marketplace';
    case 'Hook': return 'hook';
    case 'RuleFragment': return 'rule-fragment';
  }
}

function normalizeGitUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function identityMatches(entrySource: CatalogEntryValue['spec']['source'], obsIdentity: SourceIdentityValue): boolean {
  if (entrySource.type === 'git' && obsIdentity.type === 'git') {
    if (normalizeGitUrl(entrySource.url) !== normalizeGitUrl(obsIdentity.canonicalUrl ?? '')) return false;
    if (entrySource.revision && obsIdentity.revision && entrySource.revision !== obsIdentity.revision) return false;
    return true;
  }
  if (entrySource.type === 'marketplace' && obsIdentity.type === 'marketplace') {
    return entrySource.marketplaceId === obsIdentity.marketplaceId && entrySource.packageId === obsIdentity.packageId;
  }
  return false;
}

/** Strategy 1: confirmed structured source identity. */
function matchByIdentity(entry: CatalogEntryValue, candidates: ObservationValue[]): ObservationValue[] {
  if (entry.spec.source.type === 'unknown' || entry.spec.source.type === 'url' || entry.spec.source.type === 'local-authored') return [];
  return candidates.filter((o) => identityMatches(entry.spec.source, o.sourceIdentity ?? { type: 'unknown' }));
}

/** Strategy 2: content digest recorded at draft/verification time. */
function matchByDigest(entry: CatalogEntryValue, candidates: ObservationValue[]): ObservationValue[] {
  const digest = entry.verification?.sourceDigest;
  if (!digest) return [];
  return candidates.filter((o) => digest === `sha256:${o.contentHash}`);
}

/** Strategy 3: alias via artifact id. */
function matchByAlias(entry: CatalogEntryValue, candidates: ObservationValue[]): ObservationValue[] {
  const idSlug = slug(entry.metadata.id);
  return candidates.filter((o) => o.artifactId === entry.metadata.id || o.artifactId.endsWith(`-${idSlug}`));
}

function detectDrift(entry: CatalogEntryValue, o: ObservationValue): string[] {
  const drift: string[] = [];
  const src = entry.spec.source;
  if (src.type === 'git' && src.revision && o.sourceIdentity?.type === 'git') {
    if (o.sourceIdentity.revision && o.sourceIdentity.revision !== src.revision) {
      drift.push(`observation revision ${o.sourceIdentity.revision} differs from locked revision ${src.revision}`);
    }
  }
  if (entry.verification?.sourceDigest && entry.verification.sourceDigest !== `sha256:${o.contentHash}`) {
    drift.push('content digest differs from last verification');
  }
  return drift;
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

  const matchedObservationIds = new Set<string>();

  for (const { repoRelativePath, entry } of catalog) {
    if (entry.metadata.archived) {
      counts.archived++;
      items.push({ key: entry.metadata.id, status: 'archived', observationIds: [], catalogPath: repoRelativePath, diagnostics: [], suggestions: [] });
      continue;
    }
    const candidates = inventory.filter((o) => o.kind === entryKindToObservationKind(entry.kind));

    // Strategy 1 → 2 → 3; the first strategy with matches wins.
    let matches = matchByIdentity(entry, candidates);
    let strategy: string | undefined = matches.length > 0 ? 'source-identity' : undefined;
    if (matches.length === 0) {
      matches = matchByDigest(entry, candidates);
      if (matches.length > 0) strategy = 'content-digest';
    }
    if (matches.length === 0) {
      matches = matchByAlias(entry, candidates);
      if (matches.length > 0) strategy = 'alias';
    }

    if (matches.length === 1 && strategy) {
      const o = matches[0]!;
      matchedObservationIds.add(o.observationId);
      const drift = detectDrift(entry, o);
      if (drift.length > 0) {
        counts.drifted++;
        items.push({
          key: entry.metadata.id,
          status: 'drifted',
          observationIds: [o.observationId],
          catalogPath: repoRelativePath,
          diagnostics: drift.map((message) => ({ code: 'DRIFT', message })),
          suggestions: ['更新锁定 revision 或重新验证来源'],
        });
      } else {
        counts.matched++;
        items.push({ key: entry.metadata.id, status: 'matched', observationIds: [o.observationId], catalogPath: repoRelativePath, diagnostics: [], suggestions: [] });
      }
      continue;
    }
    if (matches.length > 1 && strategy) {
      counts.ambiguous++;
      items.push({
        key: entry.metadata.id,
        status: 'ambiguous',
        observationIds: matches.map((m) => m.observationId),
        catalogPath: repoRelativePath,
        diagnostics: [{ code: 'AMBIGUOUS', message: `${matches.length} observations match by ${strategy}` }],
        suggestions: ['人工选择对应的 Observation'],
      });
      continue;
    }

    // No confirmed match. Favorites (unknown/url source) are catalog-only;
    // entries with confirmed remote sources are missing-source. Same-name
    // observations are surfaced as suggestions only (FUN-04).
    const sameName = candidates.filter((o) => slug(o.canonicalName) === slug(entry.metadata.id));
    const suggestions: string[] = [];
    if (sameName.length > 0) {
      suggestions.push(`发现 ${sameName.length} 个同名资产，确认后可通过人工 link 关联`);
    }
    if (entry.spec.source.type === 'unknown' || entry.spec.source.type === 'url') {
      counts['catalog-only']++;
      items.push({
        key: entry.metadata.id,
        status: 'catalog-only',
        observationIds: [],
        catalogPath: repoRelativePath,
        diagnostics: [],
        suggestions: [...suggestions, '来源未验证；确认后可升级为 confirmed source'],
      });
    } else {
      counts['missing-source']++;
      items.push({
        key: entry.metadata.id,
        status: 'missing-source',
        observationIds: [],
        catalogPath: repoRelativePath,
        diagnostics: [{ code: 'MISSING_SOURCE', message: '来源无法重新验证' }],
        suggestions: [...suggestions, '人工确认来源'],
      });
    }
  }

  // Remaining observations are installed-only.
  for (const o of inventory) {
    if (matchedObservationIds.has(o.observationId)) continue;
    counts['installed-only']++;
    items.push({
      key: o.artifactId,
      status: 'installed-only',
      observationIds: [o.observationId],
      diagnostics: [],
      suggestions: ['可纳入 Catalog'],
    });
  }

  return { items, counts };
}
