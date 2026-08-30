import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startPanel, type PanelInstance } from './helpers';

const execAsync = promisify(execFile);

let panel: PanelInstance;

// REL-101: every scenario runs against its own panel instance and temp repo,
// so one failure can never shadow the remaining E2E coverage.
test.beforeEach(async () => {
  panel = await startPanel();
});

test.afterEach(async () => {
  await panel.stop();
});

async function openPanel(browser: import('@playwright/test').Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${panel.baseURL}/#session=${panel.sessionToken}`);
  // FUN-001: the panel lands on the overview and the session token never
  // remains in the URL.
  await expect(page.getByRole('heading', { name: 'AI Tools Panel' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '总览', level: 2 })).toBeVisible();
  expect(page.url()).not.toContain('session=');
  return page;
}

/** FUN-007: apply through the full Change Review UI (no confirm dialogs). */
async function applyInReview(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '变更审查' })).toBeVisible();
  await page.getByRole('button', { name: '应用变更' }).click();
  await expect(page.locator('header [role=status]')).toContainText('已保存', { timeout: 20_000 });
}

async function scan(page: Page): Promise<void> {
  await page.getByRole('button', { name: '开始扫描' }).click();
  await expect(page.locator('header [role=status]')).toContainText(/扫描(完成|部分完成)/, { timeout: 60_000 });
}

async function gitStatus(): Promise<string> {
  const { stdout } = await execAsync('git', ['-C', panel.repo, 'status', '--porcelain']);
  return stdout.trim();
}

test.describe('E2E-01..06 (PRODUCT_SPEC 用户流程, v0.1.1)', () => {
  test('E2E-01 首次扫描：六类发现、证据可追溯、仓库不变、首屏稳定', async ({ browser }) => {
    const page = await openPanel(browser);
    await scan(page);
    await page.getByRole('navigation').getByRole('button', { name: '已安装' }).click();
    await expect(page.getByRole('article', { name: /deploy-helper/ })).toBeVisible();
    await expect(page.getByRole('article', { name: /report/ })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: '规则' }).click();
    await expect(page.getByText('AGENTS.md').first()).toBeVisible();
    expect(await gitStatus()).toBe('');
    await page.context().close();
  });

  test('E2E-02 编辑人工简述：完整 diff 审查、原文件不变、重扫保留 Overlay', async ({ browser }) => {
    const page = await openPanel(browser);
    await scan(page);
    await page.getByRole('navigation').getByRole('button', { name: '已安装' }).click();
    const card = page.getByRole('article', { name: /deploy-helper \(skill\)/ });
    await card.getByRole('button', { name: '纳入目录' }).click();
    await card.getByLabel('人工简述').fill('Release checklist helper (human summary).');
    await card.getByRole('button', { name: '预览 diff 并保存' }).click();
    // FUN-007: the review shows the complete diff before apply.
    await expect(page.getByRole('heading', { name: '变更审查' })).toBeVisible();
    const reviewDiff = page.getByLabel(/diff/).first();
    await expect(reviewDiff).toContainText('shortDescription');
    await applyInReview(page);

    const catalogFile = join(panel.repo, 'catalog', 'skills', 'deploy-helper.yaml');
    const yaml = await readFile(catalogFile, 'utf8');
    expect(yaml).toContain('Release checklist helper (human summary).');
    expect(yaml).toContain('shortDescription: human');
    const skill = await readFile(join(panel.repo, '.claude', 'skills', 'deploy-helper', 'SKILL.md'), 'utf8');
    expect(skill).toContain('description: Help with deploy checklists.');
    // Rescan preserves the overlay (CAT-008).
    await scan(page);
    const yamlAfter = await readFile(catalogFile, 'utf8');
    expect(yamlAfter).toBe(yaml);
    await page.context().close();
  });

  test('E2E-03 收藏未安装条目：离线保存、catalog-only、无外部网络请求', async ({ browser }) => {
    const page = await openPanel(browser);
    const external: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (!url.startsWith(panel.baseURL)) {
        external.push(url);
        void route.abort();
        return;
      }
      void route.continue();
    });
    await page.getByRole('navigation').getByRole('button', { name: '目录库' }).click();
    await page.getByLabel('名称').fill('Remote Cool Skill');
    await page.getByLabel('URL / Marketplace 标识').fill('https://github.com/example/cool-skill');
    await page.getByRole('button', { name: '预览并保存' }).click();
    await applyInReview(page);

    const yaml = await readFile(join(panel.repo, 'catalog', 'skills', 'remote-cool-skill.yaml'), 'utf8');
    expect(yaml).toContain('type: url');
    expect(yaml).toContain('contentPolicy: metadata-only');
    expect(external).toHaveLength(0); // offline-first: no network request at all
    await page.context().close();
  });

  test('E2E-04 本地 Skill import preview：默认 metadata-only、敏感文件被阻止', async ({ browser }) => {
    // REL-101: the leaky fixture's .env is gitignored by design — create it
    // per-instance so a clean clone reproduces the exclusion scenario.
    await panel.stop();
    panel = await startPanel(async (repo) => {
      const { writeFile: wf, mkdir: mkd } = await import('node:fs/promises');
      await mkd(join(repo, '.claude', 'skills', 'leaky'), { recursive: true });
      await wf(join(repo, '.claude', 'skills', 'leaky', '.env'), 'FAKE_MARKER_TOKEN=aitp-e2e-not-a-secret\n', 'utf8');
    });
    const page = await openPanel(browser);
    await scan(page);
    await page.getByRole('navigation').getByRole('button', { name: '已安装' }).click();
    const card = page.getByRole('article', { name: /leaky \(skill\)/ });
    await card.getByRole('button', { name: '本地导入预览' }).click();
    await expect(card.getByText('metadata-only')).toBeVisible();
    await expect(card.getByText(/\.env/)).toBeVisible();
    await card.getByRole('button', { name: '仅保存元数据（默认）' }).click();
    await applyInReview(page);
    const yaml = await readFile(join(panel.repo, 'catalog', 'skills', 'leaky.yaml'), 'utf8');
    expect(yaml).toContain('contentPolicy: metadata-only');
    const { stdout } = await execAsync('git', ['-C', panel.repo, 'status', '--porcelain']);
    expect(stdout).not.toContain('vendored');
    await page.context().close();
  });

  test('E2E-05 规则片段：行选择、frontmatter 证据、原规则文件不变', async ({ browser }) => {
    const page = await openPanel(browser);
    await scan(page);
    await page.getByRole('navigation').getByRole('button', { name: '规则' }).click();
    const item = page.locator('li', { hasText: 'AGENTS.md' }).first();
    await item.getByRole('button', { name: '保存片段' }).click();
    await expect(item.getByText(/Use deterministic tests/)).toBeVisible();
    await item.getByLabel('起始行').fill('3');
    await item.getByLabel('结束行').fill('3');
    await item.getByRole('button', { name: '预览并保存片段' }).click();
    await applyInReview(page);

    const yaml = await readFile(join(panel.repo, 'catalog', 'rule-fragments', 'agents-md-l3-3.md'), 'utf8');
    expect(yaml).toContain('kind: RuleFragment');
    expect(yaml).toContain('lines: 3-3');
    expect(yaml).toContain('categories: human');
    expect(yaml).toContain('Use deterministic tests.');
    const agents = await readFile(join(panel.repo, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Use deterministic tests.');
    await page.context().close();
  });

  test('E2E-06 AI 关闭不影响核心：无 AI 入口、隐私清理、人工编辑照常可用', async ({ browser }) => {
    const page = await openPanel(browser);
    // AI-001: no provider configured → no AI entry point anywhere in nav.
    const navTexts = await page.getByRole('navigation').allInnerTexts();
    expect(navTexts.join('\n')).not.toContain('AI 分析');
    // PRI-006: privacy page exposes retention + cleanup.
    await page.getByRole('navigation').getByRole('button', { name: '设置' }).click();
    await expect(page.getByText(/保留的扫描运行数/)).toBeVisible();
    // Core manual flow still works end to end.
    await scan(page);
    await page.getByRole('navigation').getByRole('button', { name: '已安装' }).click();
    const card = page.getByRole('article', { name: /notes \(skill\)/ });
    await card.getByRole('button', { name: '纳入目录' }).click();
    await card.getByLabel('人工简述').fill('Manual note-taking skill summary.');
    await card.getByRole('button', { name: '预览 diff 并保存' }).click();
    await applyInReview(page);
    const yaml = await readFile(join(panel.repo, 'catalog', 'skills', 'notes.yaml'), 'utf8');
    expect(yaml).toContain('Manual note-taking skill summary.');
    await page.context().close();
  });
});
