import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ClaudeAdapter } from '@aitp/adapter-claude';
import type { Candidate, ScanContext } from '@aitp/contracts';

// M7-02 (automatable subset): Unicode paths, long paths (MAX_PATH) and
// restricted-permission reads degrade gracefully with stable diagnostics.
const execAsync = promisify(execFile);
let repo: string;
let context: ScanContext;
const adapter = new ClaudeAdapter();

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'aitp-paths-'));
  context = { repoRoot: repo, homeDir: repo, cwd: repo, limits: { maxFileBytes: 512 * 1024, maxFiles: 2000, maxDepth: 10 } };
});

afterEach(async () => {
  // Restore permissions so temp cleanup works after ACL tests.
  await rm(repo, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
});

async function collectCandidates(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for await (const c of adapter.discover(context)) out.push(c);
  return out;
}

function skill(name: string, body = 'Standard guidance.'): string {
  return `---\nname: ${name}\ndescription: Fixture skill ${name}.\n---\n${body}\n`;
}

describe('M7-02: Unicode paths', () => {
  it('discovers and parses skills with Chinese/accents/emoji in directory names', async () => {
    const names = ['测试技能', 'donnée-révisée', '🔧-emoji-skill'];
    for (const name of names) {
      const dir = join(repo, '.claude', 'skills', name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), skill(name), 'utf8');
    }
    const candidates = await collectCandidates();
    for (const name of names) {
      const found = candidates.find((c) => c.name === name);
      expect(found, `missing unicode skill ${name}`).toBeDefined();
      const result = await adapter.parse(found!, context);
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
      // Path token preserves the user-visible Unicode name (SCANNING_SPEC §4).
      expect(result.observations[0]!.location.pathToken).toContain(name);
    }
    // Deterministic across runs (NFR-001) including Unicode entries.
    const again = (await collectCandidates()).map((c) => c.absolutePath);
    expect(again).toEqual(candidates.map((c) => c.absolutePath));
    const first = await adapter.parse(candidates.find((c) => c.name === '测试技能')!, context);
    const second = await adapter.parse(candidates.find((c) => c.name === '测试技能')!, context);
    expect(first.observations[0]!.observationId).toBe(second.observations[0]!.observationId);
  });
});

describe('M7-02: long paths (>260 chars)', () => {
  it('scans a skill directory whose path exceeds MAX_PATH when the filesystem allows it', async () => {
    // A single long directory name (<255 chars) pushes the total path past 260.
    const longName = 'deep-' + 'segment-'.repeat(30) + 'tail'; // 30*8+9 = 249 chars
    const skillDir = join(repo, '.claude', 'skills', longName);
    if (skillDir.length <= 260) {
      console.log('skip: tempdir root too short to exceed MAX_PATH here');
      return;
    }
    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), skill('longpath-skill'), 'utf8');
    } catch (e) {
      console.log('skip: filesystem refused long path creation:', String(e).slice(0, 80));
      return;
    }
    const candidates = await collectCandidates();
    // Discovery keys candidates by directory name; the frontmatter name only
    // appears after parsing (SCANNING_SPEC §7).
    const found = candidates.find((c) => c.kind === 'skill' && c.absolutePath === join(skillDir, 'SKILL.md'));
    expect(found).toBeDefined();
    expect(found!.absolutePath.length).toBeGreaterThan(260);
    const result = await adapter.parse(found!, context);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.canonicalName).toBe('longpath-skill');
  });
});

describe.skipIf(process.platform !== 'win32')('M7-02: restricted permissions', () => {
  // An icacls deny ACE does not restrict Administrators (and some elevated or
  // sandboxed contexts bypass deny entirely). Verify the deny actually takes
  // effect on a probe file; otherwise skip — the assertions below would false-
  // fail for an environment reason, not a scanner defect.
  async function denyWorks(target: string, user: string, ace: string): Promise<boolean> {
    await execAsync('icacls', [target, '/deny', ace]).catch(() => undefined);
    try {
      await readFile(target, 'utf8');
      return false; // still readable → deny is ineffective for this identity
    } catch {
      return true; // read was refused → deny is enforced
    } finally {
      await execAsync('icacls', [target, '/remove:d', user]).catch(() => undefined);
    }
  }

  it('denied skill directory yields ACCESS_DENIED diagnostics without stopping siblings', async () => {
    const deniedDir = join(repo, '.claude', 'skills', 'locked-skill');
    const openDir = join(repo, '.claude', 'skills', 'open-skill');
    await mkdir(deniedDir, { recursive: true });
    await mkdir(openDir, { recursive: true });
    const lockedFile = join(deniedDir, 'SKILL.md');
    await writeFile(lockedFile, skill('locked-skill'), 'utf8');
    await writeFile(join(openDir, 'SKILL.md'), skill('open-skill'), 'utf8');

    const user = process.env.USERNAME ?? 'Everyone';
    if (!(await denyWorks(lockedFile, user, `${user}:(OI)(CI)(R)`))) {
      console.log('skip: icacls deny does not restrict this identity (e.g. Administrator)');
      return;
    }
    await execAsync('icacls', [deniedDir, '/deny', `${user}:(OI)(CI)(R)`]);
    try {
      // walkBounded surfaces the unreadable directory instead of crashing.
      const { errors } = await (async () => {
        const { walkBounded } = await import('@aitp/inventory-core');
        return walkBounded(join(repo, '.claude', 'skills'), context, { maxDepth: 2 });
      })();
      expect(errors.some((e) => e.includes('locked-skill') || e.includes('readdir failed'))).toBe(true);

      const candidates = await collectCandidates();
      const locked = candidates.find((c) => c.name === 'locked-skill');
      if (locked) {
        const lockedResult = await adapter.parse(locked, context);
        expect(lockedResult.observations).toHaveLength(0);
        expect(lockedResult.diagnostics.some((d) => d.code === 'ACCESS_DENIED')).toBe(true);
      }
      // The sibling still scans (NFR-003: one unreadable item does not stop the run).
      const open = candidates.find((c) => c.name === 'open-skill')!;
      const openResult = await adapter.parse(open, context);
      expect(openResult.observations).toHaveLength(1);
      expect(openResult.diagnostics.filter((d) => d.code === 'ACCESS_DENIED')).toHaveLength(0);
    } finally {
      await execAsync('icacls', [deniedDir, '/remove:d', user]).catch(() => undefined);
    }
  });

  it('denied file read surfaces ACCESS_DENIED (not FILE_TOO_LARGE)', async () => {
    const dir = join(repo, '.claude', 'skills', 'denied-file');
    await mkdir(dir, { recursive: true });
    const skillFile = join(dir, 'SKILL.md');
    await writeFile(skillFile, skill('denied-file'), 'utf8');
    const user = process.env.USERNAME ?? 'Everyone';
    if (!(await denyWorks(skillFile, user, `${user}:(R)`))) {
      console.log('skip: icacls deny does not restrict this identity (e.g. Administrator)');
      return;
    }
    await execAsync('icacls', [skillFile, '/deny', `${user}:(R)`]);
    try {
      const candidate: Candidate = { provider: 'claude-code', kind: 'skill', scope: 'repo', name: 'denied-file', absolutePath: skillFile, copyRole: 'source' };
      const result = await adapter.parse(candidate, context);
      expect(result.observations).toHaveLength(0);
      expect(result.diagnostics.some((d) => d.code === 'ACCESS_DENIED')).toBe(true);
    } finally {
      await execAsync('icacls', [skillFile, '/remove:d', user]).catch(() => undefined);
    }
  });
});

describe('M7-02: chmod-based denial (POSIX-compatible path)', () => {
  it('unreadable file (chmod 000) produces a stable diagnostic on non-Windows', { skip: process.platform === 'win32' }, async () => {
    const dir = join(repo, '.claude', 'skills', 'chmod-skill');
    await mkdir(dir, { recursive: true });
    const skillFile = join(dir, 'SKILL.md');
    await writeFile(skillFile, skill('chmod-skill'), 'utf8');
    await chmod(skillFile, 0o000);
    try {
      const candidate: Candidate = { provider: 'claude-code', kind: 'skill', scope: 'repo', name: 'chmod-skill', absolutePath: skillFile, copyRole: 'source' };
      const result = await adapter.parse(candidate, context);
      expect(result.observations).toHaveLength(0);
      expect(result.diagnostics.some((d) => d.code === 'ACCESS_DENIED')).toBe(true);
    } finally {
      await chmod(skillFile, 0o644);
    }
  });
});
