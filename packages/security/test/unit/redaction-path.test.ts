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

  it('redacts field-name variants: plural, camelCase and compound secret names (SEC-201)', () => {
    const { value, redactions } = redactObject({
      commands: 'ls -la',
      cmd: 'rm -rf /',
      exec: 'whoami',
      args: '--flag',
      script: 'echo secret',
      arguments: '--x',
      clientSecret: 'cs_1234567890',
      apiKey: 'key_abcdef1234567890',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----...',
      headers: { authorization: 'Bearer deadbeef' },
    });
    const json = JSON.stringify(value);
    expect(json).toContain('<redacted:commands>');
    expect(json).toContain('<redacted:cmd>');
    // compound camelCase secret names are masked on name alone; the exact marker
    // casing is cosmetic, what matters is the value is gone.
    expect(json).toContain('clientSecret":"<redacted:clientsecret>');
    expect(json).toContain('apiKey":"<redacted:apikey>');
    expect(json).toContain('privateKey":"<redacted:privatekey>');
    expect(json).not.toContain('cs_1234567890');
    expect(json).not.toContain('key_abcdef1234567890');
    expect(json).not.toContain('deadbeef');
    // every field-variant was masked on name alone
    expect(redactions).toContain('commands');
  });

  it('does not over-redact benign field names like author/email (SEC-202)', () => {
    const { value } = redactObject({ author: 'Jane Doe', homepage: 'https://example.com', license: 'MIT', maintainer: 'team' });
    // The field NAME `author`/`email` must not force <redacted:author> — this is
    // the H1 regression: legitimate package.json metadata stays intact.
    const json = JSON.stringify(value);
    expect(json).not.toContain('<redacted:author>');
    expect(json).not.toContain('<redacted:homepage>');
    expect(json).not.toContain('<redacted:license>');
    expect(json).toContain('Jane Doe');
  });

  it('redacts short high-entropy tokens (32–39 chars) previously missed (SEC-202)', () => {
    const token32 = 'Ab3Xy9Wq2Rf8Tk1Jn5Pz7Vd4Lg0Hn6Ms'.slice(0, 32); // 3 char classes
    const { value } = redactText(`export KEY=${token32}`);
    expect(value).toContain('<redacted:high-entropy>');
    expect(value).not.toContain(token32);
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

  it('repo files get repo-relative tokens, outside paths get opaque tokens (SEC-203)', () => {
    expect(toPathToken('C:\\tmp\\repo\\catalog\\a.yaml', 'C:\\tmp\\repo')).toBe('catalog/a.yaml');
    expect(toPathToken('C:\\Users\\yan\\.claude\\x', 'C:\\tmp\\repo')).toBe('~/<outside-root>');
    // never leak sensitive filenames like id_rsa or .env
    expect(toPathToken('C:\\Users\\yan\\.ssh\\id_rsa', 'C:\\tmp\\repo')).toBe('~/<outside-root>');
    expect(toPathToken('/home/yan/.env', '/tmp/repo')).toBe('~/<outside-root>');
  });
});
