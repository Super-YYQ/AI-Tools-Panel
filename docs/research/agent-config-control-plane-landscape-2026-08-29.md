# AI Agent 配置资产控制台：现有产品调研与基座评估

> 调研日期：2026-08-29  
> 范围：Windows 优先；初版 Claude Code + Codex；本地扫描、可视化、编辑/收藏、Git 仓库存储，以及可选的 AI 信息校准。  
> 证据规则：只引用产品官方仓库、许可证文件、官方产品文档或官方发布页。没有在官方资料中找到的能力统一记为“无证据”，不把推测当作支持。

## 结论先行

截至调研日，没有一个现成产品同时覆盖以下闭环：

1. Windows 原生扫描 Claude Code 与 Codex；
2. 同时理解 Skill、Plugin、Marketplace、Hook、`CLAUDE.md`、`AGENTS.md`；
3. 用本机 Web 控制台查看、筛选和编辑扫描结果；
4. 把“已安装资产 + 尚未安装的收藏条目 + AI 生成的说明”以 Git 仓库作为可审阅的长期数据源。

因此不建议直接照搬一个现有产品。更可行的路线是做一个 **Git-repo-first 的配置资产目录与本地控制平面**，在合适许可证下复用三类成熟思路：

- **Windows 技能扫描、AI 摘要与自定义 Skill 工作流**：`SCwy0207/skills-manager-desktop` 最接近，MIT，可作为桌面端基座候选；但需要新增 Web 服务、插件/市场/Hook/规则适配器与 Git 数据层。
- **跨 Harness 归一化、市场与 LLM 安全扫描**：`mode-io/skill-manager` 最成熟，MIT，可作为后端/领域模型基座候选；但其当前 Windows 版只支持 Codex Skills，Windows 上还没有 Claude、MCP、Slash Command，需要较大移植。
- **可选 AI 信息校准**：AI 只处理扫描器已经找到并脱敏的内容，用于摘要、分类、来源候选和规则片段提取；关闭 AI 后，确定性扫描、查阅、编辑和 Git 保存仍应完整可用。

两个最像“现成完整产品”的项目反而不宜直接作为公开产品基座：

- `spyrae/harness-control-plane`（Agent Ecosystem Map，简称 AEM）功能覆盖很广，但 **BSL 2.0 明确限制竞争产品的生产使用**。本项目的目标正落在它定义的竞争产品范围内；除非只做个人/公司内部使用，或取得单独商业许可，否则不能把它作为对外产品二开的基础。其 Change Date 为 2030-04-06，之后才转 MIT。
- `wangcansunking/claude-config-manager` 对 Claude Plugin/Marketplace/Hook 的覆盖最贴近需求，但仓库当前没有可识别的许可证文件；在作者明确授权前，不能把“公开可读源码”当成允许复制、修改和再发布。

## 需求解释与判定口径

本文把用户需求分成四层，避免把“能显示一个目录”误判为“完整覆盖”。

- **发现层**：确定性读取本机和当前项目中的真实配置，不依赖 LLM 猜测。
- **目录层**：把资产归一化为卡片/列表与详情页，允许附加本项目自己的摘要、来源、安装方式和标签。
- **持久层**：Git 仓库是人工维护资产、收藏条目、规则片段与 AI 注释的事实源；机器扫描快照与密钥不应直接提交。
- **校准层**：可选的 AI 或静态分析补充摘要、分类、来源和风险提示；它不是扫描器，也不是产品运行的前置条件。

表格符号：`✓` 已有官方证据；`△` 部分覆盖或需要适配；`—` 官方资料中无证据；`⚠` 有明确平台、架构或许可阻碍。

## 主要候选能力矩阵

### 平台与界面

| 产品 | Windows | 本机 Web 控制台 | Claude + Codex | 主要产品形态 | 判断 |
|---|---:|---:|---:|---|---|
| [Agent Ecosystem Map](https://github.com/spyrae/harness-control-plane) | ✓ CLI/Web；原生 App 仅 macOS | ✓ | ✓ | 跨工具扫描与可视化 | **内部试用可用；对外产品不可作基座** |
| [claude-config-manager](https://github.com/wangcansunking/claude-config-manager) | ✓ | ✓ localhost | ⚠ Claude-only | Claude 配置管理 | **仅参考**；无许可证 |
| [mode-io/skill-manager](https://github.com/mode-io/skill-manager) | △ Windows 当前只有 Codex Skills | ✓ | △ macOS/Linux 两者均支持；Windows 不支持 Claude | 跨 Harness Skill/MCP 管理 | **许可适合；Windows 能力需大改** |
| [claude-code-tool-manager](https://github.com/tylergraydev/claude-code-tool-manager) | ✓ MSI/EXE | —，Tauri 桌面 | △ 多编辑器同步主要是 MCP | 桌面配置 CRUD | **仅参考**；许可证不完整 |
| [skills-manager-desktop](https://github.com/SCwy0207/skills-manager-desktop) | ✓ Windows 安装包 | △ 有浏览器 mock demo，不是本地服务控制台 | ✓ Skills 发现 | Windows Skill 管理与 AI 摘要 | **最适合参考 Windows 扫描实现** |
| [Gaal](https://github.com/getgaal/gaal) | △ Go 可构建；官方快速安装偏 macOS/Linux | — CLI | ✓ | 声明式 Git/YAML 同步 | **Git-first 模型参考**；AGPL-3.0 |

### 要扫描和管理的资产

| 产品 | Skill | Plugin | Marketplace | Hook | `CLAUDE.md` | `AGENTS.md` | 编辑/自定义 |
|---|---:|---:|---:|---:|---:|---:|---:|
| AEM | ✓ Claude/Codex | —（README 的 plugin runtime 指 usage provider，不是 Claude/Codex Plugin） | △ GitHub registry 导入，不是本机 marketplace 清单 | — | ✓ | ✓ | ✓ 创建、导入、编辑、删除、diff、回滚 |
| claude-config-manager | ✓ Claude | ✓ Claude | ✓ Claude | ✓ 通过 settings/profile | — | — | ✓ Skill Markdown、设置、profile；可安装市场条目 |
| mode-io/skill-manager | ✓ | ⚠ Plugin 与 Hook 在路线图，不是现有能力 | ✓ Skill/MCP；CLI 只预览 | ⚠ 路线图 | — | — | ✓ 采用、启停、同步、创建 Slash Command |
| claude-code-tool-manager | ✓ Claude | — | — | ✓ Claude | — | — | ✓ MCP/Skill/Command/Sub-agent/Hook CRUD |
| skills-manager-desktop | ✓ Claude/Codex/Cursor | — | — | — | — | — | ✓ 自定义 Skill 工作台、部署、启停 |
| Codexia | ✓ 市场 | △ Marketplace 能力，不是本机 Plugin 全量扫描 | ✓ Skill/MCP | — | — | — | △ 更偏安装与使用 |
| agent-dashboard | △ 工作流 Skill | △ 自身适配器/插件，不是配置清单 | — | △ 用 Hook 实现编排，不是扫描所有 Hook | — | — | — |
| Gaal | ✓ 从源同步 | — | — | △ `gaal.yaml` 有 post-sync Hook，非 Agent Hook 扫描 | ✓ 作为 content | ✓ 作为 content | ✓ YAML 事实源、dry-run、drift/status |

### Git 仓库存储与 AI 辅助

| 产品 | Git 仓库作为目录事实源 | 保存“未安装收藏” | AI 摘要/分析 | 来源与安装信息 | 结论 |
|---|---:|---:|---:|---:|---|
| AEM | — SQLite + 本地/provider copies；GitHub 可作为导入源 | △ collections/registry | △ 自动分类，但没有用户所述的来源追踪与规则抽取证据 | △ GitHub registry 导入 | UI/扫描器参考价值高，法律上不可作为竞品基座 |
| claude-config-manager | — 本地配置 + profile JSON | △ marketplace/recommendation | △ 个性化推荐，不是结构化资产分析 | △ marketplace | Claude 专项功能清单与页面参考 |
| mode-io/skill-manager | — App-owned local store | ✓ 市场发现/预览 | ✓ LLM 安全扫描，含等级、证据、修复建议 | ✓ marketplace | 领域模型与 AI 安全流水线可复用 |
| claude-code-tool-manager | — 本地数据库/配置 | △ 可手工建 MCP/Skill | △ AI-controllable，不等于 AI 元数据分析 | △ 导入命令/JSON | Windows CRUD 和 MCP 接口参考 |
| skills-manager-desktop | — 内容寻址本地库 | ✓ 自定义 Skill 工作台 | ✓ 翻译、40–80 字摘要、静态风险、语义校验，可用本地模型/BYOK | ✓ 候选内容显示来源和许可证 | Windows + AI 的最佳基座候选 |
| Gaal | △ `gaal.yaml` 与相对 content 很接近，但未内建 Git 提交 UI | △ 可声明源，但无卡片收藏界面 | — | ✓ repository/source/version | Git-first 配置模型最值得借鉴 |

## 重点项目逐项评估

### 1. Agent Ecosystem Map / harness-control-plane

官方 README 把产品定义为跨 Claude Code、Codex、Gemini、Cursor 等工具的统一控制面。CLI 通过 `npx agent-ecosystem-map` 或 `aem` 打开 React Web UI，也能 `aem scan -o map.html` 生成独立 HTML；CLI 声明 Node.js 18+、任意操作系统。它有本地 HTTP/WebSocket API、文件监听、SQLite、资产编辑、GitHub registry 扫描、历史与回滚，产品形态与目标最接近。[仓库与 README](https://github.com/spyrae/harness-control-plane)

但有三个关键问题：

1. **扫描范围仍不完整。** README 明列 Claude 的 commands/agents/rules/projects/`.mcp.json`/`CLAUDE.md` 和 Codex 的 skills/agents/sessions/`auth.json`/`AGENTS.md`，没有声明扫描 Claude/Codex 的 Plugin、Marketplace 和 Hook。
2. **Codex 路径需要重新核验。** AEM README 仍写 `~/.codex/skills/`，而当前 Codex 官方文档规定用户 Skill 位于 `~/.agents/skills`，仓库 Skill 位于 `.agents/skills`。如果源码没有额外兼容路径，AEM 会漏掉当前标准位置。[Codex Skills 官方文档](https://learn.chatgpt.com/docs/build-skills)
3. **许可证与本项目目标直接冲突。** [AEM LICENSE](https://github.com/spyrae/harness-control-plane/blob/main/LICENSE) 采用 BSL 2.0，并在 Additional Use Grant 中只允许不构成“竞争产品”的生产使用；其竞争产品定义正包括跨多个 AI 助手发现、可视化、连接或管理 AI coding 配置。本项目就是该类别。个人使用、内部业务使用和内部修改被允许；销售相似产品、向第三方托管/托管服务、作为商业产品捆绑则需要另行商业许可。Change Date 是 2030-04-06，届时才转 MIT。BSL 也明确不是 OSI 意义上的开源许可证。

**判定：** 可直接用于个人或内部验证，也非常适合参考产品信息架构、扫描适配器和 diff/rollback 交互；若计划公开发布、SaaS、商业化或形成同类竞争产品，不应 fork 作为基座，除非先取得作者书面商业许可。即便合法使用，也仍要补 Plugin/Marketplace/Hook、真实 Git 事实源和可选的 AI 信息校准。

### 2. wangcansunking/claude-config-manager

它是当前最完整的 Claude 专项配置面板：可用 `npx @wangcansun/cc-config start` 打开 `localhost:3399`，也能从 Claude Plugin 内用 `/ccm-dashboard` 打开；官方 README 声明管理 Plugin、Marketplace、MCP、Skill、Command、settings 中的 Hook、Profile、Session 和 usage，并能编辑 Skill Markdown、导出/导入 profile、浏览市场、给出个性化推荐。[仓库与 README](https://github.com/wangcansunking/claude-config-manager)

不足是 Claude-only，没有 Codex 资产适配、Git 仓库事实源或通用 AI 元数据抽取。更重要的是，调研时仓库根目录和 GitHub 许可证栏均没有 LICENSE；README 也未给出代码再许可条款。

**判定：** 产品需求拆解和 Claude 页面结构的优质参考，不能默认复制、修改或发布其代码。若作者补上明确的宽松许可证或另行授权，再重新评估为基座。

### 3. mode-io/skill-manager

它是一个 MIT 的 local-first Web control center，已经把 Skill、MCP、Slash Command 和 Marketplace 归一到统一 inventory，并支持采用本地 Skill、按 Harness 启停、市场安装以及 LLM 安全扫描。扫描结果包含严重性、证据片段和修复建议；受管 Skill 进入 App-owned canonical store，再用 Unix symlink 或 Windows directory junction 暴露给各 Agent。[仓库与 README](https://github.com/mode-io/skill-manager)；[MIT License](https://github.com/mode-io/skill-manager/blob/main/LICENSE)

它在 macOS/Linux 可覆盖 Codex、Claude、Cursor、OpenCode 等，但 README 对 Windows 明确限定：首个原生 Windows 版本只支持 Codex Skills（`%USERPROFILE%\.agents\skills`），其他 Harness、MCP 和 Slash Command 尚未支持；Plugin 和 Hook 也不是现有核心能力，规则文件同样不在模型内。

**判定：** 许可证、测试结构、Web 形态、跨 Harness 领域模型和 AI 安全扫描都适合做基座或抽取模块；若 Windows + Claude 是 v1 硬要求，需要预留较大改造，不应把现有 Windows 发布版当成“开箱即用”。

### 4. tylergraydev/claude-code-tool-manager

这是 Windows/macOS/Linux 的 Tauri 桌面应用，Claude 侧能管理 MCP、Command、Skill、Sub-agent、Hook、Profile，并内置 MCP Server，让 Claude 本身调用管理操作。它也支持把 MCP 配置同步到 Codex、OpenCode、Cursor、Gemini 等编辑器。[仓库与 README](https://github.com/tylergraydev/claude-code-tool-manager)

这里的“多编辑器”主要指 MCP 配置同步，不能等价为 Codex Skill/Hook/AGENTS 全覆盖；也没有 Plugin、Marketplace、规则文件、本机 Web 控制台、Git 事实源或 AI 摘要。另一个兼容风险是其 README 把 Claude 项目 MCP 写作 `.claude/.mcp.json`，与当前 Claude 官方资料常见的项目根 `.mcp.json` 需要做实际测试。

许可证方面，README 声称 MIT，但调研时仓库根目录没有 LICENSE 文件，GitHub 也未识别许可证。单独一句“MIT”不足以稳定说明版权声明、许可文本和适用范围。

**判定：** 适合参考 Windows Tauri 打包、配置 CRUD、MCP 测试和“让 Agent 调用管理器”的接口设计；在许可证补齐前不建议以代码 fork 为产品基座。

### 5. SCwy0207/skills-manager-desktop

这是最贴近“Windows 优先 + AI 帮助”的宽松许可证候选。官方提供 Windows NSIS/MSI，以 Tauri 2 + Rust + React 实现；发现 Codex、Claude Code、Cursor 的用户/项目 Skills 与会话，使用内容寻址库和 junction/symlink 部署。它有静态风险检查、本地 Ollama/LM Studio、OpenAI BYOK 或 OpenAI-compatible Provider，可生成中文翻译和 40–80 字能力摘要；自定义 Skill 工作台会追问需求、引用可选会话证据、显示来源/许可证并做静态和语义校验。[仓库与 README](https://github.com/SCwy0207/skills-manager-desktop)

源码和技术文档是 [MIT](https://github.com/SCwy0207/skills-manager-desktop/blob/main/LICENSE)，但名称、Logo、图标和安装器美术受单独的 [Brand License](https://github.com/SCwy0207/skills-manager-desktop/blob/main/BRAND_LICENSE.md) 约束；改版分发应换自己的品牌资产。

它目前只解决 Skills/Session，没有 Plugin、Marketplace、Hook、`CLAUDE.md`/`AGENTS.md` 或本机 Web 服务；Git 也不是事实源。

**判定：** 如果先做 Windows 桌面 MVP，它是代码层面最合适的基座候选。建议保留其扫描安全边界、AI provider/redaction、项目 trust model 和自定义 Skill 工作台，重新设计数据层与多资产 adapter；品牌全部替换。若首发必须是浏览器 Web 服务而不是 Tauri，则 `mode-io/skill-manager` 的服务结构可能更省力。

### 6. Gaal：最接近 Git-first 的参考模型

Gaal 用一个 `gaal.yaml` 统一声明仓库、Skills、MCP 和 Agent 直接读取的 content（包括 `AGENTS.md`、`CLAUDE.md`、rules），支持 17 种 Agent、dry-run、status、doctor 与 drift 检查；`gaal init` 会扫描本机已有 Skill 和 MCP 并生成配置。[仓库与 README](https://github.com/getgaal/gaal)

它没有可视化面板和 AI 分析，但“声明式期望状态 → 扫描实际状态 → 预览差异 → 同步”的模型与本项目非常吻合。许可证是 [AGPL-3.0](https://github.com/getgaal/gaal/blob/main/LICENSE)：若链接或修改后作为网络服务提供，需要认真评估对应源码提供义务；若本项目希望使用 MIT/Apache 之类宽松许可，更稳妥的是借鉴领域模型而不是直接嵌入其代码。

## 官方配置事实：适配器不能只照抄第三方路径

### Claude Code

- 项目 Skill：`.claude/skills/<name>/SKILL.md`；用户 Skill：`~/.claude/skills/<name>/SKILL.md`；Plugin Skill 位于插件自己的 `skills/` 目录。[Skills 文档](https://code.claude.com/docs/en/slash-commands)
- 项目规则：项目根 `CLAUDE.md` 或 `.claude/CLAUDE.md`，也有 `CLAUDE.local.md`；模块化规则在 `.claude/rules/`。Claude 不会直接读取 `AGENTS.md`，官方建议在 `CLAUDE.md` 用 `@AGENTS.md` 导入；Windows 因符号链接要求管理员/Developer Mode，更适合使用 import。[Memory 文档](https://code.claude.com/docs/en/memory)
- Plugin 由 `.claude-plugin/plugin.json` 描述，可携带 Skill、Agent、Hook、MCP、LSP、Monitor；Marketplace 为独立目录和清单，已安装插件会复制进 `~/.claude/plugins/cache`，因此扫描要区分来源、缓存副本和启用状态。[Plugin 文档](https://code.claude.com/docs/en/plugins)、[Plugin Reference](https://code.claude.com/docs/en/plugins-reference)、[Marketplace 文档](https://code.claude.com/docs/en/plugin-marketplaces)
- Hook 既可存在于 settings，也可由 Plugin 携带；Hook 会执行命令，必须与普通 Markdown 元数据分级处理，并默认只读展示。[Hooks 文档](https://code.claude.com/docs/en/hooks)
- 自动分析可使用 `claude -p --output-format json --json-schema ...` 获得可验证结构化输出；不加 `--bare` 时会加载当前项目的 Skill、Plugin、Hook、MCP 与 `CLAUDE.md`，因此用于扫描分析时应明确哪些上下文允许进入模型。[Programmatic usage](https://code.claude.com/docs/en/headless)

### Codex

- 当前官方 Skill 位置是仓库 `.agents/skills` 与用户 `~/.agents/skills`；`SKILL.md` 必须包含 `name`、`description`，支持符号链接。[Build skills](https://learn.chatgpt.com/docs/build-skills)
- Codex Plugin 使用 `.codex-plugin/plugin.json`，可分发 Skill、MCP server/connection 与其他资产，并由本地 Marketplace 安装。[Build plugins](https://learn.chatgpt.com/docs/build-plugins)
- Hook 可出现在用户或项目的 `hooks.json`/`config.toml`，Plugin 也可捆绑 `hooks/hooks.json`；官方明确要求先检查和信任 Hook，再允许其执行。[Hooks](https://learn.chatgpt.com/docs/hooks)
- `AGENTS.md` 按全局与项目根到当前目录的链式规则加载；扫描器需要保留 scope、优先级和生效目录，而不是把全部片段无差别拼成一个文件。[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- 如果启用可选 AI 校准，简单的单次结构化分析可调用稳定的 [`codex exec`](https://learn.chatgpt.com/docs/developer-commands?surface=cli)；扫描器本身不依赖 Codex。

## 许可证与“能否做竞品二开”

| 项目 | 许可证现状 | 作为公开/商业产品基座 |
|---|---|---|
| AEM | BSL 2.0，竞争产品生产使用受限；2030-04-06 转 MIT | **不适合**，除非取得商业许可；内部工具例外 |
| claude-config-manager | 仓库未见 LICENSE/许可文本 | **不适合**，先获得明确授权 |
| mode-io/skill-manager | MIT | **适合**，保留版权与许可声明 |
| claude-code-tool-manager | README 写 MIT，但仓库缺 LICENSE | **暂不适合**，要求维护者补齐或书面授权 |
| skills-manager-desktop | 代码/技术文档 MIT；品牌资产单独限制 | **适合代码二开**，必须更换名称、Logo、图标和安装器美术 |
| Gaal | AGPL-3.0 | 可用但会影响分发/网络服务义务；宽松许可产品宜只借鉴模型 |

这不是法律意见。若确定商业化，尤其是准备联系 AEM 作者购买许可或组合 AGPL 组件，应由专业律师审阅最终分发方式。

## 建议的产品边界与实现方向

### 推荐：自主 Git-first 核心 + 可替换的 Agent 适配器

不要把 `~/.claude` 或 `~/.agents` 直接当项目数据库。建议分为：

1. **Repository Catalog（Git 事实源）**：保存人工维护的资产元数据、规则片段、收藏条目、来源锁定信息和 AI 建议；所有变更可 diff/review。
2. **Machine Inventory（机器事实）**：本机服务确定性扫描真实路径，记录 scope、绝对路径、hash、启用状态、来源与风险；默认不提交绝对路径、会话、token、密钥和原始个人配置。
3. **Reconciliation（差异层）**：显示“仓库希望拥有”“本机已安装”“有更新/漂移”“仅收藏未安装”，安装或回写前给 diff 与确认。
4. **AI Enrichment（可选校准层）**：输入是已扫描并脱敏的 manifest，输出必须符合 JSON Schema，只能生成摘要、分类、来源候选与变更提案；关闭后不影响扫描和管理功能。

一个适合 Git 的最小目录可为：

```text
catalog/
  skills/<id>/metadata.yaml
  plugins/<id>/metadata.yaml
  marketplaces/<id>.yaml
  rule-fragments/<id>.md
sources.lock.yaml
snapshots/                 # 只存脱敏、可选择提交的清单
.agents/skills/            # Codex 项目专用 Skill
.claude/skills/            # Claude 项目专用 Skill
AGENTS.md
CLAUDE.md                  # 用 @AGENTS.md 共享基础规则
```

元数据至少应包含 `id`、`kind`、`displayName`、`shortDescription`、`source.type`、`source.url`、`source.revision`、`license`、`installInstructions`、`targets`、`tags`、`notes`、`aiAnalysis`、`lastVerifiedAt`。本地真实路径和凭据只留在机器数据库。

### 针对本仓库的明确工程决策

本仓库当前是零提交空仓库，且本机 Web 控制台是明确目标，因此不建议先 fork 一个桌面产品再反向拆 Web。建议从一个小型 TypeScript monorepo 起步：

- `apps/panel`：React + Vite，本机浏览器中的查阅和编辑界面；
- `apps/local-agent`：仅监听 localhost 的 Windows 本地服务，负责扫描、文件变更和 Git diff；
- `packages/catalog`：版本化 schema、YAML/Markdown Git 存储与 reconcile；
- `packages/adapters/claude-code`、`packages/adapters/codex`：厂商路径、CLI、规则优先级和资产解析；
- `packages/ai-enrichment`：脱敏、JSON Schema 输出验证、证据与置信度；
- `.aitp/`：gitignored 的 SQLite/cache、设备信息、绝对路径和扫描原文。

Tauri 可在需要托盘、自动启动或安装包时作为 Web 界面的壳加入，不应成为 v1 数据层。本地服务默认只监听 localhost。

### 核心数据模型：不要把卡片、安装副本和扫描结果混成一张表

建议至少分开五个概念：

1. `Artifact`：Skill、Plugin、Marketplace/Catalog Source、Hook、Rule Document、Rule Fragment 本身；
2. `Source`：GitHub 仓库、Marketplace、手工 URL、本地作者目录，以及固定 commit/tag 与许可证；
3. `Installation`：某个 Artifact 在某设备、Agent、scope 下的真实路径、启用状态、hash 与版本；
4. `Overlay`：用户在控制台修改的简述、标签、备注和安装提示，不直接污染第三方原文件；
5. `Analysis`：AI/静态分析的摘要、规则分类、来源候选、风险、证据、置信度和时间戳。

这样可以同时表达“网上收藏但未安装”“本机安装但未纳入仓库”“仓库已收录但本机漂移”“同一 Skill 同时装给 Claude 和 Codex”等状态。对于第三方 Skill，默认只保存 URL、许可证、固定 revision 和摘要；只有许可证允许且用户明确选择 vendoring 时才复制完整内容。对于本地自定义 Skill，先做 secret/路径/版权检查，再建议整体纳入仓库。

### 页面信息架构

- **总览**：Claude/Codex 配置是否被发现、扫描时间、资产数量、漂移/风险/待确认数量；
- **已安装**：卡片/列表切换，按类型、Agent、scope、来源、启用状态、许可证、风险和是否入库筛选；
- **目录库**：已收录与“仅收藏未安装”的资产，支持新增 URL、手工条目、导入本地自定义内容；
- **规则**：`CLAUDE.md`、`AGENTS.md`、模块规则和规则片段的分类、适用范围、重复/冲突与生成预览；
- **AI 分析**：待分析队列、结构化结果、证据、置信度和“应用为 Overlay/忽略”操作；
- **变更**：工作树 diff、即将写入/安装/删除的文件、脱敏检查；保存到仓库与 Git commit 分开，push 永远是显式动作；
- **来源与设备**：Marketplace/仓库源、扫描根目录、设备别名和隐私设置。

资产详情页应展示：名称与可编辑简述、类型/目标 Agent/scope/状态、功能说明、源仓库与固定 revision、许可证、安装方式、真实安装位置、包含的 Skill/Hook/MCP 等关系、原始文件预览、用户 Overlay、AI 分析证据、扫描 hash/最后发现时间，以及“收藏、纳入仓库、安装/链接、重新分析、查看 diff”等动作。无法证明的来源必须显示“未知”或“候选”，不能让 AI 猜成确定事实。

### 基座选择建议

| 场景 | 选择 |
|---|---|
| 目标是最快做出 Windows 桌面 MVP，先把 Skill + AI 摘要做好 | fork `skills-manager-desktop`，更换品牌；增设本地 HTTP API 与 Git Catalog |
| 首发就是浏览器控制台，团队能承担 Windows 适配 | 以 `mode-io/skill-manager` 的后端/领域模型为基础，先补 Windows Claude 与规则/Plugin/Hook adapters |
| 只做个人或公司内部 PoC，暂不分发/售卖 | AEM 可直接验证交互，但从第一天隔离业务数据与自研代码，避免未来被 BSL 锁住 |
| 计划未来商业化且希望宽松开源 | 自研 Git-first 核心，选择 MIT 组件；AEM/无许可证项目只观察行为和公开文档，不复制代码 |

## 建议的 v1 范围

把首版压到一个可以形成闭环的范围：

- Windows 原生本地服务 + 本机响应式 Web 控制台。
- 扫描 Claude/Codex 的项目与用户 Skills，Claude Plugin/Marketplace/Hook/`CLAUDE.md`，Codex Plugin/Marketplace/Hook/`AGENTS.md`。
- 卡片、搜索、筛选、详情、原始文件预览、scope/启用状态、来源/许可证/安装方式。
- 手工创建“收藏但未安装”的 Skill/Plugin/Marketplace 条目。
- Git Catalog 保存人工数据与 AI 注释；扫描快照脱敏；提交/推送必须由用户显式触发。
- AI 是可选功能，只做结构化摘要、规则分类、来源候选、许可证提示和“建议上传哪些文件”；任何安装、覆盖、执行 Hook、Git commit/push 都需要独立确认。

第二阶段再做跨机器清单合并、安装与回滚、更多 Agent 配置适配。

## 最终判断

这不是一个“给 AEM 加几个页面”就能完成的项目。真正的新价值在于：**把分散的本机配置发现，与可审阅、可收藏、可追溯的 Git 目录分离，再用 AI 做受约束的元数据增强。** 现有项目各自只覆盖其中一段。

推荐的工程决策是：

1. 对外产品不要基于 AEM BSL 代码；AEM 只作功能基准或内部 PoC。
2. 在 MIT 路线中，优先比较 `skills-manager-desktop` 与 `mode-io/skill-manager` 的代码质量后选一项作为扫描/本地 UI 起点。
3. 把 Plugin、Marketplace、Hook、规则文件做成独立 provider adapters，路径与解析规则以 Anthropic/OpenAI 官方文档为准。
4. 自己实现 Git Catalog；Gaal 的声明式 reconcile 思路可参考，但没有候选产品直接满足“GitHub 仓库就是目录数据库”。
