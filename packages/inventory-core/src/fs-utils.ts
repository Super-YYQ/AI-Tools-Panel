/**
 * Shared filesystem discovery helpers used by provider adapters.
 * Parsers read files as data only — never execute content (SECURITY_AND_GIT §3).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ScanContext } from '@aitp/contracts';

export interface FrontmatterResult {
  frontmatter: Record<string, unknown>;
  body: string;
  error?: string;
}

/** Parse leading YAML frontmatter from Markdown. Non-executing. */
export function parseFrontmatter(text: string): FrontmatterResult {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  try {
    const frontmatter = parseYaml(match[1]!) as Record<string, unknown>;
    return { frontmatter: frontmatter ?? {}, body: match[2] ?? '' };
  } catch (e) {
    return { frontmatter: {}, body: match[2] ?? '', error: String(e) };
  }
}

export const MAX_FILE_BYTES = 512 * 1024;

export interface DiscoveredFile {
  absolutePath: string;
  relativeFrom: string;
  depth: number;
  size: number;
}

/**
 * Bounded recursive walk: max depth, max files, skips symlinked directories
 * and excluded directories. Deterministic order (sorted).
 */
export async function walkBounded(
  root: string,
  context: ScanContext,
  options: { maxDepth: number; match?: (relPath: string, name: string) => boolean; followLinks?: boolean } = { maxDepth: 6 },
): Promise<{ files: DiscoveredFile[]; errors: string[] }> {
  const files: DiscoveredFile[] = [];
  const errors: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__']);

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > options.maxDepth || files.length >= context.limits.maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      errors.push(`readdir failed: ${dir}: ${(e as Error).message}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= context.limits.maxFiles) return;
      const full = join(dir, entry.name);
      const rel = full.slice(root.length + 1).split(/[\\/]/).join('/');
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (entry.isSymbolicLink()) continue; // never follow directory links during discovery
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (options.match && !options.match(rel, entry.name)) continue;
        let size = 0;
        try {
          size = (await fs.stat(full)).size;
        } catch {
          errors.push(`stat failed: ${rel}`);
          continue;
        }
        files.push({ absolutePath: full, relativeFrom: rel, depth, size });
      }
    }
  };
  await walk(root, 0);
  return { files, errors };
}

/** Read a file as text with size cap; returns undefined when missing/too large. */
export async function readTextCapped(path: string, maxBytes = MAX_FILE_BYTES): Promise<string | undefined> {
  try {
    const buf = await fs.readFile(path);
    if (buf.byteLength > maxBytes) return undefined;
    return buf.toString('utf8');
  } catch {
    return undefined;
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export type ReadFailureKind = 'access-denied' | 'too-large' | 'missing';

/**
 * Distinguish why a capped read produced nothing (SCANNING_SPEC §10):
 * permission failures must surface as ACCESS_DENIED, size as FILE_TOO_LARGE.
 */
export async function classifyReadFailure(path: string, maxBytes = MAX_FILE_BYTES): Promise<ReadFailureKind> {
  try {
    const stat = await fs.stat(path);
    if (stat.size > maxBytes) return 'too-large';
    // Stat succeeded but the read failed: on Windows this is typically an ACL deny.
    return 'access-denied';
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return 'access-denied';
    if (code === 'ENAMETOOLONG') return 'too-large';
    return 'missing';
  }
}
