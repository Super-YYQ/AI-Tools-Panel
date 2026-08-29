# 测试策略与完成标准

## 1. 原则

- 测试证明 contract 和用户结果，不只证明函数被调用。
- 扫描测试使用合成 fixture；真实机器测试不提交私人配置。
- 安全边界有负向和故障注入测试。
- AI 关闭是一级测试配置。
- Windows 是主要 CI/验收平台；路径测试不能只在 POSIX 运行。

## 2. 测试层级

### Unit

覆盖纯函数：path normalization、hash、ID、frontmatter、schema、redaction、diagnostic、reconcile、serializer、AI output validation。

### Contract

所有 ProviderAdapter 运行同一套 contract suite：empty、detect、stable order、partial error、limits、cancellation、no execution。InventoryStore/CatalogStore 也有共享 contract suite。

### Fixture integration

用隔离临时目录模拟 Windows 用户目录和 Git 仓库，运行完整 adapter → normalization → store → reconcile。fixture 清单由 SCANNING_SPEC 定义。

### API integration

启动真实 Local Agent，测试 session、scan/SSE、query、ChangeSet、conflict、OpenAPI 和错误 envelope。网络只绑定临时 loopback。

### Component

React 组件测试页面状态、表单、筛选 URL、fact/overlay/proposal 区分、键盘与 ARIA。

### End-to-end

Playwright 启动 Local Agent 和 panel，执行 PRODUCT_SPEC 用户流程。使用合成 fixture 与临时 Git 仓库，检查磁盘和 `git diff`。

### Security

执行 SECURITY_AND_GIT 的 10 项安全门，包括恶意命令未执行、path traversal、CSRF、secret leak、prompt injection 和原子写故障。

### Performance

生成 2,000/5,000 条 Observation、深规则链和大 diff，记录扫描、查询、搜索、渲染、内存。阈值变化需要 ADR 或性能基线更新。

## 3. 必需 package scripts

scaffold 后提供稳定入口：

- `lint`
- `typecheck`
- `test`
- `test:integration`
- `test:e2e`
- `test:security`
- `test:performance`
- `schema:check`
- `docs:check`
- `build`
- `verify`：合并提交前的常规门，不默认运行耗时性能基准

实际包管理器前缀以根 `package.json` 为权威。

## 4. CI 矩阵

每个 PR/分支验证：

- Windows：active LTS Node，完整 `verify`、integration；
- Windows：最低支持 Node，contracts/build；
- 其他 OS：可选快速 unit/typecheck，防止纯包意外依赖 Windows；
- Playwright：至少 Chromium；
- dependency audit、secret scan、license report、文档链接；
- schema/OpenAPI 生成物无未提交差异。

定时或 release candidate 增加 security、E2E、performance、migration 和构建产物审计。

## 5. 需求追踪

| 需求组 | 最低证据 |
|---|---|
| APP-001–005 | Windows integration + fresh-clone manual/E2E |
| SCAN-001–009 | adapter contracts + fixture integration + security |
| CAT-001–009 | schema/unit + temp Git integration + E2E |
| RULE-001–005 | rule fixture integration + component/E2E |
| UI-001–007 | component + accessibility + E2E + performance |
| AI-001–006 | disabled config + mocked provider + injection/security |
| GIT-001–005 | temp Git + atomic fault injection + manual diff review |
| NFR-001–007 | repeatability, performance, offline and observability suites |

实现时在测试名称或 metadata 中引用需求 ID，例如 `SCAN-006 preserves same-name observations`。

## 6. 关键 E2E 场景

### E2E-01 首次扫描

- 临时仓库含 Claude/Codex 合成配置；
- 启动面板并扫描；
- 验证六类 Artifact、scope、诊断和 delta；
- 验证扫描后 `git status` 无变化。

### E2E-02 编辑人工简述

- 从 installed-only Skill 创建 Catalog draft；
- 修改 short description；
- 预览并 apply；
- 验证只创建目标 YAML，原 `SKILL.md` 未变化；
- 重扫后 Overlay 保留。

### E2E-03 收藏未安装条目

- 离线模式输入 URL；
- 手工补充并保存；
- 验证 catalog-only 和 source 未验证状态；
- 不产生网络请求。

### E2E-04 本地 Skill import preview

- fixture 含普通文件、secret、`.env` 和脚本；
- 验证默认 metadata-only；
- vendoring preview 排除/阻止敏感文件；
- 未确认前仓库不变。

### E2E-05 规则片段

- 展示 AGENTS/CLAUDE 加载链；
- 选择行并保存 Rule Fragment；
- 验证 source evidence 与 Markdown frontmatter；
- 原规则文件未变化。

### E2E-06 AI 失败不影响核心

- Provider 返回超时、非法 JSON、伪造 evidence 和 prompt injection；
- 验证 Proposal 不可应用或显示失败；
- Inventory/Catalog hash 不变；
- 随后仍可人工编辑并保存。

## 7. 安全断言

测试不仅检查错误返回，还检查副作用不存在：

- malicious marker file 未创建；
- 仓库外 sentinel 未修改；
- old hash conflict 下目标文件 byte-for-byte 不变；
- logs、DB、snapshot、diff、AI payload 中不存在 fixture secret；
- HTTP 跨 origin 写请求被拒绝；
- raw HTML/script 不在预览执行；
- 失败恢复后临时/journal 状态可诊断且可清理。

## 8. 性能基线

初始目标：

- 2,000 个候选文件增量扫描 5 秒内完成（常见开发机，排除首次依赖安装）；
- 5,000 条列表搜索/筛选输入到可见结果 150ms p95；
- 详情初始数据请求 300ms p95（本地已缓存）；
- SSE 高频事件批处理后 UI 不出现持续长任务；
- idle Local Agent 内存和扫描峰值在 Milestone 7 建立并锁定基线。

基准运行环境与数据生成器提交到 tests，不用开发者个人机器数据。

## 9. 单个变更的 Definition of Done

一个实现任务完成需满足：

1. 对应需求/ADR 已识别；
2. 正常、边界和失败测试齐全；
3. focused tests 与 `verify` 通过；
4. 没有新增敏感数据、越界写入或自动执行路径；
5. 用户可见行为、schema 或限制变化已更新权威文档；
6. Git diff 只含该任务相关内容；
7. 最终报告列出验证命令和未解决风险。

## 10. v1 Release Gate

- PRODUCT_SPEC 总体验收 1–7 全部通过；
- Windows fresh-clone E2E 通过；
- full unit/contract/integration/E2E/security 通过；
- 性能达到或有已接受 ADR；
- schema migration/recovery 演练通过；
- dependency/license/secret/SBOM 无阻断；
- 构建产物审计通过；
- 文档链接、需求追踪和已知限制完整；
- 没有自动 commit/push、Agent 控制或 installed config 写入功能。
