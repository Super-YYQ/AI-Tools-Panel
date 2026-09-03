/**
 * Test helpers — build throwaway repo directories in the style of
 * tests/fixtures/catalog (never touching the real catalog/).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function makeTempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'aitp-site-gen-'));
}

export async function cleanupRepo(repo: string): Promise<void> {
  await rm(repo, { recursive: true, force: true });
}

export async function writeCatalogFile(repo: string, rel: string, content: string): Promise<void> {
  const absolute = join(repo, rel);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

export function skillYaml(overrides: {
  id: string;
  displayName?: string;
  shortDescription?: string;
  tags?: string[];
  source?: string;
  notes?: string;
  license?: string;
  archived?: boolean;
}): string {
  const tags = (overrides.tags ?? ['deploy'])
    .map((t) => `    - ${t}`)
    .join('\n');
  return [
    'apiVersion: aitp.dev/v1alpha1',
    'kind: Skill',
    'metadata:',
    `  id: ${overrides.id}`,
    `  displayName: ${overrides.displayName ?? overrides.id}`,
    `  shortDescription: ${overrides.shortDescription ?? 'deploy helper skill'}`,
    '  tags:',
    tags,
    `  archived: ${overrides.archived ?? false}`,
    'spec:',
    '  targets:',
    '    - claude-code',
    '  ownership: authored',
    '  source:',
    `    ${overrides.source ?? 'type: url\n    url: https://github.com/example/skills'}`,
    '  license:',
    `    status: ${overrides.license ?? 'confirmed'}`,
    '    expression: MIT',
    '  installInstructions:',
    '    claude-code: install via marketplace',
    '  contentPolicy: metadata-only',
    'overlay:',
    `  notes: ${overrides.notes ?? 'human maintained'}`,
    '',
  ].join('\n');
}

/** Extract the embedded JSON payload from the built HTML. */
export function extractEmbeddedJson(html: string): unknown {
  const match = /<script type="application\/json" id="aitp-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('embedded data script not found');
  return JSON.parse(match[1]!);
}
