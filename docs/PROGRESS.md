# 开发进度记录

最后更新：2026-09-02（UI 重设计 + 静态目录站 site-generator 落地；启动修复：--open 多余 cmd 窗口 + start-panel.cmd 双击启动）。

> DOC-101：状态采用三态制——**Implemented**（代码落地，本地测试通过）/ **CI verified**（GitHub Actions 对应 job 绿）/ **Release verified**（fresh-machine 人工验收）。文档不领先于事实。

## UI 重设计与静态目录站（2026-09-02，设计文档 §A/§B）

| 项 | Implemented | CI verified | Release verified | 证据 |
|---|---|---|---|---|
| §A UI 重设计（设计文档 2026-09-02-ui-redesign-and-catalog-site-design.md） | done | pending | — | App 壳 grid 布局（sidebar 左栏，DOM 顺序 header→main→nav 保持键盘契约）；§A.2 GitHub Dark token 化 styles.css；Icons.tsx 16 枚 inline SVG；i18n 全页面迁移（141 keys）；DiffView 行分类着色；EmptyState。E2E 锚点全部保留，E2E 7/7 通过 |
| §B 静态目录站 site-generator | done | pending | — | `packages/site-generator`：§B.3 SiteEntry 白名单投影、§B.4 fail-closed 安全门（条目级+最终 HTML 逐字节扫描）、确定性单文件输出；`npm run site:build`；CI `site.yml`（Pages deploy，首次需手动启用 Pages）；23 个包内测试全绿；§B.8 文档更新（README/SECURITY_AND_GIT §7.1/本文件） |
| FIX 启动 --open 多余 cmd 窗口 | done | pending | — | `spawn('cmd', ['/c', 'start', '', url], {windowsHide:true})`，空参数占住标题槽位 |
| FIX start-panel.cmd 双击启动 | done | pending | — | 仓库根新增 `start-panel.cmd`：node 检测→npm install→build→`node dist/start.js --open` |

## v1.0.0 发布准备（2026-09-02）

| 项 | Implemented | CI verified | Release verified | 证据 |
|---|---|---|---|---|
| REL-101 E2E 确定性（已并入 v1.0.0） | done | done（run 33321066073） | — | E2E 01–06 独立实例 |
| PORT-101 portable 非 ASCII 路径崩溃修复 | done | done（run 33610244298） | — | Node 24.14 `cpSync` 无 filter 递归复制在非 ASCII 祖先路径 fail-fast（0xC0000409）；`safeCopy` no-op filter 规避；本机 `package:portable` + `verify:portable` 实测通过 |
| PORT-102 PowerShell ExecutionPolicy | done | done（run 33610244298） | — | `package-portable.mjs`/`verify-portable.mjs` 加 `-ExecutionPolicy Bypass`；受限策略机器可打包/解压 |
| M7-04 schema version + corrupt DB 演练 | done | done（run 33610244298） | — | `STORE_SCHEMA_VERSION` + `store_meta`；损坏 DB 备份为 `.corrupt-*.bak` 后重建（永不静默删除）；store-sqlite.test 3 个新用例 |
| APP-002 可执行诊断 | done | done（run 33610244298） | — | 非 Git 仓库时面板 banner 给出原因与修复指引（i18n key `repo.notGit.*`） |
| UI-006 键盘验收 | done | done（run 33610244298） | — | E2E-07：纯键盘完成扫描→编辑→diff→应用 |
| icacls 权限测试环境误报修复 | done | done（run 33610244298） | — | deny ACE 先探测生效性，不生效（如 Administrator）自动跳过 |
| 版本对齐 1.0.0 + LICENSE (MIT) + Release Notes | done | docs:check | — | 全 workspace `1.0.0`；`LICENSE`；`docs/RELEASE_NOTES_v1.0.0.md` |

## v0.1.1 RC 修复状态（复审响应，已并入 v1.0.0）

| 复审项 | Implemented | CI verified | Release verified | 证据 |
|---|---|---|---|---|
| REL-101 E2E fixture 确定性 | done | done（CI run 33306524950：e2e job 6/6） | — | E2E 每用例独立 panel+repo 实例；E2E-04 动态创建 gitignored `leaky/.env`；去 `describe.serial` |
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
npm run verify        # lint + 真实 typecheck + 158 通过（含 E2E-07 前置）/1 平台跳过 + schema:check + build
npm run test:e2e      # Playwright：7/7（独立实例，含键盘验收）
npm run test:performance  # 增量扫描 2000 = 2.5s（<5s，冷扫 6.3s 记录在案）
npm run secret:scan / license:report / sbom:generate / artifact:audit
npm audit --omit=dev --audit-level=high   # 0 vulnerabilities
npm run docs:check
```

## REL-04 fresh-machine 人工验收清单（Release verified 层，发布阶段执行）

1. Windows 11 普通用户权限 + 中文用户名/路径 → `panel-portable.ps1` 启动、扫描、编辑、apply。（自动化等价物 `verify:portable` 已在本机非 ASCII 路径通过；本项仍需人工在真实 fresh 机器执行）
2. 长路径（>260）仓库扫描。
3. Defender 实时保护开启下的首次启动与扫描（SmartScreen 提示确认）。
4. 无 Claude / 无 Codex / 仅其一 / 两者并存：健康端点与扫描诊断符合预期。
5. 无 Git 仓库目录：面板给出可执行诊断（APP-002）。（UI banner 已实现并有 E2E 覆盖样式路径；人工确认交互体验）

## 已知限制

1. cookie bootstrap（HttpOnly + CSRF token 换发）按审计归入 v0.2。
2. i18n 已迁移 App 壳/Overview/Settings/Changes；其余页面字符串迁移为 v0.2 小任务。
3. 性能基线数值在开发机测得；CI runner 复核后锁定（perf 测试带 retry:2 容差）。
4. portable 包要求系统 Node 22+ x64；自包含运行时/安装器待用户确认需求。
