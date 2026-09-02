# AI Tools Panel v1.0.0 Release Notes

发布日期：2026-09-02

v1.0.0 是首个正式发布版本：确定性扫描、本地 Web 浏览/编辑、Git 可审阅的目录变更三条主线全部可用，且不依赖 AI 与网络。

## 新增与核心能力

- **确定性扫描**：发现 Claude Code 与 Codex 的 Skill、Plugin、Marketplace/Catalog Source、Hook、规则文档（`CLAUDE.md`/`AGENTS.md` 链），每个发现记录 provider、scope、路径 token、内容 hash、解析器版本与证据（SCAN-001–009）。
- **本地控制台**：loopback Web 面板——总览、已安装、目录库、规则、变更、设置六页；卡片/列表、全文搜索、URL 筛选（UI-001–007）。
- **Catalog 与 ChangeSet**：人工摘要/标签/备注/安装说明保存为可 Git diff 审阅的 YAML/Markdown；所有写入先预览 unified diff，apply token 确认后原子落盘（CAT-001–009、GIT-005）。
- **Reconcile**：installed-only/catalog-only/matched/drifted 状态区分；pinned revision 需要证据，未知来源不会被静默升级。
- **隐私边界**：凭据、个人路径、Hook 命令在展示与持久化前统一脱敏；扫描历史保留上限（成功 10 次/30 天，失败 5 次/3 天），设置页一键清理。
- **可选 AI enrichment 接口**：骨架与 contract 已就位，默认关闭；关闭时全部功能可用（AI-001）。

## 安全设计

- 服务只绑定 `127.0.0.1`；非 loopback bind 启动即拒绝（SEC-103）。
- 所有 `/api/v1/**`（含 GET）需要 session token；token 只经 URL fragment 首次进入与 header/cookie 传递，不出现在 API URL。
- Origin/CSRF 校验、CSP、body/rate limit。
- 扫描器 scoped realpath containment：repo 内 symlink 指向 repo 外即拒绝读取（SEC-101）。
- ChangeSet 写入与 rollback 均经 SafePath 边界；路径越界进入 manual recovery 并保留 journal（SEC-102）。
- Hook/Skill/Plugin 内容只作数据显示，永不执行（SCAN-008）。
- 供应链：CI 强制 secret scan、license report、SBOM、构建产物审计、`npm audit --omit=dev --audit-level=high`。

## 自 v0.1.1-rc 的修复

- REL-101：E2E fixture 确定性（每用例独立实例，`.env` 动态创建），CI 全绿。
- SEC-101/102/103/104：扫描器 realpath、rollback SafePath、强制 loopback、IPv6 Host。
- PRI-101/102/103：全 Observation 字段清洗、retention 真实上限、Proposal 落库脱敏。
- FUN-101/102/103：cancelled 不覆盖 baseline、delta identity 按 scope/path 区分、pinned revision 证据。
- REL-102：portable ZIP 在 CI 与本机（含非 ASCII 路径）均做解压冒烟。
- **portable 打包修复**：Node 24.14 Windows `cpSync` 在非 ASCII 祖先路径下无 filter 递归复制会 fail-fast 崩溃（0xC0000409）；打包脚本改用 no-op filter 规避，并给 PowerShell 调用补上 `-ExecutionPolicy Bypass`（受限执行策略机器此前无法打包/解压冒烟）。
- **M7-04 演练落地**：SQLite store 增加 schema 版本记录；损坏数据库自动备份（`.corrupt-*.bak`，永不静默删除）后重建，附集成测试。
- **APP-002 可执行诊断**：非 Git 仓库时面板给出原因与修复指引（git init / 切换目录），不再只有裸标签。
- 权限 ACL 测试在 deny ACE 不生效的身份（如 Administrator）下自动跳过，消除环境性误报。

## Schema

- Catalog：`aitp.dev/v1alpha1`（Skill/Plugin/Marketplace/Hook/RuleFragment）；未知字段保留；未知 major 版本只读。
- Inventory store：`store_meta.schema_version = 1`；损坏恢复见上。

## 已知限制

1. Session token 首次经 URL fragment 传递（打开即从地址栏清除）；cookie bootstrap（HttpOnly + CSRF token 换发）计划于 v0.2。
2. i18n 已覆盖 App 壳/总览/设置/变更与本次新增诊断；其余页面字符串迁移为 v0.2 小任务。
3. portable 包要求系统 Node 22+ x64 与 Git；无自包含运行时。
4. AGENTS 链上下文固定为 Git root；子目录 context-path 选择（方案 A）在 v0.2。
5. Remote Resolver、AI Proposal UI、真正 vendoring 复制在 v0.2–v0.3。
6. 性能基线（2,000 候选增量扫描 <5s）在开发机与 CI runner 测得；perf 测试带 retry 容差。
7. AI enrichment 仅有 contract/骨架；`packages/enrichment` 的完整实现不在 v1 承诺内。

## 升级与兼容

- 首次使用：clone 后运行 `powershell -ExecutionPolicy Bypass -File scripts/panel.ps1`（详见 README）。
- 从 v0.1.x 升级：无需迁移；旧 `.aitp/inventory.db` 会被识别，若损坏自动备份重建。Catalog YAML schema 未变。

## 验证

- CI（Windows runner）：verify（lint/typecheck/158 tests/schema/build）+ integration + security + E2E 6/6 + portable 解压冒烟 + secret/license/SBOM/artifact audit + npm audit 全绿。
- 本 release notes 所述修复均对应仓库内测试； fresh-machine 人工验收（REL-04：中文用户名路径、>260 长路径、Defender/SmartScreen、无 Agent 组合）见 `docs/PROGRESS.md`。
