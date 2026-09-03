/**
 * Output security gate (design doc §B.4, fail-closed). Patterns shared with
 * scripts/secret-scan.mjs are kept textually in sync; the site adds machine
 * path / redaction-marker / PII-email extensions. Any hit fails the build —
 * no silent redaction, no configuration switches (§E: exceptions live in the
 * code-level example/marker allowlist below).
 */
import type { SiteEntry } from './site-entry.js';

export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // — patterns reused from scripts/secret-scan.mjs (keep in sync) —
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{30,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'credential-url', re: /\b\w+:\/\/[^/\s:@]+:[^/\s:@]{6,}@/ },
  { name: 'high-entropy-assignment', re: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][A-Za-z0-9+/_-]{32,}['"]/i },
  // — site extensions (§B.4): personal/machine paths must never publish —
  { name: 'windows-drive-path', re: /[A-Za-z]:\\/ },
  { name: 'unix-user-path', re: /\/Users\/|\/home\// },
  { name: 'env-user-path', re: /%USERPROFILE%|%HOMEPATH%/i },
  { name: 'redaction-marker', re: /<redacted:/i },
  // Email is user PII; false positives are accepted (fail-closed).
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];

// Same convention as scripts/secret-scan.mjs: AWS's documented example access
// key and obviously-fake fixture markers are recognized example data.
const EXAMPLE_TOKENS = [/AKIAIOSFODNN7EXAMPLE/g];
const ALLOWED_MARKERS = [/\bnot[-_]a[-_]secret\b/i];

export interface ScanHit {
  pattern: string;
  excerpt: string;
}

/** Scan a text blob for secret/PII-like content. Empty when clean. */
export function scanText(text: string): ScanHit[] {
  let sampled = text;
  for (const tokenRe of EXAMPLE_TOKENS) sampled = sampled.replace(tokenRe, '<aws-docs-example>');
  for (const markerRe of ALLOWED_MARKERS) sampled = sampled.replace(markerRe, '<fixture-marker>');
  const hits: ScanHit[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const m = re.exec(sampled);
    if (m) {
      const start = Math.max(0, m.index - 20);
      hits.push({ pattern: name, excerpt: sampled.slice(start, m.index + m[0].length + 20).replace(/\s+/g, ' ') });
    }
  }
  return hits;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Scan every string leaf of a projected SiteEntry, attributing hits to the
 * entry id and the field path (e.g. "installInstructions.claude-code").
 * Returns fail-closed diagnostic lines.
 */
export function scanSiteEntry(entry: SiteEntry): string[] {
  const problems: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      for (const hit of scanText(value)) {
        problems.push(`entry "${entry.id}" field "${path}" matched ${hit.pattern} (fail-closed, not auto-removed): …${hit.excerpt}…`);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (isPlainObject(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
  };
  visit(entry, '');
  return problems;
}

/** Scan the final rendered HTML bytes. Returns fail-closed diagnostic lines. */
export function scanFinalOutput(html: string): string[] {
  return scanText(html).map((hit) => `final output matched ${hit.pattern} (fail-closed, not auto-removed): …${hit.excerpt}…`);
}
