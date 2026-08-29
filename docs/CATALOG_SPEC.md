# Git Catalog 与存储规范

## 1. 设计原则

Catalog 是人工选择长期维护的 Git 事实源；Inventory 是机器事实。两者通过 reconcile 关联，任何一边都不能覆盖另一边的权威字段。

目标：

- 文本可读、易于 diff 和手工修复；
- 稳定 ID 与版本化 schema；
- 支持未安装收藏和已安装资产；
- 人工 Overlay 独立于第三方原文；
- 可选 vendoring 有许可证与敏感数据门禁；
- schema 升级可迁移、可回滚。

## 2. 文件布局

```text
catalog/
  skills/<id>.yaml
  plugins/<id>.yaml
  marketplaces/<id>.yaml
  hooks/<id>.yaml
  rule-fragments/<id>.md
  archived/<kind>/<id>.yaml
sources.lock.yaml
snapshots/<device-alias>/inventory.json   # opt-in and sanitized
schemas/v1alpha1/*.schema.json
.aitp/                                   # gitignored local state
```

一个主 Artifact 一个文件，降低并发冲突。Plugin 的组件关系使用引用，不把组件完整嵌套到一个巨大 YAML。

## 3. 通用 YAML 格式

```yaml
apiVersion: aitp.dev/v1alpha1
kind: Skill
metadata:
  id: source-owner-repo-code-review
  displayName: Code Review
  shortDescription: Review code against repository rules and requested behavior.
  tags: [review, quality]
  archived: false
spec:
  targets: [claude-code, codex]
  ownership: referenced
  source:
    type: git
    url: https://github.com/example/skills
    revision: 0123456789abcdef
    subdirectory: skills/code-review
  license:
    status: confirmed
    expression: MIT
    evidence: LICENSE
  installInstructions:
    claude-code: Copy or link into .claude/skills/code-review.
    codex: Copy or link into .agents/skills/code-review.
  contentPolicy: metadata-only
overlay:
  notes: Useful for final review before release.
  fieldOrigins:
    shortDescription: human
verification:
  lastVerifiedAt: 2026-08-29T00:00:00Z
  sourceDigest: sha256:example
```

示例只定义语义；实现时以 `schemas/` 中的 executable JSON Schema 为准。

## 4. 字段规则

### apiVersion / kind

- `apiVersion` 必填；未知 major 拒绝写入，未知字段读取时保留。
- `kind` 使用 PascalCase 外部值：`Skill`、`Plugin`、`Marketplace`、`Hook`、`RuleFragment`。
- Rule Document 默认属于 Inventory；只有用户明确收藏完整规则文档时才进入 Catalog。

### metadata

- `id`：仓库内全局稳定、小写 ASCII slug；创建后不因 display name 改变。
- `displayName`：人工显示名。
- `shortDescription`：面板卡片摘要；可为空，不从未知内容虚构。
- `tags`：规范化小写字符串，排序后写入。
- `archived`：软归档；默认 false。

### spec.targets

目标 Provider 集合，排序固定。它表示预期适用，不表示本机已安装。

### spec.ownership

| 值 | 含义 | 默认内容策略 |
|---|---|---|
| `authored` | 用户/团队拥有并维护 | 可允许 vendored |
| `referenced` | 远程第三方，只保存引用 | metadata-only |
| `vendored` | 已确认许可后复制进仓库 | vendored |
| `unknown` | 所有权未确认 | metadata-only |

### spec.source

使用 `SourceRef` union。Git URL 保存规范化 HTTPS/SSH identity，但 UI 可保留输入形式。revision 优先 commit hash；tag/branch 另存 display ref，不能把可变 branch 当锁定 revision。

### spec.license

```yaml
license:
  status: confirmed | candidate | unknown | incompatible
  expression: MIT
  evidence: LICENSE
  note: ''
```

AI 识别只能产生 candidate。没有 LICENSE 时 status 为 unknown；公开仓库不自动等于允许复制。

### installInstructions

人工可编辑文本或结构化步骤。扫描得到的命令只作为 observed/candidate；含 shell 元字符、凭据或远程脚本时显示风险标记。v1 不执行安装说明。

### overlay.fieldOrigins

可追踪字段来源：`human`、`imported`、`accepted-ai`。人工修改覆盖已接受 AI；重扫不覆盖 Overlay。

### verification

保存最近一次远程/本地证据验证时间和 digest，不保存机器绝对路径。

## 5. Rule Fragment 格式

```markdown
---
apiVersion: aitp.dev/v1alpha1
kind: RuleFragment
id: git-no-implicit-push
displayName: Git push authorization
targets:
  - claude-code
  - codex
categories:
  - git
source:
  document: AGENTS.md
  lines: 10-12
fieldOrigins:
  categories: human
---

Only push after the user explicitly authorizes that push.
```

`source.lines` 是上次提取证据，不作为永久身份；正文 hash 用于检测来源漂移。片段保存后可以独立维护，系统明确区分“引用原规则”与“复制后独立规则”。

## 6. Marketplace 与 Plugin 示例约束

MarketplaceEntry 保存 source 和可发现 Plugin 引用，不把完整远程 catalog 每次复制进 Git。需要离线快照时使用显式 `snapshotDigest` 和生成时间。

PluginEntry 保存：manifest identity、source、目标 Provider、组件引用、许可证、用户说明。安装副本、cache 和 enabled 状态属于 Inventory Observation。

## 7. ID 生成

创建优先级：

1. 已确认 Git/Marketplace source identity + kind + canonical package/name；
2. 已确认本仓库 authored path + kind + name；
3. provisional 内容 identity + kind + name。

生成 slug 冲突时添加短 source digest，不添加随机 UUID。provisional 条目后续确认来源时保留原 Catalog id，并新增 canonical source alias，避免 Git 文件重命名噪声。

## 8. sources.lock.yaml

锁文件只保存远程可重复解析所需信息：

```yaml
apiVersion: aitp.dev/v1alpha1
sources:
  example-skills:
    type: git
    url: https://github.com/example/skills
    requestedRef: v1.2.0
    resolvedRevision: 0123456789abcdef
    verifiedAt: 2026-08-29T00:00:00Z
    contentDigest: sha256:example
```

锁文件由确定性 resolver 更新；AI 不写 lock。网络不可用时保留最后值并标记 stale，不清空 revision。

## 9. Inventory 与 Catalog reconcile

匹配顺序：confirmed source identity、alias、vendored origin marker、content relationship、人工 link。名称相同只生成 ambiguous candidate。

Reconcile 产出：

- 状态分类；
- 事实差异，例如 observed revision/hash；
- Overlay 保留结果；
- 可选建议，例如“纳入 Catalog”“更新锁定 revision”；
- 诊断，例如“来源不再可达”。

Reconcile 本身不写文件。

## 10. Vendoring

默认 `metadata-only`。切换为 vendored 前需通过：

1. ownership/许可证人工确认；
2. secret、个人路径和高熵内容扫描；
3. 文件类型 allowlist；
4. 文件数量/大小上限；
5. 将复制文件列表和 license/notice 展示在 ChangeSet；
6. 用户明确确认。

排除项默认包括 `.git`、依赖目录、缓存、构建产物、会话、凭据、`.env*` 和本机设置。vendored 内容保存上游 source/revision 和必要 NOTICE。

## 11. ChangeSet 与原子写入

ChangeSet 包含：

```ts
interface FileChange {
  operation: 'create' | 'update' | 'archive';
  repoRelativePath: string;
  expectedOldHash?: string;
  newHash: string;
  unifiedDiff: string;
}
```

apply 顺序：

1. 验证路径仍在 Git 根；
2. 验证 expected hash；
3. 写同目录临时文件；
4. fsync/close；
5. schema/Markdown frontmatter 重新解析；
6. 原子替换；
7. 重新读取并校验 hash；
8. 清理临时文件。

多文件变更需要 transaction journal；中途失败时恢复已替换文件或明确报告可恢复状态。

## 12. Schema 迁移

- 读取旧版本时保持只读可见，并给出迁移预览；
- 迁移生成独立 ChangeSet；
- 同一迁移重复运行幂等；
- 升级前备份被修改文件到 app-owned recovery 目录，不提交备份；
- downgrade 不保证自动完成，但必须输出版本和恢复说明；
- schema fixture 覆盖当前版、上一版、未知字段和损坏文件。

## 13. Catalog 完成标准

1. 每个 kind 有 JSON Schema、合法/非法 fixture 和 round-trip 测试；
2. YAML 序列化排序稳定、保留未知字段且不产生无意义 diff；
3. Overlay 在重扫和 reconcile 后保持；
4. 未安装收藏与 installed Observation 明确分离；
5. ChangeSet 冲突、原子写入和失败恢复测试通过；
6. metadata-only 与 vendored 门禁测试通过；
7. 所有仓库路径均通过 traversal 和 symlink 边界测试。
