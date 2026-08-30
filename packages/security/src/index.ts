/**
 * @aitp/security — redaction and path policy.
 * SECURITY_AND_GIT.md §5 (path/write policy) and §7 (sensitive data).
 */
import { resolve, sep, isAbsolute, relative } from 'node:path';

/** Normalize a Windows/POSIX path into a comparison key: unified separators, lowercased drive. */
export function normalizePathKey(p: string): string {
  let norm = p.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  if (/^[a-zA-Z]:\//.test(norm)) {
    norm = norm[0]!.toLowerCase() + norm.slice(1);
  }
  return norm;
}

export interface PathCheck {
  ok: boolean;
  reason?: 'absolute-input' | 'traversal' | 'outside-root' | 'device-path' | 'ads' | 'empty';
}

/**
 * Validate a repo-relative path stays inside the root. Rejects absolute input,
 * `..` traversal, device paths, NTFS alternate data streams and empty values.
 */
export function checkRepoRelativePath(root: string, input: string): PathCheck {
  if (!input || input.trim() === '') return { ok: false, reason: 'empty' };
  if (/^[a-zA-Z]:/.test(input) || input.startsWith('\\\\') || input.startsWith('//')) return { ok: false, reason: 'device-path' };
  if (isAbsolute(input)) return { ok: false, reason: 'absolute-input' };
  const segments = input.split(/[\\/]/);
  if (segments.some((s) => s === '..')) return { ok: false, reason: 'traversal' };
  if (input.includes(':')) return { ok: false, reason: 'ads' };
  const resolved = resolve(root, input);
  const rel = relative(resolve(root), resolved);
  if (rel.startsWith('..') || isAbsolute(rel) || rel === '') return { ok: false, reason: 'outside-root' };
  return { ok: true };
}

/** Same as checkRepoRelativePath but returns the resolved absolute path. */
export function resolveInsideRoot(root: string, input: string): { ok: true; absolute: string } | { ok: false; reason: string } {
  const check = checkRepoRelativePath(root, input);
  if (!check.ok) return { ok: false, reason: check.reason ?? 'invalid' };
  return { ok: true, absolute: resolve(root, input) };
}

const REDACTION_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'api-key', re: /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g },
  { kind: 'api-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'token', re: /\bgit[huv]b_[A-Za-z0-9_]{20,}\b/g },
  { kind: 'token', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/gi },
  { kind: 'authorization', re: /\b(Authorization|Cookie|Set-Cookie)\s*:\s*\S+/gi },
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'credential-url', re: /\b\w+:\/\/[^/\s:@]+:[^/\s:@]+@/g },
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'home-path', re: /\b[A-Z]:\\Users\\[^\\\s"']+/g },
];

export interface RedactionResult {
  value: string;
  redactions: string[];
}

/**
 * Multi-layer redaction: field rules + patterns. Values become stable type
 * markers like `<redacted:api-key>`; no reversible prefix/suffix is kept.
 */
export function redactText(input: string, extraPatterns: Array<{ kind: string; re: RegExp }> = []): RedactionResult {
  let value = input;
  const redactions: string[] = [];
  for (const { kind, re } of [...REDACTION_PATTERNS, ...extraPatterns]) {
    value = value.replace(re, () => {
      redactions.push(kind);
      return `<redacted:${kind}>`;
    });
  }
  // High-entropy strings that look like assigned secrets. A 32+ wide window
  // catches short hex/base64 tokens (32–39 chars) that were previously skipped.
  value = value.replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g, (m) => {
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[+/_-]/].filter((c) => c.test(m)).length;
    if (classes >= 3) {
      redactions.push('high-entropy');
      return '<redacted:high-entropy>';
    }
    return m;
  });
  return { value, redactions: [...new Set(redactions)] };
}

/** Redact a string value; empty stays empty. */
export function redactField(value: string): string {
  return redactText(value).value;
}

// Field names whose values are treated as secrets and masked on name alone.
// Covers snake_case, kebab-case, camelCase and plural/compound variants
// (SEC-201: clientSecret/apiKey/privateKey/commands/script/args must all match).
const SENSITIVE_FIELD_NAMES =
  /(api|access)?[_-]?(key|keys|token|tokens|secret|secrets|password|passwords|passwd|credential|credentials)|(authorization|auth)|(cookie|cookies)|(set[_-]?cookie)|(^|[_-])(command|commands|cmd|exec|args|arguments|argv|script|scripts)([_-]|$)|(^|.)(env|environ|environment)([_-]|$)|(private[_-]?key|public[_-]?key|client[_-]?secret|client[_-]?id|api[_-]?key|access[_-]?key)/i;

// Field names that look sensitive but must never be redacted on name alone —
// they hold benign values that would otherwise be destroyed (SEC-202: email in
// package.json `author`, `pathToken` which keys read endpoints, `.env`
// filenames, url-like identifiers, etc.).
const BENIGN_FIELD_NAMES =
  /^(author|authors|maintainer|maintainers|email|emails|url|urls|homepage|repository|name|title|displayName|description|version|license|keywords|pathToken|nextToken|pageToken|cursorToken|path|paths|location)$/i;

/** Redact sensitive leaf values of a JSON-like object by field name and pattern. */
export function redactObject<T>(input: T): { value: T; redactions: string[] } {
  const all: string[] = [];
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      const r = redactText(v);
      all.push(...r.redactions);
      const isSensitiveName = key !== undefined && !BENIGN_FIELD_NAMES.test(key) && SENSITIVE_FIELD_NAMES.test(key);
      if (isSensitiveName && v.length > 0) {
        const kind = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'field';
        all.push(kind);
        return `<redacted:${kind}>`;
      }
      return r.value;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, k);
      return out;
    }
    return v;
  };
  const value = walk(input) as T;
  return { value, redactions: [...new Set(all)] };
}

/** Path policy: normalize to a path token usable in persisted records. */
export function toPathToken(absolutePath: string, root: string): string {
  const rel = relative(resolve(root), resolve(absolutePath));
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.split(sep).join('/');
  // SEC-203: never expose the filename of an out-of-root path — names like
  // `id_rsa` or `.env` would itself be a privacy leak. Emit a stable, opaque token.
  return '~/<outside-root>';
}

export const VENDORED_EXCLUDE_PATTERNS = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.venv([\\/]|$)/,
  /(^|[\\/])__pycache__([\\/]|$)/,
  /(^|[\\/])dist([\\/]|$)/,
  /(^|[\\/])build([\\/]|$)/,
  /(^|[\\/])\.cache([\\/]|$)/,
  /(^|[\\/])\.env([\\/.]|$)/,
  /(^|[\\/])\.claude\.local\./,
  /session|transcript|\.log$/i,
];

export const VENDORED_ALLOWLIST_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.yaml', '.yml', '.json', '.toml',
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.sh', '.ps1', '.rb', '.go',
  '.css', '.html', '.svg', '.license', '.notice',
];

export interface VendoringCheck {
  allowed: string[];
  blocked: Array<{ path: string; reason: 'sensitive' | 'excluded' | 'type' | 'size' | 'count' }>;
}

/**
 * Vendoring gate (CATALOG_SPEC §10): allowlist extensions, denylist patterns,
 * file count/size caps. Sensitive content (secrets) is detected per file.
 */
export function checkVendoring(
  files: Array<{ path: string; content: string }>,
  limits: { maxFiles: number; maxFileBytes: number } = { maxFiles: 200, maxFileBytes: 256 * 1024 },
): VendoringCheck {
  const allowed: string[] = [];
  const blocked: VendoringCheck['blocked'] = [];
  for (const file of files) {
    if (VENDORED_EXCLUDE_PATTERNS.some((re) => re.test(file.path))) {
      blocked.push({ path: file.path, reason: 'excluded' });
      continue;
    }
    const ext = file.path.slice(file.path.lastIndexOf('.')).toLowerCase();
    if (!VENDORED_ALLOWLIST_EXTENSIONS.includes(ext)) {
      blocked.push({ path: file.path, reason: 'type' });
      continue;
    }
    if (Buffer.byteLength(file.content, 'utf8') > limits.maxFileBytes) {
      blocked.push({ path: file.path, reason: 'size' });
      continue;
    }
    const r = redactText(file.content);
    if (r.redactions.length > 0) {
      blocked.push({ path: file.path, reason: 'sensitive' });
      continue;
    }
    allowed.push(file.path);
  }
  if (files.length > limits.maxFiles) {
    return { allowed: [], blocked: [{ path: '*', reason: 'count' }, ...blocked] };
  }
  return { allowed, blocked };
}

export * from './safe-path.js';
