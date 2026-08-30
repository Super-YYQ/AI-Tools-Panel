# 开发进度记录

最后更新：2026-08-30（第三轮补齐 M7-02/M7-01）。按 `IMPLEMENTATION_PLAN.md` 的 milestone 追踪；证据为仓库内可运行测试与脚本。

## 状态总览

| Milestone | 状态 | 证据 |
|---|---|---|
| M0 Scaffold & contracts | 完成 | workspace scaffold；`npm run verify` 全绿；`scripts/panel.ps1`；CI workflow；boundary 反向依赖测试（`tests/boundary.test.ts`）；secret scan / license report 脚本；SQLite spike 与生产 store（ADR-011） |
| M1 Catalog + ChangeSet | 完成 | parse/serialize round-trip、未知字段保留 + schema 默认值归一、ChangeSet diff、expected hash、原子写入 + journal 回滚、`sources.lock.yaml` 读写 + 离线 resolver（stale 语义）、Rule Fragment round-trip |
| M2 Inventory core + adapters | 完成 | ID/hash/delta/状态机/重复分类；claude/codex adapter + fixtures；确定性、脱敏、不执行、畸形/超限输入隔离（安全门 2）、权限失败分类 |
| M3 Local API | 完成 | Fastify loopback、session/Origin 校验、scan/inventory/catalog/changesets/git/rules-content/vendoring-preview 端点、SSE `/scans/:id/events`（session 校验 + 缓冲重放）、scanId→runId 别名 |
| M4 Web console | 完成 | 六页面；卡片/列表、URL 筛选、搜索；Observation→Catalog draft（diff 预览→确认→apply）；vendoring 预览（默认 metadata-only）；规则片段行选择保存；agent 静态托管 panel/dist |
| M5 Reconcile + rules | 完成 | 七种状态分类；规则加载链展示；Rule Fragment 走 ChangeSet；sources.lock 离线 resolver |
| M6 AI enrichment | 完成 | task schema、输出校验、禁止字段、payload 最小化 + 脱敏、timeout/非法输出/注入测试；默认关闭且无 UI 入口 |
| M7 Hardening | 完成（v0.1 范围） | 安全门 1/2/3/4/5/6/7/8/9/10 自动化覆盖；CycloneDX 1.5 SBOM（M7-01）；M7-02 可自动化部分：Unicode 路径、长路径（>260 字符）、受限权限（icacls deny → ACCESS_DENIED）fixture 测试；性能基线达标；E2E-01..06 通过。M7-02 的 fresh-machine 手工验收与 Defender/SmartScreen 行为测试属发布阶段人工项 |

## M7-01 SBOM（CycloneDX 1.5）

- `npm run sbom:generate` → `sbom.cyclonedx.json`（gitignored，CI 重新生成）：343 个组件（name/version/purl/license）+ 23 个构建产物 SHA-256 作为 `metadata.properties`。
- 产物完整性校验并入 SBOM：`artifact:audit` 现在将 dist 文件哈希与 SBOM 记录比对（缺失/不匹配/未记录均失败），替代原独立 checksum manifest。
- CI 顺序：build → sbom:generate → artifact:audit。

## M7-02 Windows 路径与权限测试（`windows-paths.test.ts`）

- Unicode 路径：中文/重音/emoji 目录名的发现、解析、稳定 observationId、pathToken 保留 Unicode。
- 长路径：单段 249 字符目录名使总路径超过 260 字符，发现与解析正常（文件系统拒绝时优雅跳过）。
- 受限权限：`icacls /deny` 目录与文件两级 → 稳定 `ACCESS_DENIED` 诊断（而非 FILE_TOO_LARGE），兄弟资产继续扫描（NFR-003）；POSIX 路径以 chmod 000 等价测试补充（非 Windows 运行）。
- 配套改动：`classifyReadFailure()` 区分 access-denied/too-large/missing；skill 解析的 canonicalName 优先取 SKILL.md frontmatter name（SCANNING_SPEC §7）。

## 验证命令

```powershell
npm run verify        # lint + typecheck + 全部测试（105 通过/1 平台跳过）+ schema:check + build
npm run test:e2e      # Playwright Chromium：E2E-01..06
npm run test:performance
npm run secret:scan ; npm run license:report
npm run sbom:generate ; npm run artifact:audit
npm run docs:check
powershell -ExecutionPolicy Bypass -File scripts/panel.ps1
```

## E2E 场景（Playwright，`tests/e2e/panel.spec.ts`）

- E2E-01 首次扫描：双 Provider 发现、诊断、扫描后 `git status` 无变化
- E2E-02 编辑人工简述：diff 预览→apply；第三方 `SKILL.md` 不变；重扫保留 Overlay
- E2E-03 收藏未安装条目：全离线、catalog-only、来源未验证
- E2E-04 本地 Skill import preview：默认 metadata-only；`.env`/脚本被阻止；未确认前仓库不变
- E2E-05 规则片段：行选择 + frontmatter 证据；原规则文件不变
- E2E-06 AI 关闭不影响核心：无 AI 入口；人工编辑端到端可用（Provider 失败注入由 enrichment 单元测试覆盖）

## 已知限制（后续工作）

1. SQLite 为 better-sqlite3（原生模块）；发布打包需锁定版本并携带预编译产物（ADR-011）。
2. 远程收藏 resolver 的在线实现有意未启用——离线语义已实现并有稳定错误码 `REMOTE_RESOLVER_UNAVAILABLE`。
3. 性能基线在开发机测得；发布前应在 CI 固定 runner 上复核并锁定数值。
4. M7-02 中 fresh-machine 全流程验收、Defender/SmartScreen 交互、安装器行为为发布阶段人工/半自动项（IMPLEMENTATION_PLAN 允许在用户确认需要时实现安装器）。
5. UI 语言目前为中文；i18n 结构留待双语版本。
