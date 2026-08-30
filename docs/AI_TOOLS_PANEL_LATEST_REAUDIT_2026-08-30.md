# AI Tools Panel 最新仓库增量复审与下一步计划

> 仓库：`Super-YYQ/AI-Tools-Panel`  
> 最新审查基线：`main` / `a418011b29e0bf80d45c6d89977a5532137003dd`  
> 对比基线：`9c2f26a07793fc0e8c9819eeedda446a8aa94c6f`  
> 日期：2026-08-30  
> 目的：验证上一轮审计项是否真正关闭，并发现 v0.1.1 新增实现中的回归与残余风险。

---

## 1. 结论

v0.1.1 相比上一版有明显进步，上一轮最严重的几个问题已经实质修复：

- Catalog 任意 `../` 读取链路已通过 SafePath 封住；
- `/api/v1/**` 普通 GET 已加入 session；
- clean build / 真正 typecheck 已修复；
- `npm ci`、secret/license/SBOM/artifact audit 与生产依赖 audit 已进入 CI；
- raw frontmatter / manifest 不再直接作为 summary 持久化；
- SQLite 启动恢复、隐私页、扫描取消、SSE、完整 Change Review、Typed Draft、Git diff、Codex AGENTS chain、SourceIdentity/Reconcile 都有实际代码落地。

但当前版本仍不应标记为“v0.1.1 release ready”。

最主要原因：

1. 最新 GitHub Actions **整体仍为 failure**：Windows 主 job 全绿，但独立 E2E job 失败；
2. 扫描器本身仍存在“repo 内文件 symlink 指向 repo 外后被读取”的 SafePath 覆盖缺口；
3. `applyChangeSet()` 正向写入已 SafePath，但 rollback 路径又回到了原始 `join + writeFile/rm`；
4. Observation 的统一隐私清洗只清理 `summary`，`sourceIdentity / canonicalName / sourceEvidence` 仍可能携带凭据或隐私信息；
5. 扫描 baseline、delta identity、Reconcile revision 等核心正确性仍有边界问题；
6. `PROGRESS.md` 当前写的“E2E-01..06 全过”“Retention 已完成”等部分结论与仓库/CI 实际状态不完全一致。

因此建议把当前状态定义为：

> **v0.1.1 RC 修复阶段，而不是 v0.1.1 已完成。**

---

# 2. 上一轮问题关闭情况

## 已确认关闭

### SEC-001 Catalog Entry traversal

`FileSystemCatalogStore.loadRaw()` 已经统一调用：

- repo-relative lexical check；
- `catalog/` prefix；
- `.yaml/.yml/.md` extension；
- realpath containment；
- regular file check。

上一轮的 `/api/v1/catalog/entry?path=../../...` P0 链路可以视为已关闭。

### Build / Typecheck

根脚本已经从假 typecheck：

```text
tsc -b . --dry || tsc -b .
```

改成真正：

```text
tsc -b .
```

tracked `*.tsbuildinfo` 已删除并加入 `.gitignore`。

最新 GitHub Actions Windows job：

```text
npm ci
verify
integration
security
docs
secret scan
license report
SBOM
artifact audit
npm audit
schema drift
```

全部成功。

因此上一轮 clean build Release Blocker 已解决。

### 全 API 鉴权

除 `/health` 外：

```text
/api/v1/**
```

已经统一要求 session，SSE 不再把 token 放 query 参数。

这是实质性的安全改进。

### Observation summary 隐私边界

新增：

```text
sanitizeObservation()
sanitizeDiagnostics()
```

两个 Store 都在持久化前调用。

Adapter 也不再保存完整：

```text
frontmatter
manifest
settings
```

而改为按 kind 白名单 Summary。

### UI / Core Workflow

已实际看到：

- session fragment bootstrap 在 router 前执行；
- SSE 替换 300ms polling；
- Scan cancel；
- Change Review 完整 diff；
- Typed Draft，YAML 只在 server 序列化；
- Changes 页面真实 Git diff；
- App 拆页；
- i18n 基础；
- SourceIdentity；
- Reconcile 名称不再直接自动匹配；
- URL/unknown Favorite → catalog-only。

---

# 3. 当前 Release Blocker

## REL-101 — P0 Release：最新 CI 仍为红色

最新 run：

```text
33300677627
```

状态：

```text
completed / failure
```

其中：

```text
windows = success
e2e = failure
```

E2E：

```text
E2E-01 pass
E2E-02 pass
E2E-03 pass
E2E-04 fail
E2E-05 did not run
E2E-06 did not run
```

失败点：

```text
期待 leaky Skill 的 vendoring preview 中出现 .env
但 clean CI 中不存在该元素
```

仓库实际：

```text
tests/fixtures/claude-repo/.claude/skills/leaky/
  SKILL.md
  run.sh
```

没有 `.env`。

同时根 `.gitignore`：

```text
.env
.env.*
```

因此这很可能不是 vendoring 实现本身坏了，而是：

> 本地开发环境曾存在一个未跟踪 `.env` fixture，测试依赖了它；clean GitHub runner 没有该文件。

### 修复建议

不要 force-track 真 `.env`。

E2E-04 setup 中动态创建：

```text
leaky/.env
```

内容使用明确的 fake marker。

然后再执行 Panel。

这样测试同时验证：

```text
真实 .env exclusion
clean clone reproducibility
fixture 不进入 Git
```

### 第二个 CI 问题

当前 E2E：

```text
describe.serial
```

导致 E2E-04 一失败，05/06 全部不运行。

建议每个 E2E 使用独立 repo/panel fixture，尽量取消 serial。

至少：

```text
E2E-01..06 均应独立运行
```

否则一个前置 UX 回归会遮蔽后续隐私/规则测试。

---

# 4. 新发现的安全问题

## SEC-101 — P1 High：SafePath 没覆盖 Provider Scanner 的实际文件读取

`SafePath` 已接入：

```text
catalog read
ChangeSet write
rules content API
vendoring preview
```

但是 Provider adapter 的扫描读取仍主要使用：

```text
exists()
readTextCapped()
```

`readTextCapped()` 只做：

```text
stat size
readFile
```

不做 realpath containment。

Claude 固定规则：

```text
CLAUDE.md
.claude/CLAUDE.md
CLAUDE.local.md
```

以及 Skill：

```text
<skill>/SKILL.md
```

均可能跟随文件 symlink。

Codex 的：

```text
AGENTS.md
AGENTS.override.md
SKILL.md
```

同理。

因此：

```text
repo/CLAUDE.md -> C:\outside\private.md
```

或：

```text
repo/.claude/skills/x/SKILL.md -> outside file
```

Scanner 仍可能读取 repo 外文件。

当前 boundary test 验证的是：

```text
扫描之后
rules 目录被换成 junction
再访问 /rules/:id/content
```

它证明 API read SafePath 有效，却没有证明：

```text
Scanner 自身不会跟随 symlink。
```

### 修复

不要让 adapter 直接调用裸：

```text
readTextCapped(path)
```

新增：

```text
readScopedTextCapped({
  root,
  path,
  allowLinks: false,
  maxBytes
})
```

Repo scope：

```text
root = repoRoot
```

User scope：

```text
Claude -> ~/.claude
Codex  -> ~/.codex / ~/.agents
```

必须验证：

```text
lstat
realpath
root containment
size
regular file
```

如果越界：

```text
SYMLINK_OUTSIDE_ROOT
```

并跳过该 Candidate。

新增测试：

```text
CLAUDE.md file symlink -> outside
AGENTS.md file symlink -> outside
SKILL.md file symlink -> outside
user config root symlink escape
```

---

## SEC-102 — P1：Rollback 没有继续使用 SafePath

`applyChangeSet()` 正向路径已经很好：

```text
resolveSafeWritePath
→ expected hash
→ temp
→ rename 前重新 SafePath
→ rename
→ post-write containment/hash
```

但失败 rollback：

```text
join(repoRoot, entry.path)
→ rm / writeFile
```

又绕开了 SafePath。

如果攻击者在：

```text
apply 失败
→ rollback 开始
```

之间替换父目录为 junction/symlink，rollback 可能发生越界删除/写回。

### 修复

rollback 每个 entry 都必须：

```text
resolveSafeWritePath()
```

并且 restoration 后再次：

```text
resolveSafeReadPath + hash
```

若安全恢复无法完成：

```text
不要尝试不安全写回
标记 MANUAL_RECOVERY_REQUIRED
保留 journal
```

---

## SEC-103 — P2：服务端仍允许调用者传非 loopback bind host

代码仍然：

```text
const host = options.host ?? '127.0.0.1'
server.listen({ host })
```

虽然 Host header/session 会阻止大多数意外访问，但“服务只绑定 loopback”不应该只是默认值。

### 修复

`startServer()`：

```text
host 只能是
127.0.0.1
::1
localhost
```

否则启动直接失败。

正常产品代码不需要 LAN bind 能力。

---

## SEC-104 — P2：IPv6 Host 解析有 bug

当前：

```text
hostHeader.split(':')[0]
```

对于：

```text
[::1]:12345
```

解析结果不是 `[::1]`。

所以代码虽然 allowlist 写了：

```text
::1 / [::1]
```

实际带端口 IPv6 Host 仍会被拒绝。

Windows 默认 127.0.0.1 不受影响，但建议用标准 URL/Host parser。

---

# 5. 当前隐私问题

## PRI-101 — P1：Sanitization 只覆盖 summary，不覆盖完整 Observation

当前：

```text
sanitizeObservation()
```

处理：

```text
observation.summary
```

但直接保留：

```text
canonicalName
displayName
sourceIdentity
sourceEvidence
location.pathToken
```

其中最值得关注的是：

```text
sourceIdentity.canonicalUrl
```

Adapter 从 manifest source 中直接生成：

```text
https://...
```

如果第三方 manifest 写：

```text
https://user:password@internal.example/repo.git
```

该 URL 可能直接进入：

```text
SQLite
Inventory API
```

AI payload 会再次 redact，但本机 DB/API 边界仍未统一清洗。

### 修复

Persistence boundary 应覆盖整个 Observation。

例如：

```text
sanitizeObservation():
  canonicalName
  displayName
  sourceIdentity
  sourceEvidence
  summary
  diagnostics
```

Git URL canonicalization：

```text
new URL()
strip username/password
strip query
strip fragment
normalize .git/trailing slash
```

如果产品不需要 query 参数：

```text
直接拒绝含 credential/query 的 source URL
```

---

## PRI-102 — P2：SQLite “10 runs / 30 days” 实际没有限制 30 天内的 run 数量

代码先取得最近 10 个 successful/partial `keepIds`，

但删除逻辑主要条件仍是：

```text
started_at < 30-day-cutoff
```

因此如果用户一天扫描 100 次：

```text
100 次都小于 30 天
→ 基本不会因为“超过 10 次”而删除
```

与文档：

```text
保留最近 10 次
```

不一致。

### 正确策略

建议明确为：

```text
保留 successful/partial 中：
  最近 10 次
  且最多 30 天

failed/cancelled：
  更短，比如 3 天 / 最近 5 次
```

直接计算 keep-set，再删除 keep-set 之外的 run。

---

## PRI-103 — P2：Proposal Store 仍直接持久化 AI output

`saveProposal()` 没有 persistence sanitization。

虽然 AI 输入已最小化并脱敏，但 Provider 输出属于“不可信外部数据”。

建议：

```text
validate Proposal
→ redact claim values/evidence
→ persist
```

尤其避免模型把输入中未预期信息重新输出到 DB。

---

# 6. 核心功能正确性

## FUN-101 — P1：Cancelled scan 会替换当前进程的 delta baseline

启动后 baseline：

```text
last successful/partial run
```

是正确的。

但扫描结束时当前代码无论 status：

```text
completed
partial
cancelled
```

都会：

```text
lastRunId = result.run.runId
```

因此：

```text
成功扫描 A
→ 扫描 B 中途取消
→ B 被设置成 baseline
→ 扫描 C 的 added/changed/missing 相对 B 计算
```

不符合设计：

> failed/cancelled run 不替换 last-successful baseline。

### 修复

只有：

```text
completed
partial
```

可以更新：

```text
lastBaselineRunId
```

scanId→runId 可以正常保存 cancelled run 用于历史查看，但 baseline 要单独维护。

---

## FUN-102 — P1：Delta key 会合并同名不同 scope/source 的资产

当前：

```text
provider | kind | canonicalName
```

作为 Map key。

这会把很常见的：

```text
user skill: code-review
repo skill: code-review
```

折叠成同一条。

甚至两个不同 source 的同名 plugin 也可能冲突。

### 修复

Delta identity 应优先：

```text
artifactId/sourceIdentity
```

并且至少包含：

```text
provider
kind
scope
normalized location/source identity
```

不要只用 name。

新增：

```text
user + repo same name
same name different source
same name cache/source copies
```

回归测试。

---

## FUN-103 — P1：Pinned revision 在 Observation 没 revision 时仍可被当作 source match

Reconcile 当前：

```text
entry 有 revision
obs 有 revision
且不同
→ false
```

意味着：

```text
entry revision = abc123
obs revision = undefined
```

仍可能 `identityMatches == true`。

随后 `detectDrift` 也只在 Observation revision 存在时比较。

因此 Catalog 明确 pin revision 时，扫描证据没 revision，也可能显示：

```text
matched
```

而不是：

```text
unverified / missing-source / drifted
```

### 修复

当 Catalog pin revision：

```text
Observation revision 必须存在且相等
```

否则：

```text
source URL matches
revision unverified
```

单独状态或 diagnostic。

---

## FUN-104 — P2：所谓 alias pipeline 实际没有真正 alias model

`matchByAlias()` 当前基于：

```text
artifactId === metadata.id
or
artifactId.endsWith("-" + idSlug)
```

但正常 Artifact ID 通常形如：

```text
skill-name-<digest/source>
```

所以这一策略大多数情况下无法表示真实“人工 alias”。

如果产品确实需要 Alias：

Catalog schema 应明确：

```yaml
metadata:
  aliases:
    - ...
```

或：

```yaml
verification:
  linkedObservationId:
```

不要从 Artifact ID 字符串结构猜 alias。

---

## FUN-105 — P2：AGENTS chain 的正常 Panel context 实际只到 repoRoot

Codex chain 实现本身已经比上一版正确很多。

但是 Local Agent 扫描 context：

```text
cwd = repoRoot
```

因此：

```text
chainDirs(cwd, repoRoot)
```

正常使用时只有 Git root 一层。

仓库子目录的：

```text
sub/AGENTS.md
sub/.agents/skills
```

不会因为“当前上下文”被加载，除非调用方给一个更深 cwd。

这需要明确产品语义：

### 方案 A：Panel 是仓库全量盘点

扫描整个 repo 的 nested AGENTS / Skills，

然后 UI 让用户选择：

```text
Context path
```

再计算哪个 chain 生效。

### 方案 B：Panel 只模拟 repoRoot context

那文档应该明确：

```text
当前上下文固定 Git root
```

不要描述成“完整 Codex 当前上下文链”。

推荐 A。

---

# 7. Release / Packaging

## REL-102 — P1：Portable 包缺少 CI 中的真实解压后 smoke test

新增：

```text
npm run package:portable
```

方向是对的。

但 CI 当前并没有运行该命令。

`package-portable.mjs` 通过手工遍历根：

```text
node_modules
```

并用 skip-list 复制依赖。

这对 npm workspace 尤其危险：

```text
@aitp/* workspace package
```

通常通过 node_modules link/junction 指向仓库 `packages/*`。

如果 ZIP 中保留了指向原工作区的 link，换电脑会直接失效。

即使当前机器 smoke 成功，也不能证明“解压到另一干净路径/机器”成功。

### 修复

CI 增加：

```text
npm run build
npm run package:portable
解压 ZIP 到另一个随机目录
确认不存在指向原 repo 的 junction/symlink
node agent/dist/start.js
GET /health
启动 scan fixture
关闭
```

更推荐从“复制 root node_modules”改成：

```text
bundle JS
+
单独携带 better-sqlite3 native module
```

或构造真正的 staging production workspace。

---

# 8. CI / 文档一致性

## DOC-101 — P1：PROGRESS.md 当前存在事实漂移

当前文档写：

```text
Phase 0 完成
Phase 1 完成
Phase 2 完成
E2E-01..06 全过
portable smoke 完成
```

但 GitHub 当前事实：

```text
Workflow = failure
E2E-04 failed
E2E-05/06 not run
```

另外：

```text
SQLite retention
SafePath 覆盖
```

也还有上述实现缺口。

### 建议

不要按“代码写了”更新 PROGRESS。

增加三态：

```text
Implemented
CI verified
Release verified
```

例如：

```text
P1-PRI-03
Implementation: done
CI: partial
Release: pending
```

这样文档不会再次领先于事实。

---

# 9. 当前优先级

## 必须先修再称 v0.1.1 完成

```text
1. 修复 E2E-04 fixture，恢复整套 CI 绿色
2. Scanner repo/user scope symlink realpath containment
3. ChangeSet rollback SafePath
4. Observation 全字段隐私清洗，尤其 sourceIdentity URL
5. cancelled scan 不覆盖 baseline
6. delta identity 修复同名不同 scope/source
7. Reconcile pinned revision 未验证问题
8. 更新 PROGRESS，使其与 CI 一致
```

## v0.1.1 RC 后建议紧接着修

```text
9. SQLite retention 真正 cap 10 runs
10. Portable ZIP clean-directory smoke
11. 强制 loopback bind
12. IPv6 Host parsing
13. Proposal persistence sanitization
14. E2E 去 serial / 每用例独立 fixture
```

## 可以进入 v0.2 再做

```text
15. explicit alias model
16. context-path aware AGENTS chain
17. cookie bootstrap + HttpOnly + CSRF
18. 完整 i18n
19. Remote Resolver
20. AI UI
21. 真正 vendoring
```

---

# 10. 建议的下一批 PR

```text
PR-14 test: make E2E fixtures clean-clone deterministic
PR-15 security: enforce scoped realpath containment in provider scanners
PR-16 security: safe rollback and recovery journal hardening
PR-17 privacy: sanitize complete Observation/source identity
PR-18 inventory: fix baseline and delta identity semantics
PR-19 reconcile: require pinned revision evidence
PR-20 persistence: correct retention semantics
PR-21 release: verify portable archive from clean extracted directory
PR-22 docs: make progress status CI-evidence driven
```

---

# 11. 最新判断

上一版我给这个项目的判断是：

> “安全设计明显强于实现成熟度。”

v0.1.1 之后，这个差距已经明显缩小。

现在更准确的评价是：

> **核心安全框架已经形成，但还需要一轮针对“绕过统一边界的旧路径”和“状态/身份语义”的收口。**

尤其值得肯定的是：

```text
SafePath
sanitization boundary
typed drafts
full diff review
session on GET
real typecheck
CI security gates
sourceIdentity
```

这些不是表面改动，而是真正改善了架构。

下一步不需要再次大规模重构。

最优策略是：

> **做 6–8 个小型、可独立验证的收口 PR，把 CI 变绿并消除剩余边界旁路，然后冻结 v0.1.1。**

此后再进入 v0.2 的 Remote/AI/多上下文能力，会稳得多。
