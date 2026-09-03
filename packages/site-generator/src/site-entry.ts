/**
 * SiteEntry — the only field whitelist that ever reaches the static site
 * (design doc §B.3). Anything not listed here (pathToken, absolute paths,
 * contentHash, sourceDigest, textHash, RuleFragment body/frontmatter prose,
 * verification, unknown, fieldOrigins) is structurally unreachable from the
 * output because projection builds this shape from scratch.
 */
export interface SiteEntry {
  kind: 'Skill' | 'Plugin' | 'Marketplace' | 'Hook' | 'RuleFragment';
  id: string;
  displayName: string;
  shortDescription: string;
  tags: string[];
  targets: string[];
  ownership: string;
  contentPolicy: string;
  license: { status: string; expression?: string };
  source: { type: string; url?: string; identifier?: string };
  installInstructions: Record<string, string>;
  notes: string;
}

export interface SiteData {
  entries: SiteEntry[];
}

export const SITE_ENTRY_FIELDS = [
  'kind',
  'id',
  'displayName',
  'shortDescription',
  'tags',
  'targets',
  'ownership',
  'contentPolicy',
  'license',
  'source',
  'installInstructions',
  'notes',
] as const;
