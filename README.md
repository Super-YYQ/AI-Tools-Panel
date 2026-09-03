# AI Tools Panel

[![CI](https://github.com/Super-YYQ/AI-Tools-Panel/actions/workflows/ci.yml/badge.svg)](https://github.com/Super-YYQ/AI-Tools-Panel/actions/workflows/ci.yml)
[![Pages](https://github.com/Super-YYQ/AI-Tools-Panel/actions/workflows/site.yml/badge.svg)](https://github.com/Super-YYQ/AI-Tools-Panel/actions/workflows/site.yml)
![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Windows-first](https://img.shields.io/badge/Windows--first-0078d6)
![Last commit](https://img.shields.io/github/last-commit/Super-YYQ/AI-Tools-Panel)

AI Tools Panel 是一个 Windows 优先、Git 仓库驱动的本机配置资产面板。它扫描 Claude Code 与 Codex 的 Skill、Plugin、Marketplace、Hook 和规则文件，把结果整理为可搜索、可注释、可追踪来源的本机 Web 页面。

```mermaid
flowchart LR
    A[确定性本机扫描] --> B[结构化清单]
    B --> C[可选 AI 信息校准]
    C --> D[人工编辑]
    D --> E[Git 文件变更]
```

AI 不是扫描器，也不是必需依赖。关闭 AI 后，扫描、查阅、编辑、收藏和 Git 保存仍需完整可用。



##项目状态

**v1.0.0 已发布**（M0–M7 核心功能完成：workspace scaffold、contracts、catalog/ChangeSet、inventory core、Claude/Codex adapters、Local API、Web 控制台、reconcile、安全加固与发布候选；发布内容与已知限制见 [Release Notes](docs/RELEASE_NOTES_v1.0.0.md) 与 [进度记录](docs/PROGRESS.md)）。当前 main 另含 UI 重设计与静态目录站（2026-09-02 设计文档），已在 GitHub Pages 部署（2026-09-03）。

##功能特性

- Windows 本机运行；Claude Code 与 Codex 双适配；用户级与仓库级 Skill；
- Plugin、Marketplace/Catalog Source、Hook；`CLAUDE.md`、`AGENTS.md` 及模块化规则；
- 卡片/列表、搜索、筛选和详情页；编辑摘要、标签、备注和安装说明；
- 收藏尚未安装的远程条目；人工维护内容保存为可审阅的 YAML/Markdown；
- 可选 AI 摘要、规则分类、来源候选和风险提示；确定性扫描不依赖 AI；
- `catalog/` 可一键构建为 GitHub Pages 静态目录站（见下文）。

###不在范围内

- 手机 App；启动、控制或远程操作 Claude/Codex 会话；会话记录、用量或审批面板；
- 默认安装、卸载或执行扫描到的 Hook；自动 Git commit 或 push；
- 把凭据、会话、绝对个人路径或原始私有配置提交到仓库。



##安装

要求：**Node.js 22+**（含 npm）、Git。



```powershell
git clone <repo-url>
cd AI-Tools-Panel
npm install
```



首次运行（或双击启动器）也会自动执行安装与构建；手动执行以上命令可预先准备环境。





##快速开始（Windows）

三种启动方式任选其一：

- **双击 `start-panel.cmd`** — 自动 `npm install`、构建、启动服务并打开浏览器（推荐日常使用）；
- **PowerShell**：`powershell -ExecutionPolicy Bypass -File scripts/panel.ps1`；
- **手动**：

  ```powershell
  npm run build
  npm start
  ```

首次运行会自动构建并启动本机服务，然后打开浏览器。服务只绑定 loopback 地址；端口冲突时使用可用端口并在控制台显示。





##配置

- `catalog/` — 人工维护的清单数据（YAML/Markdown，面板编辑写出的内容在此；字段规则、ID、overlays、imports 见 [目录与存储规范](docs/CATALOG_SPEC.md)。
- `sources.lock.yaml` — 面板生成的来源锁定文件（与 `catalog/` 同为仅有的两个写入根；见 [安全与 Git 边界](docs/SECURITY_AND_GIT.md)。
- 数据存储（数据库、恢复备份）位于 app-owned 数据目录，不进入 Git；面板设置页可查看仓库与数据状态。





##静态目录站（GitHub Pages）

`catalog/` 可以渲染为一个免登录的公开静态目录站，用于展示已整理的 Skill/Plugin/规则条目：



```powershell
npm run site:build   # 读 catalog/，输出单文件 site-dist/index.html
```



- 输出为**单文件** HTML（内嵌 JSON 数据 + 无依赖渲染脚本），无时间戳，同输入字节级一致；
- 公开采用 **fail-closed 白名单**：只有名称、描述、标签、目标、许可证状态等元数据进入输出；pathToken、绝对路径、内容 hash、RuleFragment 正文、verification 数据在结构上不可达，最终 HTML 还要逐字节通过敏感信息扫描，任一命中即构建失败；
- 无效 YAML 或重复 id 会让构建直接失败（不静默跳过）；
- CI（[site.yml](.github/workflows/site.yml)）在 `catalog/` 或 site-generator 变更推送到 main 时自动构建并部署到 GitHub Pages；本仓库已启用（Settings → Pages → Source: **GitHub Actions**）；fork 部署时需在各自仓库重复该一次性设置。



发布边界与脱敏策略详见 [安全与 Git 边界](docs/SECURITY_AND_GIT.md)。



##测试

开发与验证命令：



```powershell
npm run verify          # lint + typecheck + tests + schema:check + build
npm run test:integration
npm run test:e2e       # Playwright（含键盘验收 E2E-07）
npm run test:security
npm run docs:check
```



安全门与发布命令（secret 扫描、许可证报告、、SBOM、、产物审计、、portable 打包）见 [测试与完成标准](docs/TEST_STRATEGY.md)。

##贡献与开发

开发约定与工作流见 [AGENTS.md](AGENTS.md)；里程碑见 [实施计划](docs/IMPLEMENTATION_PLAN.md) 与 [进度记录](docs/PROGRESS.md)；文档变更与提交推送遵循 [安全与 Git 边界](docs/SECURITY_AND_GIT.md) 的审阅流程。



##文档入口

- [产品需求](docs/PRODUCT_SPEC.md)
- [系统架构](docs/ARCHITECTURE.md)
- [扫描规范](docs/SCANNING_SPEC.md)
- [目录与存储规范](docs/CATALOG_SPEC.md)
- [Web 控制台规范](docs/WEB_UI_SPEC.md)
- [可选 AI 校准](docs/AI_ENRICHMENT_SPEC.md)
- [安全与 Git 边界](docs/SECURITY_AND_GIT.md)
- [实施计划](docs/IMPLEMENTATION_PLAN.md)
- [测试与完成标准](docs/TEST_STRATEGY.md)
- [架构决策](docs/DECISIONS.md)
- [UI 重设计与静态目录站设计](docs/superpowers/specs/2026-09-02-ui-redesign-and-catalog-site-design.md)
- [产品调研](docs/research/agent-config-control-plane-landscape-2026-08-29.md)
- [v1.0.0 发布说明](docs/RELEASE_NOTES_v1.0.0.md)



##安全策略

系统把扫描内容视为不可信数据：解析不执行、凭据与个人路径始终本地脱敏、写入限定在仓库白名单位置、公开静态站采用 fail-closed 字段白名单、Git 操作只读为主（不自动 commit/push）。完整威胁模型、信任边界与安全测试门见 [docs/SECURITY_AND_GIT.md](docs/SECURITY_AND_GIT.md)。



##许可证

本项目采用 [MIT 许可证](LICENSE)。