# 开发进度记录

最后更新：2026-08-30（第六轮：响应 `AI_TOOLS_PANEL_LATEST_REAUDIT_2026-08-30.md`）。

> DOC-101：状态采用三态制——**Implemented**（代码落地，本地测试通过）/ **CI verified**（GitHub Actions 对应 job 绿）/ **Release verified**（fresh-machine 人工验收）。文档不领先于事实。

## v0.1.1 RC 修复状态（复审响应）

| 复审项 | Implemented | CI verified | Release verified | 证据 |
|---|---|---|---|---|
| REL-101 E2E fixture 确定性 | done | done（本地 6/6；CI 待下次 push run） | — | E2E 每用例独立 panel+repo 实例；E2E-04 动态创建 gitignored `leaky/.env`；去 `describe.serial` |
| SEC-101 scanner scoped realpath | done | done（部分场景本地无 symlink 特权会 skip，CI Windows runner 实际执行） | — | `readScopedTextCapped`（祖先 lstat 链 + 链接才 realpath + 目录判定缓存）；CLAUDE.md/Codex AGENTS/SKILL/config/manifest 全部走 scoped 读；测试：越界 symlink → `SYMLINK_OUTSIDE_ROOT` 诊断且内容不进入 inventory |
| SEC-102 rollback SafePath | done | done | — | rollback 逐条 `resolveSafeWritePath` + 恢复后 containment 校验；不安全条目 → `manualRecoveryRequired` + journal 保留 |
| PRI-101 全 Observation 清洗 | done | done | — | `canonicalizeSourceUrl`（去 userinfo/query/fragment、规范化 .git）；canonicalName/displayName/sourceEvidence/pathToken 一并脱敏；测试断言 `secretpw`/email/用户名不入持久化 |
| FUN-101 cancelled 不覆盖 baseline | done | done | — | 仅 completed/partial 更新 baseline；测试断言取消后 inventory 仍指向原 baseline 且取消 run 状态为 cancelled |
| FUN-102 delta identity | done | done | — | delta key = provider/kind/scope/name/pathToken；测试：user+repo 同名新增不折叠 |
| FUN-103 pinned revision 证据 | done | done | — | pinned revision 必须有 observation revision 证据；无证据 → drifted + "unverified" 诊断 |
| PRI-102 retention 真正 cap | done | done | — | keep-set 语义：成功/partial 最近 10 次 ∩ 30 天；failed/cancelled 最近 5 次 ∩ 3 天；测试：12 次 → 剩 10 |
| SEC-103 强制 loopback bind | done | done | — | 非 loopback host 启动即抛 `BIND_HOST_REJECTED`（测试覆盖） |
| SEC-104 IPv6 Host 解析 | done | done | — | URL 解析 Host；`[::1]:port` 接受（测试覆盖） |
| PRI-103 Proposal 持久化脱敏 | done | done | — | `sanitizeProposal` 在两个 store 落库前执行（测试覆盖） |
| REL-102 portable clean-dir smoke | done | done（本地解压冒烟 7 observations；CI e2e job 已接 `package:portable` + `verify:portable`） | pending（fresh 机器人工） | `@aitp/*` 以实体 dist 复制（无 workspace link）；解压断言 0 symlink/junction；解压目录启动 agent → health → scan → 清理 |
| FUN-104 显式 alias model | v0.2 | — | — | 按审计建议：schema 增加 `metadata.aliases` 前不做字符串猜测 |
| FUN-105 context-path AGENTS 链 | v0.2 | — | — | 当前语义固定为 Git-root context；v0.2 采用审计方案 A（全量盘点 + Context path 选择） |
| cookie bootstrap / 完整 i18n / Remote Resolver / AI UI / 真正 vendoring | v0.2–v0.3 | — | — | 审计 §9"v0.1.1 RC 后"与 v0.2 清单 |

## 验证命令与当前结果（Implemented + CI verified 层）

```powershell
npm run verify        # lint + 真实 typecheck + 154 通过/1 平台跳过 + schema:check + build
npm run test:e2e      # Playwright：6/6（独立实例）
npm run test:performance  # 增量扫描 2000 = 2.5s（<5s，冷扫 6.3s 记录在案）
npm run secret:scan / license:report / sbom:generate / artifact:audit
npm audit --omit=dev --audit-level=high   # 0 vulnerabilities
npm run docs:check
```

## REL-04 fresh-machine 人工验收清单（Release verified 层，发布阶段执行）

1. Windows 11 普通用户权限 + 中文用户名/路径 → `panel-portable.ps1` 启动、扫描、编辑、apply。
2. 长路径（>260）仓库扫描。
3. Defender 实时保护开启下的首次启动与扫描（SmartScreen 提示确认）。
4. 无 Claude / 无 Codex / 仅其一 / 两者并存：健康端点与扫描诊断符合预期。
5. 无 Git 仓库目录：面板给出可执行诊断（APP-002）。

## 已知限制

1. cookie bootstrap（HttpOnly + CSRF token 换发）按审计归入 v0.2。
2. i18n 已迁移 App 壳/Overview/Settings/Changes；其余页面字符串迁移为 v0.2 小任务。
3. 性能基线数值在开发机测得；CI runner 复核后锁定（perf 测试带 retry:2 容差）。
4. portable 包要求系统 Node 22+ x64；自包含运行时/安装器待用户确认需求。
