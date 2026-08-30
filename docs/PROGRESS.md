# 开发进度记录

最后更新：2026-08-30（第五轮：补齐审计测试清单缺口、P1-PRI-05、终态事件证据与 Phase 5 可自动化部分）。证据为仓库内可运行测试与脚本。

## v0.1.1 审计响应状态

### Phase 0 — Release Blocker Stabilization（完成）

| 项 | 状态 | 证据 |
|---|---|---|
| P0-REL-01 clean build | 完成 | 9 个 tracked `*.tsbuildinfo` 移出 Git 并 ignore（CI TS7016 根因）；全部包 `exports` 增加 `types` condition；`typecheck` 改为真实 `tsc -b .`；`npm run clean` + `npm ci` + `verify` 全绿 |
| P0-REL-02 确定性安装 | 完成 | CI 使用 `npm ci`（含 npm cache） |
| P0-REL-03 安全门全执行 | 完成 | CI 无条件依次执行 verify/integration/security/docs/secret/license/SBOM/artifact audit；E2E 独立 job（Chromium） |
| P0-REL-04 依赖漏洞门 | 完成 | `diff@9`、`vite@6.4.3+`、`vitest@3.2` 升级后 `npm audit` 为 **0 vulnerabilities**；CI 中 `npm audit --omit=dev --audit-level=high` 无 `|| true`，high+ 直接失败 |

### Phase 1 — Security Boundary Hardening（完成）

| 项 | 状态 | 证据 |
|---|---|---|
| P0-SEC-01 Catalog entry 穿越 | 完成 | `GET /catalog/entry` 经 `resolveSafeReadPath`（catalog/ 前缀 + 扩展名 + realpath）；9 类穿越向量（`../`、编码、混合分隔符、UNC、盘符、ADS、`.aitp`）集成测试 + junction 泄漏测试 |
| P0-SEC-02 SafePath API | 完成 | `packages/security/src/safe-path.ts`：`resolveSafeReadPath`/`resolveSafeWritePath`（lexical → allowlist → nearest-ancestor realpath → link 拒绝）；接入 `applyChangeSet`（写前+rename 前双检+写后 containment/hash 校验）、`FileSystemCatalogStore.loadRaw`、rules content、vendoring preview |
| P1-SEC-03 全 API 鉴权 | 完成 | 除 `/health` 外所有 `/api/v1/**`（GET 含）要求 session；SSE 不再接受 `?session=` query token；测试覆盖匿名 GET 401 |
| P1-SEC-04 Host/Origin/TTL | 完成 | Host 白名单（127.0.0.1/::1/localhost）拒绝 DNS rebinding；写请求 Origin 校验；session 空闲 TTL 30 分钟（`SESSION_EXPIRED` 测试） |
| P1-SEC-06 CSP/headers/rate limit | 完成 | CSP（self，无 inline script）、nosniff、DENY、no-referrer；600 req/min 固定窗口限流 |
| P1-SEC-07 Runtime validation | 完成 | 全部路由 body/query/param 走 Zod（draft DTO、applyToken、observationId、vendoring pathToken、数组上限等），非法输入 400 `INVALID_REQUEST` |
| P1-SEC-08 bounded read | 完成 | `readTextCapped` stat 先行，超限文件不进入内存 |

说明：P1-SEC-05 的完整 cookie-bootstrap 流程按审计允许的过渡方案执行——保留 header token 但满足其前置条件（GET 鉴权、严格 Host/Origin、TTL、token 不进 query）；cookie 通道已支持，`POST /session/bootstrap` 换发流程留待 v0.2。

### Phase 2 — Privacy & Persistence（完成）

| 项 | 状态 | 证据 |
|---|---|---|
| P1-PRI-01 sanitizeObservation | 完成 | `inventory-core/sanitize.ts` 在两个 store 持久化前统一清洗（按 kind 白名单 + 再脱敏 + 绝对路径清除） |
| P1-PRI-02 Summary 白名单 | 完成 | claude/codex adapter 不再持久化 raw frontmatter/manifest/settings；测试断言 `summary.manifest`/`frontmatter` 不存在 |
| P1-PRI-03 SQLite retention | 完成 | 保留最近 10 次成功/partial 且 30 天内；`DELETE /api/v1/history`、`/api/v1/proposals` 清理端点 |
| P1-PRI-04 重启恢复 | 完成 | `startServer` 加载 last successful run；集成测试验证重启后 inventory 立即可见、新扫描基于该 baseline |
| P1-PRI-04 AI payload | 完成 | `buildPayload` 按任务最小化字段（后续可再细分 per-task allowlist，见限制） |
| P1-PRI-06 隐私页 | 完成 | Settings 显示 DB 路径 token、保留 run 数、AI 状态，一键清除历史/Proposal（E2E-06 覆盖） |

### Phase 3 — Core Correctness（核心项完成，v0.2 范围内继续）

| 项 | 状态 | 证据 |
|---|---|---|
| P1-FUN-01 AGENTS chain | 完成 | `adapter-codex/src/agents-chain.ts`：真实文件存在性、override beats fallback、root→CWD 顺序、user 全局；dirToken 为 repo-relative/`<user>`；fixture 覆盖仅 fallback/仅 override/两者/root+child/user+repo/missing |
| P1-FUN-02 SourceIdentity | 完成 | Observation 契约新增 `sourceIdentity`（git/marketplace/local-authored/unknown）；codex plugin manifest source → 结构化 git identity |
| P1-FUN-03 Reconcile 管道 | 完成 | 匹配顺序：confirmed source identity → content digest → alias；名称相似仅产生 suggestion，不再自动 match |
| P1-FUN-04 Favorite 语义 | 完成 | unknown/url 来源无匹配 → `catalog-only`（不再误判 missing-source）；单测+E2E-03 覆盖 |
| P1-FUN-05 Scan cancel | 完成 | `POST /scans/:id/cancel` + UI 取消按钮 + 异常时发布 terminal failed 事件 |
| P1-FUN-06 SSE 客户端 | 完成 | 面板使用 fetch-stream 消费 `/scans/:id/events`（header 会话），删除 300ms 轮询 |
| P1-FUN-07 Git diff | 完成 | `GET /api/v1/git/diff` 只读、仅 app-owned 路径、256KB 截断；变更页展示完整 diff |
| P1-FUN-08 Typed draft | 完成 | draft DTO（entries/fragments）+ Zod 校验，YAML/Markdown 序列化只存在于服务端 `serializeCatalogEntry`/`serializeRuleFragment` |

### Phase 4 — Web Console UX（核心项完成）

- P1-UI-01：`bootstrapSession()` 先于路由消费/清除 session fragment；首屏始终总览，URL 不含 token（E2E 断言）。
- P1-UI-02：`App.tsx` 拆分为 `pages/{Overview,Installed,Catalog,Rules,Changes,Settings}Page` + `components/ChangeReview` + `api.ts`。
- P1-UI-03：Change Review 页（完整 diff、expected hash 提示、应用/取消），所有写入流程不再使用 `window.confirm`/600 字符截断。
- P1-UI-05：搜索防抖 150ms + 预计算 searchableText（无逐键 JSON.stringify）+ 每页 50 条分页。

### 暂缓（按审计 §10/§13）

- 真正 vendoring 文件复制（保持 metadata-only 默认）、Remote Resolver 在线实现、AI UI、新 Provider、安装器打包（v0.3 阶段评估）。
- M7-02 中 fresh-machine 全流程验收与 Defender/SmartScreen 交互为发布阶段人工项。

## 验证命令与当前结果

```powershell
npm run verify        # lint + typecheck + 130 通过/1 平台跳过 + schema:check + build
npm run test:e2e      # Playwright Chromium：E2E-01..06 全过
npm run secret:scan   # 通过
npm run license:report / sbom:generate / artifact:audit   # 通过（23 产物经 SBOM 校验）
npm audit --omit=dev --audit-level=high   # 0 vulnerabilities
npm run docs:check    # 通过
```

### 第五轮补齐（审计遗留缺口闭环）

| 项 | 状态 | 证据 |
|---|---|---|
| Phase 1 测试清单：rule symlink 越界 | 完成 | `apps/local-agent/test/security/boundary.test.ts`：扫描后把 rules 目录换成越界 junction，`/rules/:id/content` 返回 `PATH_REJECTED` 且响应不含密钥 |
| Phase 1 测试清单：vendoring junction 越界 | 完成 | 同套件：skill 目录换成越界 junction，`/vendoring/preview` 400 `PATH_REJECTED` |
| P1-PRI-05 per-task payload allowlist | 完成 | `enrichment/src/index.ts` `TASK_FIELDS`（summary/tags/rule-classification/source-candidates/local-import-suggestion 各自字段白名单）；14 个单测：任务间 payload 键集不同、digest 不同、allowlist 外字段整体丢弃、allowlist 内密钥被脱敏 |
| Phase 3：cancel → cancelled | 完成 | 慢速 fake adapter 测试：SSE `done` 事件 `status:'cancelled'` 且持久化 run 状态为 cancelled |
| Phase 3：provider 异常 → terminal | 完成 | 两个测试：discover 抛异常 → `partial` + `PARTIAL_SCAN` 诊断；store 写入失败 → `failed` 终态事件（无悬挂） |
| Phase 2 验收断言链 | 完成 | 同套件在 Skill frontmatter/Plugin manifest/Marketplace manifest/Hook/Rule/恶意 JSON 诊断六处植入 marker，断言 marker 不出现在 SQLite 字节、HTTP inventory 响应、agent.log、Git 工作树；diagnostics 持久化前统一 redact（`sanitizeDiagnostics`）；AI payload 由同一批 observations 构建（断言不含 marker） |
| P2-UI-06 状态体验 | 完成 | App 增加 connection 状态机（connecting/online/offline）：离线横幅 + 重试按钮、扫描按钮禁用；Overview never-scanned 提示、诊断区 |
| P2-UI-07 i18n 基础 | 完成 | `apps/panel/src/i18n.ts` zh-CN 字典 + `t()`；App 壳/Overview/Settings/Changes 已迁移到 key；新增 locale 只需加字典 |
| Phase 5 REL-01/02/03 portable | 完成 | `npm run package:portable` → `release/AI-Tools-Panel-v<ver>-portable-win.zip`（agent dist + panel dist + 生产依赖含 better-sqlite3 预编译二进制 + 无 npm install 启动器 + SHA-256 checksums.txt）；冒烟验证：包内 agent 启动并创建 WAL SQLite 库 |
| Phase 5 REL-04 fresh-machine matrix | 文档化 | 见下方人工清单（自动化需要真实 fresh 虚机，属发布阶段执行项） |

### REL-04 fresh-machine 人工验收清单（发布阶段执行）

1. Windows 11 普通用户权限 + 中文用户名/路径 → `panel-portable.ps1` 启动、扫描、编辑、apply。
2. 长路径（>260）仓库扫描。
3. Defender 实时保护开启下的首次启动与扫描（SmartScreen 提示确认）。
4. 无 Claude / 无 Codex / 仅其一 / 两者并存：健康端点与扫描诊断符合预期。
5. 无 Git 仓库目录：面板给出可执行诊断（APP-002）。

## 已知限制

1. cookie bootstrap（`POST /session/bootstrap` 换发 HttpOnly cookie + CSRF token）未实现，采用审计允许的 header 过渡方案。
2. i18n 迁移完成 App 壳/Overview/Settings/Changes；Installed/Catalog/Rules 页面字符串迁移为后续小任务。
3. 性能基线（2000/4.8s、5000 筛选 <150ms）在开发机测得，CI runner 复核待锁定；perf 测试带 retry:2 容差。
4. portable 包当前要求系统 Node 22+ x64；无 Node 环境的自包含发行（内嵌运行时或安装器）待用户确认需求后实现（DECISIONS 待决事项）。
