import { describe, it, expect } from 'vitest';
import { checkRepoRelativePath, redactText, redactObject, checkVendoring, normalizePathKey, toPathToken } from '@aitp/security';
import { resolve } from 'node:path';

// SECURITY_AND_GIT §5/§7; security gate 1 and 4.
describe('path policy', () => {
  const root = resolve('C:/tmp/repo');

  it('accepts ordinary repo-relative paths', () => {
    expect(checkRepoRelativePath(root, 'catalog/skills/x.yaml')).toEqual({ ok: true });
  });

  it('rejects traversal, absolute input, ADS and empty paths (gate 1)', () => {
    expect(checkRepoRelativePath(root, '../outside.yaml').reason).toBe('traversal');
    expect(checkRepoRelativePath(root, 'a/../../b.yaml').reason).toBe('traversal');
    expect(checkRepoRelativePath(root, 'C:/Windows/system32').reason).toBe('device-path');
    expect(checkRepoRelativePath(root, '\\\\server\\share\\x').reason).toBe('device-path');
    expect(checkRepoRelativePath(root, 'file.txt:hidden').reason).toBe('ads');
    expect(checkRepoRelativePath(root, '').reason).toBe('empty');
  });
});

describe('redaction', () => {
  it('redacts common secret formats with stable markers (gate 4)', () => {
    const r = redactText('key sk-abcdefghij0123456789 and AKIAIOSFODNN7EXAMPLE and user@corp.example in C:\\Users\\yan');
    expect(r.value).toContain('<redacted:api-key>');
    expect(r.value).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(r.value).not.toContain('user@corp.example');
    expect(r.value).not.toMatch(/C:\\Users\\yan/);
  });

  it('keeps normal text untouched', () => {
    expect(redactText('deterministic scanning keeps secrets out').redactions).toHaveLength(0);
  });

  it('redacts sensitive object fields', () => {
    const { value } = redactObject({ command: 'curl https://x', safe: 'text', nested: { token: 'abcdef1234567890abcdef' } });
    expect(value).toMatchObject({ command: expect.stringContaining('<redacted:'), safe: 'text' });
    expect(JSON.stringify(value)).not.toContain('abcdef1234567890abcdef');
  });
});

describe('vendoring gate (CAT-005, gate 7)', () => {
  it('blocks secrets, env files, binaries and allows plain files', () => {
    const result = checkVendoring([
      { path: 'README.md', content: 'fine' },
      { path: '.env', content: 'SECRET=1' },
      { path: 'key.md', content: 'token: sk-abcdefghij0123456789' },
      { path: 'bin.exe', content: 'MZ...' },
      { path: 'node_modules/x.js', content: 'dep' },
    ]);
    expect(result.allowed).toEqual(['README.md']);
    expect(result.blocked.map((b) => b.path)).toContain('.env');
    expect(result.blocked.map((b) => b.reason)).toContain('sensitive');
    expect(result.blocked.map((b) => b.reason)).toContain('type');
    expect(result.blocked.map((b) => b.reason)).toContain('excluded');
  });
});

describe('path tokens', () => {
  it('normalizes path keys across separators and drive case', () => {
    expect(normalizePathKey('C:\\Repo\\a')).toBe(normalizePathKey('c:/Repo/a'));
  });

  it('repo files get repo-relative tokens, outside paths get ~ tokens', () => {
    expect(toPathToken('C:\\tmp\\repo\\catalog\\a.yaml', 'C:\\tmp\\repo')).toBe('catalog/a.yaml');
    expect(toPathToken('C:\\Users\\yan\\.claude\\x', 'C:\\tmp\\repo')).toMatch(/^~\//);
  });
});
