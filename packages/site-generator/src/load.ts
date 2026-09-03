/**
 * Catalog loading for the site generator (design doc §B.1). All YAML handling
 * is delegated to @aitp/catalog — parseCatalogYaml for .yaml entries, and for
 * RuleFragment .md documents frontmatterRoundTrip + serializeCatalogEntry +
 * parseCatalogYaml (the flat frontmatter the panel writes is mapped to the
 * CatalogEntry shape, then re-validated through the same schema path). Any
 * diagnostic is a build failure: the site is either fully valid or absent.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  FileSystemCatalogStore,
  frontmatterRoundTrip,
  parseCatalogYaml,
  serializeCatalogEntry,
} from '@aitp/catalog';
import { API_VERSION, type CatalogEntryValue } from '@aitp/contracts';

export class SiteBuildError extends Error {
  readonly diagnostics: string[];
  constructor(diagnostics: string[]) {
    super(`site build failed (fail-closed):\n${diagnostics.map((d) => `  - ${d}`).join('\n')}`);
    this.name = 'SiteBuildError';
    this.diagnostics = diagnostics;
  }
}

export interface LoadedEntry {
  repoRelativePath: string;
  entry: CatalogEntryValue;
}

async function walkCatalogFiles(repoRoot: string, rel: string, out: string[]): Promise<void> {
  let items;
  try {
    items = await fs.readdir(join(repoRoot, rel), { withFileTypes: true });
  } catch {
    return; // catalog/ missing or unreadable → empty catalog (empty-state site)
  }
  for (const item of items) {
    const child = `${rel}${item.name}${item.isDirectory() ? '/' : ''}`;
    if (item.isDirectory()) await walkCatalogFiles(repoRoot, child, out);
    else if (item.name.endsWith('.yaml') || item.name.endsWith('.md')) out.push(child);
  }
}

/**
 * Load every catalog entry under <root>/catalog/. Files are visited in sorted
 * path order so the result is deterministic regardless of filesystem order.
 */
export async function loadCatalogEntries(repoRoot: string): Promise<LoadedEntry[]> {
  const store = new FileSystemCatalogStore(repoRoot);
  const files: string[] = [];
  await walkCatalogFiles(repoRoot, 'catalog/', files);
  files.sort();

  const loaded: LoadedEntry[] = [];
  for (const rel of files) {
    const raw = await store.loadRaw(rel);
    if (raw === undefined) {
      throw new SiteBuildError([`CATALOG_UNREADABLE ${rel}: file exists but could not be read via the catalog store path allowlist`]);
    }
    if (rel.endsWith('.md')) {
      loaded.push({ repoRelativePath: rel, entry: loadRuleFragmentDocument(raw, rel) });
    } else {
      const parsed = parseCatalogYaml(raw, rel);
      if (!parsed.entry || parsed.diagnostics.length > 0) {
        throw new SiteBuildError(
          parsed.diagnostics.map((d) => `${d.code} ${d.path}: ${d.message}`),
        );
      }
      loaded.push({ repoRelativePath: rel, entry: parsed.entry });
    }
  }
  return loaded;
}

/**
 * RuleFragment .md documents use the flat frontmatter written by the panel
 * (serializeRuleFragment): apiVersion/kind/id/displayName/targets/categories/
 * source{document,lines}/fieldOrigins. Only identity/target metadata is
 * mapped — the fragment body and its source pointers (document, lines) are
 * never published (§B.3: RuleFragment body/frontmatter prose never appears in
 * site output). The mapped candidate is validated through the regular
 * serialize+parse path so schema defaults and diagnostics behave exactly as
 * for .yaml entries.
 */
function loadRuleFragmentDocument(raw: string, rel: string): CatalogEntryValue {
  const fm = frontmatterRoundTrip(raw);
  if (!fm) {
    throw new SiteBuildError([`INVALID_FRONTMATTER ${rel}: no YAML frontmatter block`]);
  }
  const f = fm.frontmatter as Record<string, unknown>;
  if (typeof f.id !== 'string' || typeof f.displayName !== 'string') {
    throw new SiteBuildError([`INVALID_ENTRY ${rel}: rule fragment frontmatter requires string id and displayName`]);
  }
  const targets = Array.isArray(f.targets)
    ? f.targets.filter((t): t is 'claude-code' | 'codex' => t === 'claude-code' || t === 'codex')
    : [];
  const candidate: CatalogEntryValue = {
    apiVersion: typeof f.apiVersion === 'string' ? f.apiVersion : API_VERSION,
    kind: 'RuleFragment',
    metadata: {
      id: f.id,
      displayName: f.displayName,
      shortDescription: '',
      tags: [],
      archived: f.archived === true,
    },
    spec: {
      targets,
      ownership: 'unknown',
      source: { type: 'unknown' },
      license: { status: 'unknown' },
      installInstructions: {},
      contentPolicy: 'metadata-only',
      components: [],
    },
    overlay: { notes: '', fieldOrigins: {} },
    verification: {},
  };
  const reparsed = parseCatalogYaml(serializeCatalogEntry(candidate), rel);
  if (!reparsed.entry || reparsed.diagnostics.length > 0) {
    throw new SiteBuildError(
      reparsed.diagnostics.length > 0
        ? reparsed.diagnostics.map((d) => `${d.code} ${d.path}: ${d.message}`)
        : [`INVALID_ENTRY ${rel}: rule fragment did not validate`],
    );
  }
  return reparsed.entry;
}
