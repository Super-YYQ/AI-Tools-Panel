# 系统架构

## 1. 架构目标

系统采用 local-first、Git-first、adapter-based 架构。核心扫描和目录管理不依赖 Agent、云服务或 AI。

```text
Known files / supported CLI metadata
                 │
                 ▼
       Provider adapters (read-only)
                 │ observations + diagnostics
                 ▼
       Inventory normalization core
                 │
          ┌──────┴────────┐
          ▼               ▼
 Local Inventory Store   Reconcile Engine ◄── Git Catalog
          │               │                    YAML/Markdown
          └──────┬────────┘
                 ▼
          Local HTTP API
                 │
                 ▼
          React Web Console

 Optional: selected redacted records → Enrichment Provider → proposals
```

## 2. 运行时组件

### Local Agent

本机 Node.js 进程，职责：

- 确认 Git 根与 app-owned 数据目录；
- 调用 Provider adapter；
- 规范化 Inventory、计算 hash 和 delta；
- 读取和校验 Catalog；
- 生成 reconcile 结果和 ChangeSet；
- 通过 loopback HTTP/SSE 提供数据和扫描进度；
- 在用户确认后原子写入仓库文件；
- 可选调用 Enrichment Provider。

它不负责启动或控制 Claude/Codex，也不执行扫描内容中的命令。

### Web Console

React 单页应用，职责：

- 展示 Inventory、Catalog、规则、诊断和 ChangeSet；
- 编辑 Overlay 和手工 Catalog 条目；
- 发起扫描、校准和保存请求；
- 保持事实、人工元数据和 AI Proposal 的视觉区分。

浏览器不直接访问文件系统。所有文件变更经过 Local Agent 的 schema 校验和安全边界。

### Git Catalog

仓库中的 YAML/Markdown 事实源，保存人工选择长期维护的内容。它不保存实时进程、绝对路径、凭据或未脱敏原文。

### Local Inventory Store

app-owned、gitignored 的机器状态。首版可使用 SQLite；必须通过 `InventoryStore` 接口隔离，以便测试使用内存实现。保存 ScanRun、Observation、Diagnostic、delta 和 Analysis Proposal。

## 3. 推荐仓库结构

```text
apps/
  local-agent/          # Fastify/Node local service
  panel/                # React/Vite Web UI
packages/
  contracts/            # types, Zod/JSON Schema, error codes
  inventory-core/       # normalization, identity, delta
  catalog/              # YAML/Markdown persistence and migration
  reconcile/            # Inventory ↔ Catalog comparison
  adapter-claude/       # Claude Code discovery/parsing
  adapter-codex/        # Codex discovery/parsing
  enrichment/           # optional provider-neutral proposals
  security/             # redaction, path policy, secret scanning
schemas/
  v1alpha1/
catalog/
  skills/
  plugins/
  marketplaces/
  hooks/
  rule-fragments/
sources.lock.yaml
snapshots/              # opt-in sanitized exports only
docs/
tests/
  fixtures/
scripts/
AGENTS.md
CLAUDE.md
```

包管理器和实际命令在 scaffold 时写入 `package.json`，文档不复制可从脚本直接查询的命令清单。

## 4. 依赖方向

允许：

```text
apps → feature packages → contracts
adapters → inventory-core → contracts
catalog → contracts
reconcile → inventory-core + catalog + contracts
enrichment → contracts + security
```

禁止形成以下反向依赖：

- `contracts` 依赖应用、数据库或 Provider；
- adapter 直接写 Catalog；
- Web UI 直接导入 Node filesystem 模块；
- enrichment 修改 Inventory 事实；
- catalog schema 包含某一 Provider 的私有路径语义。

## 5. 领域模型

### ArtifactIdentity

逻辑资产身份，不包含机器路径。

```ts
type ArtifactKind =
  | 'skill'
  | 'plugin'
  | 'marketplace'
  | 'hook'
  | 'rule-document'
  | 'rule-fragment';

interface ArtifactIdentity {
  id: string;
  kind: ArtifactKind;
  canonicalName: string;
}
```

`id` 由 kind、已验证 source identity 和 canonical name 生成。来源未知时使用稳定的内容身份，并标记 provisional；路径本身不能成为跨机器 ID。

### Observation

一次机器事实：

```ts
interface Observation {
  observationId: string;
  artifactId: string;
  provider: 'claude-code' | 'codex';
  scope: 'user' | 'repo' | 'local' | 'managed' | 'system' | 'plugin';
  location: LocalPathRef;
  contentHash: string;
  sourceEvidence: Evidence[];
  enabled: boolean | 'unknown';
  discoveredAt: string;
  parser: { name: string; version: string };
}
```

### CatalogEntry

人工长期维护记录。包含 Artifact 身份、目标 Provider、SourceRef、Overlay、内容策略和验证时间，不包含机器绝对路径。

### UserOverlay

用户可编辑字段：display name、short description、tags、notes、install instructions、人工来源确认和人工规则分类。每个字段可以记录最后修改来源 `human | imported | accepted-ai`。

### SourceRef

```ts
type SourceRef =
  | { type: 'git'; url: string; revision?: string; subdirectory?: string }
  | { type: 'marketplace'; marketplaceId: string; packageId: string; revision?: string }
  | { type: 'url'; url: string }
  | { type: 'local-authored'; repositoryRelativePath?: string }
  | { type: 'unknown' };
```

`revision` 未锁定时属于 mutable source。SourceRef 的事实状态与 AI 候选分开。

### AnalysisProposal

可选校准输出，不进入 Inventory：

```ts
interface AnalysisProposal {
  proposalId: string;
  artifactId: string;
  task: string;
  claims: Array<{
    field: string;
    value: unknown;
    confidence: number;
    evidence: Evidence[];
  }>;
  provider: string;
  model?: string;
  createdAt: string;
  inputDigest: string;
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
}
```

### ChangeSet

用户确认前的仓库文件操作集合。只允许 `create | update | archive` v1 操作；delete 预留但默认不可用。ChangeSet 保存 expected old hash，避免并发覆盖。

### Diagnostic

稳定错误码、severity、Provider、目标路径的脱敏引用、消息和 recovery hint。UI 不根据自由文本判断错误类型。

## 6. 状态分类

Reconcile Engine 为每个逻辑资产产生一种状态：

| 状态 | 含义 |
|---|---|
| `installed-only` | Inventory 有，Catalog 无 |
| `catalog-only` | Catalog 有，本机未发现；常用于收藏 |
| `matched` | 两边身份一致且锁定字段无漂移 |
| `drifted` | 两边存在，但内容 hash、source revision 或关键元数据变化 |
| `ambiguous` | 多个 Observation 可能对应同一 CatalogEntry，需人工选择 |
| `missing-source` | 条目存在但来源无法重新验证 |
| `archived` | Catalog 保留历史但不进入默认列表 |

扫描器只产生 Observation；状态分类属于 reconcile，避免 adapter 携带产品策略。

## 7. 主要数据流

### 扫描

1. API 创建 ScanRun 并冻结 adapter 配置快照。
2. adapters 并行发现候选，但每个 adapter 内部保持确定性排序。
3. parser 读取文件为数据，不执行代码。
4. inventory-core 规范化、计算 ID/hash、写 Store。
5. delta 与上一成功 ScanRun 比较。
6. SSE 推送进度和最终 summary。

完成条件：成功结果、部分失败与取消都有终态；同一输入可重复得到同一排序和 ID。

### 保存 Catalog

1. UI 提交 draft 或 import intent。
2. Local Agent 校验 schema、路径和内容策略。
3. Catalog package 生成 ChangeSet、diff 和 expected hashes。
4. UI 展示 diff，用户确认 apply token。
5. Local Agent 再检查 old hash，临时写入并原子替换。
6. 重新读取文件验证并返回工作树摘要。

完成条件：成功后磁盘内容通过 schema；失败时原文件保持完整。

### 可选 Enrichment

1. 用户选择 records 和 task。
2. security package 生成最小脱敏 payload。
3. Provider 返回结构化结果。
4. enrichment 校验 schema、证据引用和 input digest。
5. UI 展示 Proposal；用户逐项接受或拒绝。

完成条件：AI 关闭、超时或输出非法都不会改变 Inventory/Catalog。

## 8. Local HTTP API 边界

推荐使用版本前缀 `/api/v1`。最小资源：

- `GET /health`：服务、仓库、schema 和 adapter 状态；
- `POST /scans`、`GET /scans/:id`、`GET /scans/:id/events`；
- `GET /inventory`、`GET /artifacts/:id`；
- `GET /catalog`、`POST /catalog/drafts`；
- `POST /changesets`、`GET /changesets/:id`、`POST /changesets/:id/apply`；
- `GET /rules`；
- `POST /enrichment-jobs`、`GET /enrichment-jobs/:id`；
- `GET /diagnostics`、`GET /git/summary`。

写操作使用 request ID；重复请求必须幂等。apply 使用短期一次性确认 token 和 expected hashes。API 返回统一 error envelope：`code`、`message`、`details`、`recovery`、`requestId`。

## 9. 并发与一致性

- 同一仓库同时只允许一个 ScanRun 进入 persistence 阶段；
- 扫描可与只读 UI 并发；
- active ChangeSet apply 时对 Catalog 写入加仓库级互斥；
- 外部编辑导致 expected hash 不一致时返回 conflict，并重新生成 diff；
- watcher 事件做 debounce，只触发增量失效，不直接写 Catalog；
- ScanRun、ChangeSet 和 EnrichmentJob 都有明确状态机与终态。

## 10. 扩展 Provider

新 adapter 必须实现：

```ts
interface ProviderAdapter {
  id: string;
  version: string;
  detect(context: ScanContext): Promise<DetectionResult>;
  discover(context: ScanContext): AsyncIterable<Candidate>;
  parse(candidate: Candidate, context: ScanContext): Promise<ParseResult>;
}
```

并提供：路径/CLI 证据来源、fixture、scope 映射、脱敏策略、错误码、空环境行为和版本兼容说明。adapter 不得提供任意 shell 字符串给核心执行。
