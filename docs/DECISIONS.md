# 架构决策记录

状态值：`accepted`、`proposed`、`superseded`。实现若改变 accepted 决策，先在本文追加替代决策并记录迁移影响。

## ADR-001：Git Catalog 与 Machine Inventory 分离

- 状态：accepted
- 决策：人工长期维护数据使用仓库 YAML/Markdown；机器路径、实时状态和扫描原文使用 app-owned local store。
- 原因：Git 适合审阅意图和说明，不适合保存凭据、绝对路径和频繁变化的机器状态。
- 结果：必须实现 reconcile；UI 同时表达 installed-only 与 catalog-only。

## ADR-002：确定性扫描是核心，AI 是可选 Proposal

- 状态：accepted
- 决策：adapter 通过文件和受支持元数据发现事实；AI 只处理脱敏输入并输出可拒绝 Proposal。
- 原因：扫描必须可重复、离线可用且可追溯，LLM 不能证明来源、许可证或安装状态。
- 结果：所有核心验收在无 AI Provider 下通过；AI 不修改 Observation。

## ADR-003：本机 Web UI + Local Agent

- 状态：accepted
- 决策：使用 React/Vite Web UI 和 Node/Fastify loopback 服务；浏览器不直接访问文件系统。
- 原因：符合用户的本机 Web 控制台目标，同时隔离 UI 与文件/Git 权限。
- 结果：需要 loopback session、Origin/CSRF 防护和明确 API contract。Tauri 仅作为未来可选壳。

## ADR-004：TypeScript monorepo

- 状态：accepted
- 决策：应用和共享包使用 TypeScript workspace；推荐 pnpm、当前 active LTS Node.js、React、Vite、Fastify、Zod/JSON Schema、Vitest、Playwright。
- 原因：Claude/Codex 配置以 Markdown/JSON/TOML/YAML 为主；统一语言减少 contract 重复，Windows 分发简单。
- 结果：scaffold 时用 `packageManager`、`.nvmrc`/等价文件和 lockfile 固定实际版本；依赖版本以仓库配置为权威。

## ADR-005：Provider adapter 不写 Catalog

- 状态：accepted
- 决策：adapter 只实现 detect/discover/parse；normalization、identity、reconcile 和 persistence 属于核心包。
- 原因：防止 Provider 路径语义侵入通用 schema，并让扫描保持只读。
- 结果：新增 Provider 必须通过 adapter contract suite。

## ADR-006：每个主 Artifact 一个 Catalog 文件

- 状态：accepted
- 决策：Skill/Plugin/Marketplace/Hook 使用独立 YAML；Rule Fragment 使用 Markdown + frontmatter。
- 原因：减少 Git 冲突、提高 diff 可读性、允许单条 schema 迁移。
- 结果：关系用 ID 引用；批量索引在运行时生成，不提交易过期聚合文件。

## ADR-007：Installed configuration 在 v1 只读

- 状态：accepted
- 决策：v1 不安装、卸载、启停或改写 `~/.claude`、`~/.agents`、Provider settings 和原始规则文件。
- 原因：产品目标是扫描与目录沉淀；机器配置写入会显著扩大安全、回滚和版本兼容范围。
- 结果：安装说明只展示；所有 v1 写入限制在仓库 Catalog 和 app-owned local store。

## ADR-008：ChangeSet 驱动所有仓库写入

- 状态：accepted
- 决策：Catalog 写入先生成 unified diff、expected hashes 和检查结果，再用一次性确认 apply。
- 原因：可审阅、防外部编辑覆盖、便于安全门禁和测试。
- 结果：UI 不能绕过 ChangeSet 直接写文件；v1 不自动 stage/commit/push。

## ADR-009：来源与许可证需要证据等级

- 状态：accepted
- 决策：source/license 使用 confirmed、candidate、unknown 等状态；AI 和名称匹配不能确认为事实。
- 原因：避免错误归因和未经许可 vendoring。
- 结果：metadata-only 是第三方与未知资产默认策略。

## ADR-010：本地服务不提供远程或 Agent 控制

- 状态：accepted
- 决策：只绑定 loopback；不实现手机 App、局域网服务、Agent 会话启动/控制、审批或终端协议。
- 原因：这些能力不属于扫描配置资产目标，并会扩大认证与执行风险。
- 结果：页面和 API 中不出现相关 endpoint；未来需求必须新建威胁模型和 ADR。

## ADR-011：Local Inventory Store 通过接口隔离

- 状态：accepted
- 决策：生产首选 SQLite，核心只依赖 `InventoryStore` 接口；测试使用内存实现。
- 原因：需要增量扫描、delta 和诊断查询，同时避免数据库渗透领域逻辑。
- 结果：SQLite 库选型在 Milestone 0 用 Windows 安装/打包 spike 验证；若原生依赖不可靠，可替换实现而不改 contract。

## 开发前仍需确认的产品事项

以下不会阻止 Milestone 0–2，但发布前需要用户决定：

- 仓库最终开源许可证；
- 是否需要打包为安装器，还是长期使用仓库快捷命令；
- 是否允许提交脱敏机器 snapshot，默认答案为否；
- 首批 UI 语言仅中文还是中英双语，默认先中文并保留 i18n 结构。
