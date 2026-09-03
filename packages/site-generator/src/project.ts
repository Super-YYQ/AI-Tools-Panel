/**
 * Whitelist projection (design doc §B.3). Builds the SiteEntry from scratch —
 * fields absent from the literal below are structurally unable to reach the
 * output, regardless of what the catalog document contains.
 */
import type { CatalogEntryValue } from '@aitp/contracts';
import type { SiteEntry } from './site-entry.js';

function projectSource(source: CatalogEntryValue['spec']['source']): SiteEntry['source'] {
  const out: SiteEntry['source'] = { type: source.type };
  // URL gate: only https URLs of url/git sources are published.
  if (
    (source.type === 'url' || source.type === 'git') &&
    'url' in source &&
    typeof source.url === 'string' &&
    source.url.startsWith('https://')
  ) {
    out.url = source.url;
  }
  // marketplace sources publish their owner/name identifier only.
  if (source.type === 'marketplace' && typeof source.marketplaceId === 'string') {
    out.identifier = source.marketplaceId;
  }
  return out;
}

export function projectEntry(entry: CatalogEntryValue): SiteEntry {
  const { kind, metadata, spec, overlay } = entry;
  const site: SiteEntry = {
    kind,
    id: metadata.id,
    displayName: metadata.displayName,
    shortDescription: metadata.shortDescription,
    tags: [...metadata.tags],
    targets: [...spec.targets],
    ownership: spec.ownership,
    contentPolicy: spec.contentPolicy,
    license: {
      status: spec.license.status,
      ...(spec.license.expression !== undefined ? { expression: spec.license.expression } : {}),
    },
    source: projectSource(spec.source),
    installInstructions: { ...spec.installInstructions },
    notes: overlay.notes,
  };
  return site;
}
