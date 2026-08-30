# AI Tools Panel 仓库审查与下一步开发计划

> 仓库：`Super-YYQ/AI-Tools-Panel`  
> 审查基线：`main` / `9c2f26a07793fc0e8c9819eeedda446a8aa94c6f`  
> 审查日期：2026-08-30  
> 审查范围：安全、隐私、功能正确性、架构、测试/CI、依赖与供应链、发布准备度、后续开发优先级  
> 本文仅提出审查结论与开发计划，不授权自动 commit、push、merge 或发布。

---

## 1. 执行摘要

AI Tools Panel 的产品方向是成立的：**Windows 优先、本机优先、Git 优先、确定性扫描优先、AI 可选且默认关闭**，并且明确不执行扫描到的 Hook/脚本、不自动安装/卸载、不自动 commit/push。这些边界设计非常适合“AI 编码工具配置资产盘点”这一场景。

仓库也已经具备较完整的工程骨架：

- `apps/local-agent`：本机 Fastify Agent；
- `apps/panel`：React Web 控制台；
- `packages/adapter-claude` / `adapter-codex`：Provider 扫描适配；
- `inventory-core`：扫描、ID、hash、delta；
- `catalog`：Catalog、ChangeSet、diff、原子写入；
- `reconcile`：Inventory 与 Catalog 对账；
- `security`：路径检查、敏感数据脱敏、vendoring gate；
- `enrichment`：可选 AI 信息校准；
- SQLite 本机存储；
- Vitest / Playwright / Windows CI / secret scan / license report / SBOM / artifact audit。

但是，当前代码还不应按“v0.1 Hardening 已完成、可发布”来判断。

本次审查发现三个必须先处理的 Release Blocker：

1. **存在 P0 级目录穿越读取链路**：`GET /api/v1/catalog/entry?path=...` 接收客户端路径后进入 `FileSystemCatalogStore.readEntry()` / `loadRaw()`，读取路径没有 repo-relative / catalog allowlist 校验，可通过 `../` 逃逸仓库根目录。该 GET 当前又不要求 session，风险叠加。
2. **最新 GitHub Actions 失败**：当前 `main` 的 CI 在 `npm run verify` 的 build 阶段失败，说明 fresh clone 的可构建性与 `PROGRESS.md` 中“全绿”描述不一致。
3. **依赖安全门没有真正生效**：本次 GitHub Actions 安装日志已经报告 high / critical 等级依赖漏洞，而 workflow 中 `npm audit --audit-level=high || true` 即使执行也不会阻断；本次又因为前面的 build 失败导致 audit 等后续门禁整体 skipped。

因此建议下一版本目标不要叫“继续扩展 v1 功能”，而应定义成：

> **v0.1.1 — Security & Build Stabilization**

在 v0.1.1 关闭所有 P0/P1 安全问题、让 clean Windows CI 全绿，并修复核心正确性问题后，再进入 v0.2 的 UX / Remote Resolver / AI UI 扩展。

---

## 2. 总体评价

| 维度 | 当前评价 | 说明 |
|---|---|---|
| 产品方向 | 良好 | local-first / Git-first / AI optional 的定位清晰 |
| 安全设计 | 良好 | 威胁模型与安全文档覆盖面较完整 |
| 安全实现 | 需立即加固 | 文档与实现存在明显漂移，并存在实际目录穿越链路 |
| 隐私设计 | 良好 | 默认离线、AI 默认关闭、path token / redaction 思路正确 |
| 隐私实现 | 中等 | raw frontmatter / manifest 可进入 SQLite/API，历史扫描无清理策略 |
| 核心功能 | 中等偏好 | 扫描、Catalog、ChangeSet、规则片段、SQLite 等主链路已成型 |
| 功能正确性 | 需修复 | Codex 规则链、reconcile、重启恢复、session 路由等存在问题 |
| 前端体验 | MVP | 能完成流程，但存在轮询、无完整 diff、无虚拟化、单文件过大等问题 |
| 测试基础 | 较好 | 单测/集成/E2E 覆盖意识较强 |
| CI / Release | 不合格 | 最新 `main` CI 为 failure，后续安全门未运行 |
| 可维护性 | 中等 | monorepo 分层合理，但 route/runtime schema 和 UI 模块化不足 |

---

## 3. 值得保留的设计

### 3.1 不执行不可信资产

扫描到的：

- Hook command；
- Skill script；
- Plugin binary；
- 安装命令；

当前设计为“只解析、只展示、不执行”。

这是本项目最重要的安全原则，应继续作为不可突破的架构边界。

### 3.2 ChangeSet 写入模型正确

Catalog 写入不是直接修改文件，而是经过：

1. draft；
2. unified diff；
3. expected old hash；
4. apply token；
5. 临时文件；
6. rename；
7. journal / rollback。

这个方向明显优于“前端直接保存文件”，应该保留并继续强化真实路径检查与 schema 校验。

### 3.3 AI 不作为扫描器

AI enrichment：

- 默认关闭；
- 核心扫描不依赖 AI；
- AI 结果是 Proposal；
- AI 不能直接确认 license/source/fact；
- 接受 AI 结果仍需走 ChangeSet。

这是非常正确的信任边界。

### 3.4 已有较好的安全测试意识

仓库已经考虑：

- path traversal；
- malformed parser input；
- Hook 不执行；
- secret redaction；
- expected hash race；
- vendoring；
- prompt injection；
- recovery；
- Windows Unicode / long path / ACL。

问题不在于“没有安全意识”，而在于**测试覆盖和真正代码路径之间仍有断层**。

---

# 4. 安全审查

## SEC-001 — P0：Catalog Entry 任意相对路径读取

### 现状

API：

```text
GET /api/v1/catalog/entry?path=<user input>
```

直接调用：

```text
catalogStore.readEntry(path)
```

随后：

```text
loadRaw(repoRelativePath)
fs.readFile(join(repoRoot, repoRelativePath))
```

`readEntry()` / `loadRaw()` 没有调用：

- `checkRepoRelativePath()`；
- `isAllowedWritePath()` 的 read 等价策略；
- realpath containment；
- catalog root allowlist。

因此：

```text
../../other-file.yaml
../some-directory/private.json
```

可能逃逸 `repoRoot`。

如果目标文件能够被 YAML parser 解析，API 可能将解析后的结构返回给浏览器。

### 风险叠加

当前普通 GET API 又没有 session 强制鉴权。

因此 SEC-001 与 SEC-003 组合后，应按 **P0** 处理。

### 修复要求

建立统一的只读路径入口，例如：

```ts
resolveCatalogReadPath(repoRoot, input)
```

必须：

1. input 必须是 repo-relative；
2. 只允许 `catalog/`；
3. 只允许规定扩展名；
4. lexical containment；
5. `realpath` containment；
6. 拒绝 symlink / junction 逃逸；
7. 最终文件必须为 regular file；
8. route schema 限制长度；
9. 异常统一返回稳定 error code。

同时加入 API 集成测试：

```text
../
../../
%2e%2e/
mixed slash
UNC
drive path
ADS
junction
symlink
```

### 验收

所有 catalog read API 都不能读取 `catalog/` 之外的任何文件。

---

## SEC-002 — P0/P1：真实文件系统边界未落实，symlink / junction 仍可绕过

### 现状

`checkRepoRelativePath()` 主要是字符串/路径解析级检查。

它能够拒绝：

- `..`；
- drive absolute path；
- UNC；
- ADS；
- lexical outside root。

但没有验证**真实文件系统最终指向位置**。

这与安全规范中要求的：

> symlink / junction 越界防护

还不一致。

### 受影响链路

重点检查：

- `applyChangeSet()`；
- `FileSystemCatalogStore.loadRaw()`；
- `/rules/:observationId/content`；
- `/vendoring/preview`；
- adapter 的 repo 文件扫描；
- 未来 Remote Resolver 解包/导入。

例如：

```text
repo/catalog/link -> C:\outside
```

如果写入目标位于该 junction 下面，仅检查字符串：

```text
catalog/link/file.yaml
```

看起来仍然属于 repo。

### 设计建议

新增：

```text
packages/security/src/safe-path.ts
```

提供两个明确能力：

```ts
resolveSafeReadPath()
resolveSafeWritePath()
```

不要让业务代码自行 `join(repoRoot, input)`。

写操作要采用：

```text
lexical check
→ 找到 nearest existing ancestor
→ realpath ancestor
→ 验证 realpath 仍在 repo root
→ 创建临时文件
→ apply 前再次检查 parent realpath
→ rename
→ 写后重新 realpath + hash/schema 校验
```

### 验收

建立真实 Windows junction fixture，至少验证：

- catalog junction 外写失败；
- rule symlink 外读失败；
- vendoring junction 外读失败；
- 普通目录正常工作。

---

## SEC-003 — P1：普通 GET API 不鉴权 + 缺少强 Host 防护

### 现状

当前 session hook：

- 写请求：校验 Origin + session；
- SSE：校验 session；
- 普通 GET：默认允许；
- `/health`：允许匿名。

因此以下 API 可匿名读取：

```text
/api/v1/inventory
/api/v1/artifacts/:id
/api/v1/catalog
/api/v1/catalog/entry
/api/v1/rules
/api/v1/rules/:id/content
/api/v1/sources.lock
/api/v1/git/summary
```

本机 loopback 并不等于浏览器安全边界。

仍需要考虑：

- DNS rebinding；
- 恶意网页访问 localhost；
- 本机其他非可信进程；
- Host header 异常；
- 与 SEC-001 组合。

### 建议

仅保留：

```text
GET /health
```

匿名。

所有：

```text
/api/v1/**
```

都要求有效 session。

同时服务端强制：

```text
host ∈ {127.0.0.1, ::1}
```

不要只依赖正常启动器“不传 host”。

建议最终改为：

```text
启动 URL fragment 一次性 bootstrap token
→ POST /session/bootstrap
→ 服务端换发 HttpOnly + SameSite=Strict cookie
→ 返回独立 CSRF token
→ 清除 fragment
```

也可以暂时继续 header token，但必须：

- GET 同样鉴权；
- 严格 Host；
- 严格 Origin；
- session TTL；
- token 不进入 query。

### SSE

当前 SSE 为兼容 EventSource，允许：

```text
?session=<token>
```

建议 bootstrap cookie 后直接使用 cookie，或前端改为 `fetch()` streaming。

不要把长期 session 放 URL query。

---

## SEC-004 — P1：安全文档声明的 CSP / rate limit / session idle 等尚未形成硬门禁

安全规范明确提出：

- CSP；
- CORS off；
- rate limit；
- concurrency limit；
- session idle；
- anti-CSRF；
- secure cookie。

当前代码真正能确认的主要是：

- loopback 默认值；
- body limit；
- session token；
- write Origin check。

建议不要把 M3-02 标记为完全完成，直到这些要求都有：

1. 实现；
2. 自动化测试；
3. CI gate。

---

## SEC-005 — P1：`readTextCapped()` 是“读完后再限大小”

当前逻辑等价于：

```ts
const buf = await fs.readFile(path);
if (buf.byteLength > maxBytes) return undefined;
```

因此 512 KB 并不是实际读取上限。

攻击者放置超大文件时，进程仍可能先：

- 分配大 Buffer；
- 读取整个文件；
- 产生内存/IO 压力。

### 修复

优先：

```text
lstat/stat
→ size > limit 直接拒绝
→ 再读取
```

对未来远程/压缩内容使用真正 bounded stream。

---

## SEC-006 — P1：Route 输入主要依赖 TypeScript cast，不是运行时校验

例如：

```ts
const body = request.body as {...}
```

TypeScript cast 无法阻止恶意 HTTP 输入。

建议所有 API 请求都由 Zod / Fastify JSON Schema 验证：

- path；
- string length；
- array count；
- enum；
- body nesting；
- runId / changeSetId format；
- vendoring pathToken；
- catalog changes count；
- content bytes。

并由 schema 生成 OpenAPI。

这样可以同时补上原计划 M3-07。

---

# 5. 隐私审查

## PRI-001 — P1：Skill frontmatter / Plugin manifest 可原样进入 SQLite

`buildObservation()` 明确依赖 adapter 上游完成 redaction。

Claude / Codex adapter 中：

- Hook 配置调用了 `redactObject()`；
- Skill 的完整 `frontmatter` 会进入 `summary`；
- Plugin / Marketplace 的完整 `manifest` 会进入 `summary`。

因此如果第三方配置中包含：

```text
token
private URL
email
username
authorization metadata
内部仓库地址
其他自定义私密字段
```

可能被持久化到：

```text
.aitp/inventory.db
```

并通过 Inventory API 返回。

### 建议

不要继续采用：

> 每个 adapter 自己记得脱敏

改成双层防御。

第一层，adapter 只构造**白名单 Summary DTO**：

```text
name
description
version
enabledEvidence
script filenames
resource filenames
known source metadata
```

默认不保存完整 manifest。

第二层，Persistence boundary 再执行：

```ts
sanitizeObservation()
```

保证任何 Observation 入库前统一清洗。

### 原始 manifest 的策略

如果以后 UI 确实要看完整文件：

- 不长期持久化；
- 用户显式点击时重新读取；
- 服务端实时脱敏；
- 明确标注“本机原始配置”；
- 不发送 AI；
- 不写 Git。

---

## PRI-002 — P1：SQLite 没有历史保留/清理策略

当前每次扫描都保存：

- scan run；
- observation；
- diagnostics；
- proposal。

没有看到：

- max runs；
- max age；
- clear history；
- DB vacuum；
- privacy cleanup。

对于本机配置资产，这会导致历史配置变化长期残留。

### 建议

默认策略：

```text
保留最近 10 次成功/partial scan
或
30 天
```

二者取先达到者。

设置页提供：

```text
清除扫描历史
清除 AI Proposal
清除全部 .aitp 本机状态
```

默认不影响 Catalog/Git 文件。

---

## PRI-003 — P1：进程重启后没有恢复最后一次成功扫描

SQLite 已提供：

```ts
getLastSuccessfulRun()
```

但 `startServer()` 中 `lastRunId` 初始仍为空。

因此：

```text
上次已扫描
→ 关闭 Panel
→ 再启动
```

在重新扫描前，持久化 Inventory 没有被自动恢复到 UI。

这既是功能问题，也会造成“有数据库但看起来没数据”的认知问题。

### 修复

启动时：

```text
load last successful/partial run
→ lastRunId
→ UI 立即显示
```

新 scan 的 delta 也应基于该 baseline。

---

## PRI-004 — P2：AI payload 仍可以进一步最小化

`buildPayload()` 当前把：

```text
kind
canonicalName
summary
scope
```

统一发给不同 AI Task，然后再做 redaction。

建议每种任务采用不同 allowlist。

例如 summary：

```text
name
description
kind
```

tags：

```text
name
description
known categories
```

source-candidates：

```text
name
non-sensitive source evidence
```

不要把完整 `summary` 当所有任务的通用输入。

同时：

- UI 展示精确 payload preview；
- 明确字节数；
- 明确 Provider；
- Provider 调用支持 AbortController；
- timeout 后真正停止网络请求，而不仅 `Promise.race()` 忽略结果。

---

# 6. CI、依赖与供应链审查

## REL-001 — Release Blocker：当前 `main` GitHub Actions 为 failure

最新提交：

```text
9c2f26a07793fc0e8c9819eeedda446a8aa94c6f
```

对应 CI run：

```text
33293293546
```

实际结果：

```text
completed / failure
```

失败发生在：

```text
npm run verify
  → build
  → tsc -b .
```

测试阶段本身通过了：

```text
105 passed
1 skipped
```

但 clean build 出现大量：

```text
TS7016
Could not find a declaration file for module '@aitp/...'
```

以及若干 implicit any。

### 重要的另一个问题

根脚本：

```json
"typecheck": "tsc -b . --dry || tsc -b ."
```

`--dry` 的含义是“显示会构建什么”，不是执行真实 typecheck。

正常情况下 `--dry` 成功，所以后面的：

```text
|| tsc -b .
```

不会运行。

也就是说当前：

```text
npm run typecheck
```

并不等价于真正类型检查。

### Workspace 配置需要一起处理

仓库：

- 使用 project references；
- package `main/types` 指向 `dist`；
- `exports` 只有 JS 路径；
- `dist/` 被 gitignore；
- 但各 workspace 的 `tsconfig.tsbuildinfo` 被提交。

建议统一重做 clean build contract：

1. `*.tsbuildinfo` 加入 `.gitignore`；
2. 从 Git 删除现有 tracked `tsconfig.tsbuildinfo`；
3. package exports 增加 `types` condition；
4. 核实 project references / workspace package resolution；
5. 必要时加入明确的 TS `paths` 或严格的 topological package build；
6. `npm run clean` 后必须 fresh build 成功；
7. `typecheck` 改成真实编译检查，而不是 `--dry`；
8. CI 开头增加一次 clean build 验证。

### 验收

在 GitHub Windows runner：

```powershell
git clean -xfd
npm ci
npm run verify
npm run test:integration
npm run test:security
npm run docs:check
npm run secret:scan
npm run license:report
npm run sbom:generate
npm run artifact:audit
```

全部成功。

---

## REL-002 — Release Blocker：依赖漏洞 gate 当前不能作为发布依据

最新 CI 的 `npm install` 日志已经报告 high / critical 等级漏洞。

但 workflow 使用：

```powershell
npm audit --audit-level=high || true
```

即使执行，也不会让 workflow 失败。

更严重的是，本次 build 提前失败后：

```text
test:integration
test:security
secret:scan
license:report
sbom:generate
artifact:audit
npm audit
```

全部没有执行。

因此目前不能写：

> 完整 security gate 全绿

### 修复

CI 必须：

```powershell
npm audit --audit-level=high
```

不允许 `|| true`。

如果确有无法立即修复的 advisory：

- 明确 advisory ID；
- 影响 package；
- reachable / unreachable 分析；
- temporary exception；
- owner；
- expire date。

不能使用全局忽略。

---

## REL-003 — P1：CI / 首次启动使用 `npm install`

建议改成：

```text
npm ci
```

保证与 lockfile 一致。

同时安全文档已经提出 lifecycle script 管理，但用户首次运行 `scripts/panel.ps1` 会直接：

```powershell
npm install
```

发布版本不应要求终端用户在运行安全工具之前临时执行整套 npm 安装生命周期。

### 最终方向

开发模式：

```text
npm ci
```

Release 用户：

```text
预构建 ZIP / installer
```

不再执行 npm install。

对确实需要 lifecycle script 的依赖：

- `better-sqlite3`；
- `esbuild`；

显式维护 allowlist，并在依赖升级时重新审计。

---

# 7. 功能正确性审查

## FUN-001 — P1：首次打开的 session hash 与页面 hash 共用

启动 URL：

```text
/#session=<token>
```

但 `App` 初始化时直接：

```ts
window.location.hash.replace('#', '')
```

作为 Page。

因此首屏 Page 可能变成：

```text
session=<token>
```

而不是：

```text
overview
```

API client 又会随后清除 hash。

这是 session bootstrap 与前端路由共用同一 hash namespace 造成的竞态/状态污染。

当前 E2E 首开只验证：

```text
AI Tools Panel 标题可见
```

没有验证“总览页面可见”，所以没有抓到该问题。

### 修复

推荐：

```text
bootstrap session
→ remove session fragment
→ initialize router
```

或者直接采用 cookie bootstrap，不再让 token 与页面路由共享 hash。

新增 E2E：

```text
fresh open
→ overview heading visible
→ URL 不含 session token
→ refresh 仍正常
```

---

## FUN-002 — P1：后端有 SSE，前端仍 300ms 轮询

后端已经实现：

```text
/scans/:id/events
```

但前端：

```text
每 300ms scanStatus()
最多 300 次
```

造成：

- 无意义 HTTP 请求；
- 状态逻辑重复；
- SSE 代码价值未发挥。

建议切换为 SSE / fetch-stream。

---

## FUN-003 — P1：ScanOrchestrator 有 cancel，但没有取消 API / UI

后端 class 已有：

```ts
cancel()
```

计划也写了 scan cancel endpoint。

但当前用户无法取消扫描。

建议增加：

```text
POST /api/v1/scans/:id/cancel
```

并在 UI 扫描期间展示：

```text
取消扫描
```

同时 background scan 捕获异常时必须发布 terminal event，避免 scan 状态永远停留在 running。

---

## FUN-004 — P1：Codex AGENTS 规则加载链实现不完整

`buildAgentsChain()` 当前对于每个目录固定生成：

```text
AGENTS.override.md
excluded: AGENTS.md
```

并没有真正检查：

- override 是否存在；
- fallback 是否存在；
- 哪一个实际生效；
- root → cwd 的加载顺序；
- user-level Codex rules；
- override/fallback 的真实覆盖关系。

因此 UI 中：

```text
loadedInContext
chain
```

可能给出错误结论。

### 修复

建立独立：

```text
packages/adapter-codex/src/agents-chain.ts
```

输入实际 filesystem snapshot，输出：

```ts
{
  directory,
  candidates,
  selected,
  excluded,
  reason,
  loadOrder
}
```

使用 fixture 完整覆盖：

```text
仅 fallback
仅 override
两者都有
root + child
user + repo
missing
case-sensitive/case-insensitive Windows path
```

---

## FUN-005 — P1：Reconcile 的实际匹配逻辑与文档不一致

代码注释描述：

```text
confirmed source
→ alias
→ vendored origin
→ content relation
→ manual link
```

且：

> same name alone is only an ambiguous candidate

但当前实际 fallback：

```text
canonicalName slug === catalog metadata.id
```

就可能直接匹配。

与此同时 Git source matching 依赖 Observation evidence origin 包含 Git URL，而 adapter 大多数 evidence origin 是本地 path token。

因此可能出现：

- 真正同 source 识别不到；
- 同名资产被过强匹配；
- drift 判断失真。

### 另一个直接问题

UI 收藏未安装条目写入：

```yaml
source:
  type: url
```

而 reconcile 只有：

```text
source.type === unknown
```

才判定：

```text
catalog-only
```

否则无本地匹配会走：

```text
missing-source
```

这与 E2E/产品语义“未安装收藏 = catalog-only”不一致。

### 建议

在 Observation contract 中新增结构化：

```ts
sourceIdentity?: {
  type: 'git' | 'marketplace' | 'local-authored' | 'unknown';
  canonicalUrl?: string;
  marketplaceId?: string;
  packageId?: string;
  revision?: string;
}
```

Reconcile 不要从人类可读 evidence string 中反推 source。

匹配优先级：

```text
1 confirmed structured source identity
2 explicit manual link
3 vendored origin digest
4 exact content digest relationship
5 alias
6 name heuristic => ambiguous candidate only
```

---

## FUN-006 — P1：Changes 页面没有真正展示 Git diff

当前 Changes 只显示：

```text
branch
changedFiles
```

没有展示：

```text
git diff
```

与 M4-06 “变更页、diff、检查”目标不一致。

建议后端新增只读：

```text
GET /api/v1/git/diff
```

仅允许：

- Catalog；
- sources.lock；
- 本应用目标文件；

并限制 diff 最大字节数。

UI 使用真正 diff viewer。

---

## FUN-007 — P1：保存确认只展示截断 600 字符 diff

Observation save / Rule Fragment save 中：

```text
unifiedDiff.slice(0, 600)
```

随后直接让用户：

```text
确认写入？
```

安全产品不应让用户基于不完整 diff 批准写入。

应改成专门 Change Review 页面：

```text
完整 diff
文件列表
敏感字段提示
schema check
expected hash
最终 Apply
```

过大 diff 可以分页/折叠，但不能悄悄截断后直接批准。

---

## FUN-008 — P1：前端手工拼 YAML

当前 UI 多处通过 string array 拼 YAML：

```text
displayName: ${name}
url: ${url}
tags: [...]
```

用户输入中出现：

```text
:
#
'
"
换行
[]
{}
```

容易形成：

- YAML 格式问题；
- 字段结构被意外改变；
- 数据质量错误。

前端不应该拥有第二套 Catalog serializer。

### 修复

前端提交 typed draft DTO：

```json
{
  "kind": "Skill",
  "metadata": {...},
  "spec": {...}
}
```

服务端：

```text
Zod validate
→ normalize
→ serializeCatalogEntry()
→ ChangeSet
```

所有 YAML 序列化只有一个实现。

---

## FUN-009 — P2：Vendoring UI 目前本质上仍是 metadata-only

代码存在：

```text
policy: vendored
```

但当前 UI 实际只提供：

```text
仅保存元数据（默认）
```

因此不要在产品文档中暗示“vendoring 已完成”。

建议：

- v0.1.1 继续保持 metadata-only；
- 真正 vendoring 延后；
- 等 SEC-002 路径边界与 license gate 完整后再开放文件复制。

---

## FUN-010 — P2：Remote Resolver 在线实现尚未启用

这个限制仓库已经在 `PROGRESS.md` 中承认。

当前阶段不建议立即实现。

原因：

Remote Resolver 会新增：

- 网络边界；
- redirect；
- SSRF；
- archive traversal；
- decompression bomb；
- license；
- digest；
- cache；
- remote content prompt injection。

应该等 v0.1.1 security baseline 完成后再做。

---

# 8. 架构与可维护性

## ARCH-001：`App.tsx` 职责过重

当前单文件同时承担：

- Router；
- Overview；
- Installed；
- Observation Card；
- Catalog；
- Rules；
- Rule Fragment；
- Changes；
- Settings；
- mutation workflow。

建议拆为：

```text
apps/panel/src/
  app/
    AppShell.tsx
    router.ts
  pages/
    OverviewPage.tsx
    InstalledPage.tsx
    CatalogPage.tsx
    RulesPage.tsx
    ChangesPage.tsx
    SettingsPage.tsx
  features/
    scan/
    inventory/
    catalog/
    changeset/
    rules/
  api/
    client.ts
    schemas.ts
  components/
```

---

## ARCH-002：Contracts 已存在，但 HTTP route 没有充分复用

这是当前非常可惜的一点：

仓库已经有 Zod contract package，但 API 仍大量：

```ts
request.body as ...
request.query as ...
```

下一阶段应让：

```text
Contract
→ runtime validation
→ OpenAPI
→ TS client type
```

成为同一来源。

---

## ARCH-003：扫描历史、扫描事件、Draft Map 缺少生命周期管理

内存结构：

```text
scanEvents
scanIdToRunId
draftChangeSets
```

没有 TTL / pruning。

每次扫描的 SSE lines 也持续保留到进程退出。

建议：

```text
terminal scan event TTL: 10 min
draft TTL: 30 min
max cached scans: configurable small number
```

超过后主动清理。

---

## ARCH-004：错误日志隐私与可观察性需要折中

Fastify 当前 logger 关闭，隐私上比较保守，但生产诊断能力不足。

建议增加：

```text
本机 structured log
```

只记录：

```text
timestamp
event
requestId/runId
route ID
duration
result code
provider
```

禁止：

```text
body
headers
token
absolute path
command
raw config
AI payload
```

默认轮转、限制总大小，并可由用户清空。

---

# 9. 下一步开发计划

## Phase 0 — Release Blocker Stabilization

**目标：先恢复“这个仓库可以被信任地构建和验证”。**

建议工期：1–2 个开发日。

### P0-REL-01 修复 clean workspace build

涉及：

```text
tsconfig*
packages/*/package.json
.gitignore
npm scripts
```

任务：

- 修复 workspace declaration resolution；
- package `exports` 增加 types condition；
- 检查 project references；
- 删除 tracked `*.tsbuildinfo`；
- `.gitignore` 增加 `*.tsbuildinfo`；
- 修复 implicit any；
- `typecheck` 不再使用 `--dry`；
- clean clone 构建。

### P0-REL-02 CI 改为确定性安装

```text
npm install
→ npm ci
```

### P0-REL-03 让 security gates 真正全部执行

CI 必须先后运行：

```text
verify
integration
security
e2e（可独立 job）
docs
secret scan
license
SBOM
artifact audit
npm audit
```

### P0-REL-04 修复/处置 high + critical dependency advisory

不允许：

```text
|| true
```

### Phase 0 验收

- fresh Windows runner 全绿；
- clean build 成功；
- 真实 typecheck 成功；
- 所有 security job 实际执行，而不是 skipped；
- 无未处置 high / critical；
- `PROGRESS.md` 与 CI 事实同步。

---

## Phase 1 — Security Boundary Hardening

**目标：修完所有可读取/写入本机文件的边界。**

建议工期：2–4 个开发日。

### P0-SEC-01 修复 Catalog Entry traversal

立即处理：

```text
GET /api/v1/catalog/entry
```

并审计所有类似 path query/body。

### P0-SEC-02 引入统一 SafePath API

建立：

```text
resolveSafeReadPath
resolveSafeWritePath
```

完成：

- lexical；
- realpath；
- symlink/junction；
- nearest ancestor；
- before apply recheck；
- write-after-check；
- regular file validation。

### P1-SEC-03 全 API session

除 `/health` 外：

```text
/api/v1/**
```

全部鉴权。

### P1-SEC-04 强制 loopback / Host / Origin

服务端拒绝：

```text
0.0.0.0
LAN IP
unexpected Host
unexpected Origin
```

不要依赖调用者传参约定。

### P1-SEC-05 Session bootstrap

推荐：

```text
fragment token
→ one-time bootstrap
→ HttpOnly cookie
→ CSRF token
```

### P1-SEC-06 CSP / security headers / rate limit / session TTL

落实安全文档 M3-02。

### P1-SEC-07 Runtime API validation

为所有 route 引入 Zod/Fastify schema。

### P1-SEC-08 真正 bounded read

修复：

```text
readTextCapped
vendoring reader
remote future reader
```

### Phase 1 必须新增的测试

```text
catalog traversal
encoded traversal
catalog junction
rule symlink
vendoring junction
unauth GET
DNS rebinding Host
cross Origin
expired session
oversized body
oversized changes array
malformed route body
```

### Phase 1 验收

安全测试能够证明：

> 任意 HTTP 输入、repo 内 symlink/junction、第三方扫描内容都不能让 Agent 读写预期边界之外的文件。

---

## Phase 2 — Privacy & Persistence Hardening

**目标：即使 adapter 出错，也不能把私密配置原样存入 DB/API/AI。**

建议工期：2–3 个开发日。

### P1-PRI-01 Observation Sanitization Boundary

新增：

```text
sanitizeObservation()
```

位置应在 persistence 前统一执行。

### P1-PRI-02 Summary 白名单化

不保存 raw：

```text
frontmatter
manifest
settings
```

只保存产品需要的字段。

### P1-PRI-03 SQLite retention

默认：

```text
10 runs / 30 days
```

并提供清理 API/UI。

### P1-PRI-04 重启恢复 Last Successful Run

启动后立即显示上次 inventory。

### P1-PRI-05 AI task-specific payload

不同 Task 使用不同字段 allowlist。

### P1-PRI-06 数据隐私页面

Settings 展示：

```text
SQLite 路径 token
保留 run 数
最近清理
AI 是否开启
将发送哪些字段
一键清理本机状态
```

### Phase 2 验收

Fixture 在以下位置放入 secret：

```text
Skill frontmatter
Plugin manifest
Marketplace manifest
Hook
Rule
diagnostic error
AI input
```

断言 secret 原文不存在于：

```text
SQLite
HTTP response
log
Catalog
AI payload
```

---

## Phase 3 — Core Correctness

**目标：让扫描结果“可信”，而不是只做到“能扫描”。**

建议工期：3–5 个开发日。

### P1-FUN-01 修复 Codex AGENTS Chain

使用真实文件存在情况生成 chain。

### P1-FUN-02 SourceIdentity Contract

Observation 增加结构化 source identity。

### P1-FUN-03 重写 Reconcile Match Pipeline

实现：

```text
confirmed source
manual link
vendored digest
content digest
alias
name candidate
```

### P1-FUN-04 修复 Favorite catalog-only 语义

未安装远程收藏：

```text
catalog-only
unverified source
```

而不是 missing-source。

### P1-FUN-05 Scan cancel + terminal handling

提供 cancel API/UI。

### P1-FUN-06 前端改用 SSE

删除 300ms polling。

### P1-FUN-07 Git full diff

Changes 页展示完整可审阅 diff。

### Phase 3 验收

补齐：

```text
favorite -> catalog-only
same-name different-source -> ambiguous
confirmed source exact match
restart -> previous inventory visible
cancel scan -> cancelled
provider exception -> terminal partial/failed event
```

---

## Phase 4 — Web Console UX & Performance

**目标：从工程 Demo 变成长期日常使用的配置资产面板。**

建议工期：3–5 个开发日。

### P1-UI-01 修复 session/router

首开稳定进入 Overview。

### P1-UI-02 拆分 App.tsx

按 page/feature 模块化。

### P1-UI-03 完整 Change Review

不要：

```text
window.confirm + 600 chars
```

改为专用 Review UI。

### P1-UI-04 Typed Draft

前端提交结构化对象，服务端统一 YAML serializer。

### P2-UI-05 5k 条目虚拟化/分页

Installed：

- debounce search；
- 预计算 searchableText；
- virtual list / pagination；
- 不在每次输入时 JSON.stringify 全对象。

### P2-UI-06 状态体验

明确：

```text
never scanned
loading
running
partial
cancelled
stale
offline
error
empty
```

### P2-UI-07 Accessibility / i18n foundation

继续完成原计划：

- keyboard；
- focus；
- screen reader；
- 200% zoom；
- 中英文本 key 分离。

---

## Phase 5 — Packaging & Release

**目标：用户运行 Panel 时不需要现场 npm install。**

建议工期：3–5 个开发日。

### REL-01 发布包

优先提供：

```text
Windows ZIP portable
```

随后再评估：

```text
MSI / installer
```

### REL-02 预构建 native dependency

处理：

```text
better-sqlite3
```

确保目标 Windows / Node ABI 可用。

### REL-03 发布安全

生成：

```text
SHA-256
CycloneDX SBOM
license report
artifact audit
release notes
```

正式公开分发时增加代码签名。

### REL-04 Fresh Machine Matrix

至少：

```text
Windows 11
普通用户权限
中文路径
长路径
Defender 开启
无 Node 环境（release 包）
无 Claude
无 Codex
仅 Claude
仅 Codex
两者都有
```

---

# 10. 建议暂缓的功能

在 Phase 0–3 完成前，不建议优先投入：

```text
新的 AI Provider
AI UI
自动远程 Marketplace 抓取
Remote Resolver
真正 vendoring 文件复制
安装/卸载 Skill
LAN / Remote 控制
会话管理
自动 Git commit/push
```

这些功能都会扩大信任边界。

当前更重要的是把：

```text
扫描准确
数据不泄漏
文件不越界
变更可审阅
CI 可复现
```

做到稳定。

---

# 11. 推荐 PR / 提交拆分

建议不要再像当前 v0.1 一样一次性提交整个 M0–M7。

推荐按以下垂直 PR 推进：

```text
PR-01 build: restore clean workspace build and real typecheck
PR-02 ci: enforce npm ci and blocking security gates
PR-03 security: close catalog read traversal
PR-04 security: enforce realpath/junction containment
PR-05 security: authenticate all local APIs and harden host/session
PR-06 privacy: sanitize observations before persistence
PR-07 persistence: restore last run and add retention
PR-08 codex: implement real AGENTS loading chain
PR-09 reconcile: introduce source identity and deterministic matching
PR-10 scan: SSE client + cancellation
PR-11 panel: typed drafts and full change review
PR-12 panel: modularize pages and virtualize large inventory
PR-13 release: portable Windows package and fresh-machine smoke test
```

每个 PR：

```text
需求/风险 ID
→ implementation
→ automated tests
→ docs update
→ CI evidence
```

必须在同一个 PR 内闭环。

---

# 12. Definition of Done

未来不要仅用“代码写完”标记 milestone 完成。

一个任务只有同时满足以下条件才算 Done：

```text
[ ] 行为实现
[ ] contract/schema 更新
[ ] unit test
[ ] integration/security test
[ ] 需要时 E2E
[ ] clean Windows CI 通过
[ ] 文档与代码一致
[ ] 无新的 high/critical dependency issue
[ ] 无 secret/path 泄漏
[ ] 变更不扩大未记录的信任边界
```

对于安全相关任务还必须：

```text
[ ] 有失败用例证明旧漏洞
[ ] 修复后测试转绿
[ ] regression test 永久保留
```

---

# 13. 版本路线建议

## v0.1.1 — Security & Build Stabilization

只做：

```text
Phase 0
Phase 1
Phase 2 中高优先级项
```

目标：

> 可构建、可验证、边界可信。

## v0.2 — Correct Inventory Control Plane

做：

```text
Phase 3
Phase 4
```

目标：

> 扫描/匹配正确，日常使用体验成熟。

## v0.3 — Remote & AI Expansion

再评估：

```text
Remote Resolver
Marketplace metadata sync
AI enrichment UI
真实 vendoring
```

目标：

> 在已有安全基线之上扩大能力，而不是先扩大攻击面。

---

# 14. 当前最推荐的实际执行顺序

如果现在马上继续开发，顺序应固定为：

```text
1. 修复 clean CI build
2. 修复 catalog entry traversal
3. realpath / junction 全链路加固
4. GET API 全鉴权 + Host/session hardening
5. dependency high/critical gate
6. Observation 全局隐私清洗
7. SQLite 重启恢复 + retention
8. Codex AGENTS chain
9. SourceIdentity + reconcile
10. SSE + scan cancel
11. typed draft + full diff review
12. UI 模块化/虚拟化
13. Windows portable release
14. 最后才做 Remote Resolver / AI UI
```

这条顺序的核心原则是：

> **先保证“不会泄漏/不会越界/能够 clean build”，再保证“扫描结果正确”，最后再扩展能力和美化 UI。**

---

## 15. 审查结论

AI Tools Panel 并不是需要推倒重来的项目。

现有：

- 产品边界；
- monorepo 分层；
- deterministic inventory 思路；
- Catalog / ChangeSet；
- optional AI；
- security package；
- fixture/test 体系；

都值得保留。

下一阶段最重要的不是“再加多少功能”，而是把当前代码从：

> **安全设计完整的 MVP**

提升为：

> **安全实现、功能语义、CI 证据都与设计一致的本机配置控制面板。**

完成 v0.1.1 后，再继续 Remote Resolver、AI enrichment UI、更多 Provider，整体风险会低很多。
