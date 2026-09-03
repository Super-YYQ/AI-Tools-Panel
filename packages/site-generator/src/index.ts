/**
 * @aitp/site-generator — static catalog showcase site builder (design doc §B).
 * Reads a repository's catalog/ directory through @aitp/catalog, projects each
 * entry onto the §B.3 SiteEntry whitelist, scans every field and the final
 * HTML with the §B.4 fail-closed security gate, and renders a deterministic
 * single-file site. No timestamps anywhere: same input, byte-identical output.
 */
import { loadCatalogEntries, SiteBuildError } from './load.js';
import { projectEntry } from './project.js';
import { renderHtml } from './template.js';
import { scanFinalOutput, scanSiteEntry } from './security.js';
import type { SiteEntry } from './site-entry.js';

export type { SiteEntry, SiteData } from './site-entry.js';
export { SITE_ENTRY_FIELDS } from './site-entry.js';
export { SiteBuildError, loadCatalogEntries, type LoadedEntry } from './load.js';
export { projectEntry } from './project.js';
export { renderHtml, type RenderOptions } from './template.js';
export {
  SECRET_PATTERNS,
  scanText,
  scanSiteEntry,
  scanFinalOutput,
  type ScanHit,
  type SecretPattern,
} from './security.js';

export const DEFAULT_SITE_TITLE = 'AI Tools Panel Catalog';

export interface BuildSiteOptions {
  /** Repository root containing catalog/. */
  root: string;
  siteTitle?: string;
  siteUrl?: string;
}

export interface SiteBuildResult {
  html: string;
  entryCount: number;
}

/**
 * Build the site HTML in memory. Throws SiteBuildError (fail-closed) on any
 * invalid catalog document, duplicate id, or security-gate hit; callers only
 * write output after this resolves.
 */
export async function buildSite(options: BuildSiteOptions): Promise<SiteBuildResult> {
  const loaded = await loadCatalogEntries(options.root);

  const problems: string[] = [];
  const seen = new Map<string, string>();
  const entries: SiteEntry[] = [];
  for (const { repoRelativePath, entry } of loaded) {
    // §B.2: archived entries are never shown, so their data never publishes.
    if (entry.metadata.archived) continue;
    const previous = seen.get(entry.metadata.id);
    if (previous !== undefined) {
      problems.push(`DUPLICATE_ID entry "${entry.metadata.id}" is defined in both ${previous} and ${repoRelativePath}`);
      continue;
    }
    seen.set(entry.metadata.id, repoRelativePath);
    const projected = projectEntry(entry);
    problems.push(...scanSiteEntry(projected));
    entries.push(projected);
  }

  // Deterministic order independent of filesystem enumeration order.
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const html = renderHtml(
    { entries },
    {
      siteTitle: options.siteTitle ?? DEFAULT_SITE_TITLE,
      ...(options.siteUrl !== undefined ? { siteUrl: options.siteUrl } : {}),
    },
  );
  problems.push(...scanFinalOutput(html));
  if (problems.length > 0) throw new SiteBuildError(problems);

  return { html, entryCount: entries.length };
}
