# 面板 UI 重设计 + 静态目录展示站 设计文档

日期：2026-09-02
状态：已批准（用户批准：深色开发者控制台方向、全量重做、自研轻量生成器、生成器 + Actions 自动部署、仅 Catalog 人工目录内容）
关联需求（用户 2026-09-02 提出）：① panel.ps1 启动多出 cmd 窗口（已修复，见 §C）；② 双击启动（已完成，见 §C）；③ 面板 UI 全面重设计；④ 静态页面展示已保存数据（GitHub Pages）。

---

## §A 面板 UI 全量重设计（深色开发者控制台）

### A.0 前提与硬约束

- **零新依赖**：不加 webfont（离线优先 + 本地服务 CSP `script-src 'self'` 不允许外链）、不加图标库（用内联 SVG）、不加 UI 框架。React 18 + hash 路由 + Vite 原样保留。
- **E2E 即契约**：`tests/e2e/panel.spec.ts`（E2E-01..07）**一行都不允许修改**。重设计只动皮不动骨。改完 `npm run test:e2e` 必须 7/7 通过。
- **i18n 结构保留**：新增/修改字符串一律进 `apps/panel/src/i18n.ts`（zh-CN 先行）。

### A.1 E2E 锚点清单（重命名/重构时必须逐条保留）

| 锚点 | 位置 | E2E 用法 |
|---|---|---|
| `h1` 文本 `AI Tools Panel` | App 壳 | E2E openPanel 落地断言 |
| 总览页 `h2` 文本 `总览` | OverviewPage | 落地断言 |
| `<header>` 内含 `[role=status]` | App 顶栏 | 所有 E2E 用 `header [role=status]` 等"扫描完成/已保存" |
| `<nav aria-label="主导航">` + 6 个按钮：`总览/已安装/目录库/规则/变更/设置` | App | E2E 用 `getByRole('navigation').getByRole('button', {name})` |
| 导航文本**不含** `AI 分析` | App | E2E-06（AI-001） |
| 卡片 `<article aria-label="{名称} ({kind})">` | InstalledPage | `getByRole('article', {name: /deploy-helper \(skill\)/})` |
| 按钮可访问名：`开始扫描`/`取消扫描`/`纳入目录`/`本地导入预览`/`预览 diff 并保存`/`仅保存元数据（默认）`/`保存片段`/`预览并保存片段`/`应用变更`/`取消`/`重试` | 各处 | 直接按键名定位 |
| label 可访问名：`人工简述`/`标签（逗号分隔）`/`名称`/`URL / Marketplace 标识`/`起始行`/`结束行`/`分类`/`全文搜索`/`筛选 {kind,provider,scope,status}` | 各处 | `getByLabel` 定位 |
| 变更审查 `h2` 文本 `变更审查`；diff `<pre aria-label>` 含 `diff` | ChangeReview | E2E-02/07 |
| 设置页含文本 `/保留的扫描运行数/` | SettingsPage | E2E-06 |
| 卡片内交互元素 DOM 顺序：`纳入目录` → （repo skill 时的 `本地导入预览`）→ 表单字段 → 提交按钮 | ObservationCard | E2E-07 盲 Tab 步进依赖该顺序 |
| `:focus-visible` 可见焦点环 | 全局 | E2E-07 键盘验收 |
| `main#main` 主内容区 | App | 布局语义 |

### A.2 设计 tokens（`styles.css` 全量重写的地基）

```css
:root {
  color-scheme: dark;
  /* 画布（GitHub Dark 系） */
  --bg: #0d1117;            /* 页面背景 */
  --surface: #161b22;       /* 卡片/侧栏/表格表面 */
  --raised: #21262d;        /* hover/按钮/输入框凸起 */
  --border: #30363d;
  --border-strong: #484f58;
  --text: #e6edf3;
  --text-muted: #8b949e;
  /* 强调与语义色 */
  --accent: #58a6ff;  --accent-emphasis: #1f6feb;
  --success: #3fb950; --success-bg: rgba(63,185,80,.15);
  --warning: #d29922; --warning-bg: rgba(210,153,34,.15);
  --danger:  #f85149; --danger-bg:  rgba(248,81,73,.15);
  --purple:  #a371f7; --teal: #39c5cf; --orange: #f0883e;
  /* 字体：徽章/路径/diff/统计数字一律等宽 */
  --font-sans: system-ui, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, 'Cascadia Code', Consolas, monospace;
  --radius: 6px; --radius-lg: 10px;
}
```

kind 徽章色：`skill`=accent 蓝、`plugin`=紫、`marketplace`=teal、`hook`=橙、`rule-document`=黄（--warning）。
reconcile 状态色：`matched`=success、`drifted`=warning、`installed-only`=accent、`catalog-only`=purple、其他=muted。

### A.3 布局

```
┌──────────┬────────────────────────────────────┐
│ sidebar  │ topbar（页面上下文 + 开始扫描/取消  │
│ 240px    │ + [role=status]）                  │
│ 固定     ├────────────────────────────────────┤
│          │ main（max-width 1200 居中）        │
└──────────┴────────────────────────────────────┘
```

- **侧栏**（`<aside>` + `<nav aria-label="主导航">`）：顶部品牌 `h1`（保留文本 "AI Tools Panel"）；6 个导航项 = 内联 SVG 图标 + 文字，`aria-current='page'` 高亮（左侧 2px accent 竖条 + raised 底）；底部常驻状态区：仓库状态与连接状态小字（badge 化）。
- **顶栏**：仍是 `<header role="banner">`，含开始扫描/取消按钮（primary 样式：accent-emphasis 底白字）与 `[role=status]`（等宽小字）。
- **banner**（离线 / 非 Git 仓库诊断）：danger 左边条 + danger-bg，保留 `role="alert"`。
- **响应式**：≤860px 侧栏收为顶部横向图标条（flex 换行），保 E2E 桌面视口优先。

### A.4 组件规格

| 组件 | 规格 |
|---|---|
| `StatCard` | surface 底 + border，数值等宽大号，label muted |
| 卡片 `ObservationCard` | surface 底、border、radius-lg；hover 边框变 accent、轻微上移；标题行 = kind 图标 + `h3`；徽章行；desc 两行截断；路径 `<code>` 等宽小字 muted |
| 徽章 `.badge` | 等宽字体、radius 小、透明底 + 语义色边/字；kind 徽章带浅色底（*-bg） |
| 表格 | surface 圆角容器、行 hover raised、sticky 表头、路径列等宽 |
| `DiffView`（新组件 `components/DiffView.tsx`） | 按行解析 unified diff 渲染 `<pre>`（保留传入 aria-label）：`+++`/`---` 文件头 muted、`@@` hunk 头 accent、`+` 行 success-bg/success 字、`-` 行 danger-bg/danger 字、其余正常；ChangeReview 与 ChangesPage 共用 |
| `EmptyState`（新，页面共用） | 居中图标 + 标题 + 提示 + 可选行动按钮（"尚未扫描"→ 开始扫描）；保留 `role="status"`/`className="empty"` 语义 |
| 表单/输入 | raised 底 + border，focus 时 accent 边 + `:focus-visible` outline；select 同步深色（`color-scheme: dark` 自动处理） |
| `.diagnostics` | `li.error` danger、`li.warning` warning，`code` 等宽 |
| 变更审查 `.review` | surface 卡片，文件折叠列表（`<details>` 样式化），diff 用 DiffView |
| 分页 `.pager` | 按钮组 + 计数等宽小字 |

### A.5 图标（新组件 `components/Icons.tsx`）

内联 SVG（16×16，stroke=currentColor，1.5px，GitHub Octicons 风格线稿自绘）：`overview`=网格、`installed`=方块/盒、`catalog`=书、`rules`=文档、`changes`=git-compare、`settings`=齿轮、`scan`=雷达/搜索、`alert`=三角。导航、空状态、kind 徽章复用。

### A.6 文件清单与验收

改动：`apps/panel/src/styles.css`（全量重写）、`App.tsx`（布局重构）、`components/DiffView.tsx` 与 `components/Icons.tsx`（新增）、6 个页面 + `ChangeReview.tsx`（类名/空状态/图标微调）、`apps/panel/index.html`（加 `<meta name="color-scheme" content="dark">` 与 `theme-color`）。
**禁止改动**：`tests/e2e/**`、`apps/panel/src/api.ts` 对外接口、`i18n.ts` 既有 key。
验收：`npm run verify` 全绿 + `npm run test:e2e` 7/7 + 开发中 Playwright 截图人工审视觉。

---

## §B 静态目录展示站（生成器 + GitHub Pages 自动部署）

### B.1 架构与数据流

```
catalog/*.yaml|md + sources.lock.yaml
        │  packages/site-generator CLI（Node，复用 @aitp/catalog 的
        │  FileSystemCatalogStore/parseCatalogYaml —— 不重写 YAML 逻辑）
        ▼
  字段白名单投影 → 安全门（fail-closed）→ 确定性序列化
        ▼
  site-dist/index.html（单文件自包含）
```

- 新 workspace 包 **`packages/site-generator`**（TypeScript，NodeNext，依赖仅 `@aitp/contracts` + `@aitp/catalog`；bin：`aitp-site-gen`）。
- CLI：`node packages/site-generator/dist/cli.js --root <repoRoot> --out site-dist [--site-title "…"] [--site-url <base>]`；默认 root=process.cwd()。
- 根 `package.json` 增加：`"site:build": "node packages/site-generator/dist/cli.js --root . --out site-dist"`。
- `.gitignore` 增加 `site-dist/`。
- 根 `tsconfig.json` references 增加 `packages/site-generator`；`apps/local-agent` 不依赖它。

### B.2 输出形态：单文件 `index.html`

- `<script type="application/json" id="aitp-data">`（数据，非可执行，不受 `script-src 'self'` 限制）+ 一个内联渲染 `<script>`（~200 行原生 JS，无框架无构建）。之所以单文件：GitHub Pages 直出可用；双击 `file://` 打开也可用（同文档 script 标签取数，无需 fetch）。本地面板的 CSP 不适用于 Pages 站点。
- 渲染 JS 支持：卡片网格、kind 筛选 chips、标签筛选、全文搜索（displayName/shortDescription/tags/id）、hash 路由详情页 `#/entry/<id>`（备注 notes、installInstructions、license 状态、来源类型/URL、ownership/contentPolicy、返回按钮）。视觉复用 §A.2 同一套 tokens。
- 静态站无 session/API，纯只读；`catalog/` 为空时输出空状态页（属预期，本仓库当前无 catalog 条目）。
- `metadata.archived: true` 的条目不展示。

### B.3 字段白名单（唯一出口，白名单外一律不进数据）

```ts
interface SiteEntry {
  kind: 'Skill' | 'Plugin' | 'Marketplace' | 'Hook' | 'RuleFragment';
  id: string;                 // metadata.id
  displayName: string;        // metadata.displayName
  shortDescription: string;   // metadata.shortDescription
  tags: string[];
  targets: string[];          // spec.targets
  ownership: string;          // spec.ownership
  contentPolicy: string;      // spec.contentPolicy
  license: { status: string; expression?: string };  // spec.license（不含 evidence/note）
  source: { type: string; url?: string; identifier?: string };
  installInstructions: Record<string, string>;       // spec.installInstructions
  notes: string;              // overlay.notes
}
```

URL 门：`source.type === 'url'|'git'` 且 URL 以 `https://` 开头才输出 `url`；`marketplace` 类型输出 `identifier`（如 `owner/name`）；其余一律不带。**永不输出**：pathToken、绝对路径、contentHash、sourceDigest、textHash、RuleFragment body/frontmatter 正文、verification、unknown、fieldOrigins。

### B.4 安全门（fail-closed，命中即构建失败并指明条目+字段，不静默删改）

1. **投影层**：只有白名单字段被读取（结构上保证多漏不出去）。
2. **输出全文扫描**（对最终 index.html 字节跑正则，复用 `scripts/secret-scan.mjs` 的 pattern 并扩展）：
   - Windows 盘符路径 `[A-Za-z]:\\`；`/Users/`、`/home/`；`%USERPROFILE%|%HOMEPATH%`；`<redacted:` 标记
   - 私钥头、`AKIA…`、`ghp_/gho_/ghu_/ghs_/ghr_`、`sk-…`、`xox…`（同 secret-scan）
   - 邮箱（用户 PII，宁可误报 fail）
   - 高熵赋值 `api[_-]?key|secret|token|password … : … 32+`
   - 注意 allowlist：测试 fixture 标记值（如 `aitp-e2e-not-a-secret` 类明显示例值）按 secret-scan 的 ALLOWLIST/EXAMPLE 惯例处理。

### B.5 确定性

- 输出**不含时间戳**（不写 generatedAt）；同一 catalog 输入两次构建必须**字节级一致**（vitest 断言 `build()` 两次返回相同 Buffer/string）。
- tokens 同步护栏：单测从 `apps/panel/src/styles.css` 与 `packages/site-generator/src/template.ts` 各自正则抽取 `--bg/--surface/--border/--text/--accent` 等 token 值断言一致。

### B.6 部署（`.github/workflows/site.yml`）

```yaml
name: Site
on:
  push:
    branches: [main]
    paths: ['catalog/**', 'sources.lock.yaml', 'packages/site-generator/**', '.github/workflows/site.yml']
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci --no-audit --no-fund
      - run: npm run build          # 含 site-generator 编译；构建失败即不部署
      - run: npm run site:build
      - uses: actions/upload-pages-artifact@v3
        with: { path: site-dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: '${{ steps.deployment.outputs.page_url }}' }
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

一次性人工步骤（发布阶段）：Settings → Pages → Source: **GitHub Actions**（当前 `has_pages: false`，API 已确认；按 Git 规则不由 AI 擅改远端配置）。目标地址：`https://super-yyq.github.io/AI-Tools-Panel/`。

### B.7 测试（进 `npm run verify`，`packages/site-generator/test/`）

1. 白名单：构造含 pathToken/contentHash/RuleFragment body 的 entry → 输出 JSON 断言不含这些字段/值。
2. 安全门：URL `http://`（非 https）→ url 字段不出现；本地路径/`<redacted:`/token 样值进入白名单字段（如 notes）→ 构建失败且错误信息含条目 id 与字段名。
3. 无效 YAML → 诊断错误（不产出站点）。
4. archived 条目被排除。
5. 确定性：两次构建输出一致。
6. HTML 冒烟：内嵌 JSON 可 `JSON.parse`、条目数吻合、含渲染脚本与 tokens。
7. tokens 与面板 styles.css 一致（B.5）。

### B.8 文档

README：新增"静态目录站"章节（本地 `npm run site:build` + Pages 说明）；`docs/SECURITY_AND_GIT.md`：站点字段白名单与安全门；`docs/PROGRESS.md`：记录新工作项。

---

## §C 已完成的前置修复（本次会话，已验证）

1. **多余 cmd 窗口**：`apps/local-agent/src/start.ts` —— 根因是 `exec('start "url"')` 的第一个引号参数被 `start` 当作窗口标题，Windows 先开 cmd 载体窗口。已改为 `spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()`（空参占标题位；隐藏辅助控制台；浏览器独立于服务）。typecheck/build/实机冒烟通过。
2. **双击启动**：新增根目录 `start-panel.cmd` —— 检查 Node → 首次 `npm install`/`npm run build` → `node apps\local-agent\dist\start.js --open`；保留控制台看日志，关闭窗口即停止服务。

## §D 验收标准（整体）

- [ ] `npm run verify`（lint/typecheck/tests/schema/build）全绿
- [ ] `npm run test:e2e` 7/7（UI 重设计未破坏任何锚点）
- [ ] `npm run site:build` 在本仓库产出 `site-dist/index.html`（当前空 catalog → 空状态页）
- [ ] site-generator 测试全绿并纳入 verify
- [ ] `site.yml` 推送后 build job 绿；Pages 开启后站点可访问
- [ ] README / SECURITY_AND_GIT / PROGRESS 更新

## §E 已知限制

- 站点数据仅在 push（或手动 workflow_dispatch）时更新；本机未提交的 catalog 变更不会出现在线上。
- 安全门允许误报（fail-closed）；确需放行的特例走代码内 allowlist，不走配置开关。
- 单文件内联渲染脚本与内嵌 JSON 使 `index.html` 随条目增长线性变大；条目 > 数千时再考虑拆分（当前规模不必要）。
