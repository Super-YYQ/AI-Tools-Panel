# 实施计划

## 1. 执行规则

- 按 milestone 顺序实现，除非用户明确指定其他阶段。
- 每个 milestone 从 contract/fixture 开始，以退出条件结束。
- 代码、schema 和测试是可执行事实；行为改变时同步更新需求编号和 ADR。
- 第三方项目只在许可证允许时复用代码，并保留 notice；AEM BSL 与无许可证项目仅作行为参考。
- 每个任务保持垂直可验证，避免一次提交跨越多个 milestone 的大范围占位代码。

## 2. 依赖图

```text
M0 Scaffold & contracts
 ├─► M1 Catalog + ChangeSet
 ├─► M2 Inventory core + adapters
 │        └─► M3 Local API + scan orchestration
 │                  └─► M4 Web console
 └────────────────────────► M5 Reconcile + rules workflows
                               └─► M6 Optional AI enrichment
M0..M6 ─► M7 Security, packaging, release candidate
```

## 3. Milestone 0：Scaffold 与可执行 Contract

### 任务

- **M0-01** 创建 pnpm TypeScript workspace、根 scripts、格式化、lint、typecheck、Vitest 和 Playwright 基础配置。
- **M0-02** 创建 `apps/local-agent`、`apps/panel` 和 `packages/*` 空壳，建立依赖边界检查。
- **M0-03** 固定 active LTS Node 和 package manager 版本，提交 lockfile。
- **M0-04** 建立 Artifact、Observation、Diagnostic、CatalogEntry、ChangeSet、AnalysisProposal 的 Zod schema 与 JSON Schema 生成。
- **M0-05** 定义 stable error envelope、ProviderAdapter、InventoryStore 和 CatalogStore interface。
- **M0-06** 创建 `scripts/panel.ps1` 和包脚本；未构建时给出明确安装/构建提示。
- **M0-07** 建立 Windows CI、secret scan、license report 和文档链接检查。
- **M0-08** 做 SQLite Windows spike，记录选择或替代实现到 ADR-011。

### 退出条件

- 全新 clone 按 README 命令可安装依赖、运行空面板和 health endpoint；
- `verify` 聚合 lint、typecheck、unit、schema、build；
- package boundary 测试能阻止反向依赖；
- JSON Schema 有合法/非法最小 fixture；
- Windows CI 成功。

## 4. Milestone 1：Catalog、schema 与 ChangeSet

### 任务

- **M1-01** 实现 Catalog 目录发现、YAML/Markdown parse 和版本检查。
- **M1-02** 实现稳定序列化、未知字段保留和 per-kind schema。
- **M1-03** 实现 ID/alias/source/license/contentPolicy 规则。
- **M1-04** 实现 Catalog draft、ChangeSet、unified diff、expected hash 和 apply token。
- **M1-05** 实现路径 allowlist、临时文件、原子替换、journal/recovery。
- **M1-06** 实现 `sources.lock.yaml` 读写 contract，不做远程 resolver。
- **M1-07** 实现 Rule Fragment Markdown round-trip。
- **M1-08** 创建 CLI/test harness，能从 fixture 预览和应用 Catalog 变更。

### 退出条件

- CAT-001–009、GIT-001/004/005 的非 UI 部分有测试；
- 同一对象重复序列化无 diff；
- 外部编辑、写入故障和路径越界不会损坏原文件；
- metadata-only、archived 和 rule fragment 流程通过。

## 5. Milestone 2：Inventory Core 与 Provider Adapters

### 任务

- **M2-01** 实现 ScanRun 状态机、稳定 normalization、hash、identity 和 delta。
- **M2-02** 实现 Windows path token、realpath/junction/symlink policy。
- **M2-03** 建立 Claude fixture 和 adapter：Skills、Plugin、Marketplace、Hook、规则文档/片段候选。
- **M2-04** 建立 Codex fixture 和 adapter：Skills、Plugin/Catalog Source、Hook、AGENTS 规则链。
- **M2-05** 实现 source evidence、copy role、重复关系和 provisional identity。
- **M2-06** 实现 diagnostics、partial scan、limits、cancellation 和 incremental cache。
- **M2-07** 实现敏感字段/path token redaction。
- **M2-08** 用至少一台真实 Windows 环境做只读 exploratory test，只把合成 fixture 加入仓库。

### 退出条件

- SCAN-001–009 通过 fixture/contract 测试；
- 重复运行 ID、排序和 hash 相同；
- malicious Hook/Skill/Plugin fixture 未执行；
- 空环境、仅 Claude、仅 Codex、两者并存、损坏文件和权限失败均有结果；
- 日志和 Store 不含 fixture secret 原文。

## 6. Milestone 3：Local API 与编排

### 任务

- **M3-01** Fastify server、loopback bind、动态端口和 health。
- **M3-02** session token、cookie、Origin/CSRF、CSP、body/rate limit。
- **M3-03** scan create/status/cancel/SSE endpoints。
- **M3-04** inventory/artifact/diagnostic/query endpoints。
- **M3-05** catalog draft/ChangeSet/preview/apply endpoints。
- **M3-06** git summary/diff endpoint，只读调用原生 Git。
- **M3-07** OpenAPI 由 route schema 生成，并在 CI 检查变更。
- **M3-08** PowerShell 启动器等待 health、打开浏览器并处理端口/进程错误。

### 退出条件

- APP-001–005 的后端部分通过；
- API contract、幂等、取消、partial 和 conflict 集成测试通过；
- localhost CSRF/Origin/session 安全测试通过；
- 没有 Agent 控制、安装执行或 push endpoint。

## 7. Milestone 4：Web 控制台

### 任务

- **M4-01** 应用壳、导航、仓库状态、扫描状态和诊断中心。
- **M4-02** 总览统计与 delta。
- **M4-03** 已安装卡片/列表、URL 筛选、搜索、虚拟化/分页。
- **M4-04** Artifact 详情，区分 fact/overlay/proposal。
- **M4-05** 目录库浏览、手工收藏、从 Observation 创建 draft、Overlay 编辑。
- **M4-06** 变更页、diff、检查、apply/conflict/reload。
- **M4-07** 通用 loading/empty/partial/stale/offline/error 状态。
- **M4-08** 键盘、焦点、screen reader、对比度、200% zoom 和窄窗口验证。

### 退出条件

- UI-001–007 核心页面通过 component/E2E；
- 2,000/5,000 条 fixture 的搜索和筛选目标达成；
- 不使用鼠标可完成扫描、查阅、编辑、diff 和保存；
- 无 AI Provider 和离线模式完整可用。

## 8. Milestone 5：Reconcile、规则与来源工作流

### 任务

- **M5-01** 实现 installed-only/catalog-only/matched/drifted/ambiguous/missing-source/archived。
- **M5-02** 实现 confirmed source、alias、content relationship、人工 link 匹配。
- **M5-03** 实现规则加载链、行索引、import 图、循环诊断。
- **M5-04** 实现静态规则分类、重复/冲突候选。
- **M5-05** 实现保存 Rule Fragment 的 ChangeSet 流程。
- **M5-06** 实现本地自定义 Skill metadata-only/import preview 与 vendoring 门禁。
- **M5-07** 实现远程收藏 resolver 和 `sources.lock`，遵守离线/大小/redirect/digest 策略。

### 退出条件

- PRODUCT_SPEC 四个非 AI 用户流程全部 E2E 通过；
- RULE-001–005 与 CAT-003–005 通过；
- 重扫保留 Overlay；
- source/许可证未知不会被静默升级；
- vendoring 只复制 preview 文件并保留 notice。

## 9. Milestone 6：可选 AI Enrichment

### 任务

- **M6-01** 实现 provider-neutral interface、本地 profile 与 credential adapter。
- **M6-02** 实现 input minimization、redaction、digest 和 payload preview。
- **M6-03** 实现五类 Task schema、prompt template version 和 output validation。
- **M6-04** 实现 job/cancel/timeout/retry/cache。
- **M6-05** 实现 Proposal UI、evidence、confidence、逐项接受/拒绝/supersede。
- **M6-06** 实现 field policy，阻止 AI 覆盖 confirmed source/license/facts。
- **M6-07** prompt injection、非法输出和敏感数据测试。

### 退出条件

- AI-001–006 和 AI_ENRICHMENT_SPEC 完成标准通过；
- 禁用/失败 AI 不改变核心功能或 Catalog；
- raw prompt/response 不进入普通日志或 Git；
- 接受 Proposal 仍经过 ChangeSet。

## 10. Milestone 7：Hardening 与发布候选

### 任务

- **M7-01** 完整安全测试门、依赖审计、SBOM、license report。
- **M7-02** Windows fresh-machine、Unicode 路径、长路径、受限权限和 Defender/SmartScreen 行为测试。
- **M7-03** 性能 profile、内存和大 fixture 优化。
- **M7-04** schema migration/recovery/backup 演练。
- **M7-05** 文档、示例 Catalog、错误恢复和隐私说明。
- **M7-06** 构建产物内容审计、checksum；安装器只在用户确认需要时实现。

### 退出条件

- PRODUCT_SPEC v1 总体验收全部通过；
- TEST_STRATEGY release gate 全绿；
- 无 high/critical 已知安全问题；
- fresh clone/start/scan/edit/diff/apply 手工验收通过；
- release notes 列出 schema、限制和已知问题。

## 11. 建议的首批垂直提交

1. `chore: scaffold workspace and verification`
2. `feat(contracts): define artifact and catalog schemas`
3. `feat(catalog): parse and diff catalog entries`
4. `feat(scanner): add inventory core and fixture adapter`
5. `feat(claude): scan skills and rule documents`
6. `feat(codex): scan skills and agents guidance`
7. `feat(api): expose scan and catalog preview`
8. `feat(panel): browse inventory and artifact details`

提交名称是建议，不授权自动 commit 或 push。
