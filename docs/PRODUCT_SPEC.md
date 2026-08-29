# 产品需求规范

状态：v1 设计基线
目标平台：Windows 10/11，本机浏览器
首批 Provider：Claude Code、Codex

## 1. 问题

AI Coding 工具把 Skill、Plugin、Marketplace、Hook 和规则文件分散在用户目录、仓库目录与缓存目录中。用户难以回答：

- 当前电脑和当前仓库到底有哪些资产；
- 一个 Skill 来自哪里、属于哪个 Plugin、安装给了哪个 Agent；
- 本机自定义内容是否值得纳入 Git；
- `CLAUDE.md`、`AGENTS.md` 和模块规则分别包含哪些约束；
- 网上看到但尚未安装的资产如何先收藏并补充说明；
- 扫描后哪些是事实，哪些只是 AI 推测。

AI Tools Panel 提供一个本机、可审阅、Git 驱动的资产目录。扫描结果与人工目录分离，AI 仅作为可关闭的信息校准功能。

## 2. 产品目标

1. 一条仓库命令启动本机控制台。
2. 确定性发现 Claude Code 与 Codex 的目标资产，并保留来源证据。
3. 用卡片或列表查阅、搜索、筛选和比较资产。
4. 允许编辑本项目自己的摘要、标签、备注和安装说明，不污染第三方原文件。
5. 允许保存尚未安装的远程 Skill、Plugin 或 Marketplace 条目。
6. 将人工目录保存为 YAML/Markdown，使 Git diff 能直接审阅。
7. 可选 AI 提高摘要、分类、来源候选和规则提取的质量。
8. 默认保护凭据、个人路径、会话数据和第三方版权内容。

## 3. 非目标

- 手机 App 或专门的移动端产品；
- 启动、控制、监控或远程操作 Claude/Codex 会话；
- 展示 Agent 对话、用量、成本或审批；
- v1 自动安装、卸载或启停本机资产；
- 执行扫描到的 Hook；
- 把 GitHub 当作数据库 API；
- 自动 commit、自动 push 或在未确认时覆盖规则文件；
- 依靠 LLM 在文件系统中自行寻找资产；
- 将第三方仓库完整镜像进本仓库作为默认行为。

## 4. 核心术语

- **Artifact**：Skill、Plugin、Marketplace/Catalog Source、Hook、Rule Document 或 Rule Fragment。
- **Inventory**：某次本机扫描得到的事实集合。
- **Catalog**：仓库中人工维护、可提交的长期目录。
- **Observation**：Artifact 在特定 Provider、scope、路径和设备上的一次发现。
- **Overlay**：用户为 Artifact 添加的摘要、标签、备注和安装提示。
- **Source**：Git、Marketplace、URL、本地目录或未知来源及其证据。
- **Reconcile**：比较 Inventory 与 Catalog，生成差异和建议变更。
- **Enrichment**：静态规则或可选 AI 对已有记录的结构化信息校准。

## 5. 功能需求

### 5.1 启动与项目识别

- **APP-001**：仓库提供一个 PowerShell 快捷入口和一个包管理器脚本启动本地服务并打开浏览器。
- **APP-002**：服务从 Git 根识别当前项目；不在 Git 仓库时给出可执行诊断。
- **APP-003**：服务默认只绑定 loopback 地址，端口冲突时选择可用端口并明确显示。
- **APP-004**：启动时检测 Claude Code、Codex、Git 和运行时，但缺少任一 Agent 不阻止面板启动。
- **APP-005**：控制台在离线状态下仍可扫描本机、读取 Catalog 和编辑人工元数据。

### 5.2 确定性扫描

- **SCAN-001**：扫描 Claude Code 用户级和仓库级 Skills、Plugins、Marketplaces、Hooks、`CLAUDE.md` 与模块规则。
- **SCAN-002**：扫描 Codex 用户级和仓库级 Skills、Plugins、Catalog Sources、Hooks、`AGENTS.md`/override 链。
- **SCAN-003**：每个 Observation 包含 Provider、kind、scope、规范化路径、内容 hash、解析器版本、发现时间和证据。
- **SCAN-004**：扫描器区分源目录、安装副本、缓存副本和仅声明未安装条目。
- **SCAN-005**：单个文件解析失败不会终止整次扫描；结果包含稳定错误码与修复建议。
- **SCAN-006**：相同内容、相同来源和相同名称分别形成可解释的重复候选，扫描器不静默合并。
- **SCAN-007**：扫描范围可配置；默认只扫描已知用户目录和当前仓库，不递归遍历整个磁盘。
- **SCAN-008**：扫描操作不执行 Hook、Skill 脚本、Plugin 代码或任意配置中的命令。
- **SCAN-009**：用户可以重新扫描并查看与上次扫描的新增、消失和变化记录。

### 5.3 Catalog 与收藏

- **CAT-001**：用户可把一个 Observation 纳入 Catalog，而不修改原始安装文件。
- **CAT-002**：用户可编辑 display name、short description、tags、notes、source candidate 和 install instructions。
- **CAT-003**：用户可用 URL、Git 仓库、Marketplace 标识或手工表单新增“未安装收藏”。
- **CAT-004**：远程条目允许固定 revision；没有固定 revision 时显示可变来源警告。
- **CAT-005**：本地自定义 Skill 可选择“仅记录元数据”或“复制内容到仓库”；复制前必须经过敏感数据与许可证检查。
- **CAT-006**：Catalog 文件通过版本化 schema 校验；未知字段保留，错误字段阻止写入并定位到具体路径。
- **CAT-007**：所有写入先生成 ChangeSet 和文本 diff，用户确认后才落盘。
- **CAT-008**：重扫保留用户 Overlay；扫描事实不能覆盖人工摘要和备注。
- **CAT-009**：Catalog 条目可标记 archived，但历史文件删除属于独立确认操作。

### 5.4 规则文件

- **RULE-001**：展示 `CLAUDE.md`、`AGENTS.md`、override、local 和模块规则的 scope、优先级与生效目录。
- **RULE-002**：规则分类至少支持 build、test、style、security、Git、tooling、architecture、workflow 和 uncategorized。
- **RULE-003**：规则片段包含来源文件与行区间；同一文本可关联多个目标 Provider。
- **RULE-004**：系统提示重复、疑似冲突和过长规则，但不自动改写原始规则文件。
- **RULE-005**：用户可把选中片段保存为 Catalog Rule Fragment，并编辑人工分类。

### 5.5 Web 控制台

- **UI-001**：提供总览、已安装、目录库、规则、可选 AI 分析、变更、来源与设置页面。
- **UI-002**：资产支持卡片/列表切换和全文搜索。
- **UI-003**：筛选至少包含 kind、Provider、scope、安装状态、Catalog 状态、来源、许可证、风险和标签。
- **UI-004**：详情页同时展示事实字段、人工 Overlay、可选 Analysis；三类信息视觉上可区分。
- **UI-005**：所有加载、空数据、部分失败、离线和 schema 错误都有明确状态。
- **UI-006**：编辑表单支持键盘操作、焦点可见、错误关联字段、基础屏幕阅读器语义和 200% 缩放。
- **UI-007**：页面在常见桌面窗口宽度下无横向主滚动；窄窗口保留核心查看和编辑能力，但不将其定义为手机 App。

### 5.6 可选 AI 校准

- **AI-001**：未配置 Provider 时，隐藏或禁用 AI 操作，不影响其他需求。
- **AI-002**：AI 输入只来自确定性扫描结果和用户明确选择的脱敏内容。
- **AI-003**：输出通过 JSON Schema 校验，包含每个 claim 的 confidence 和 evidence。
- **AI-004**：支持摘要、标签建议、规则分类、来源候选和本地自定义 Skill 纳入建议。
- **AI-005**：AI 结果是 Proposal；用户应用后才进入 Overlay。
- **AI-006**：来源、许可证和安装命令不能仅凭模型回答确认为事实。

### 5.7 Git 与持久化

- **GIT-001**：Catalog、规则片段、锁定来源和可选脱敏快照使用文本文件。
- **GIT-002**：绝对路径、凭据、会话和本地缓存保存在 gitignored 的 app-owned 目录。
- **GIT-003**：面板展示工作树中由本应用造成的变更和 diff。
- **GIT-004**：v1 不自动 commit 或 push；文档和 UI 明确区分“保存文件”“commit”“push”。
- **GIT-005**：写入采用临时文件、校验、原子替换；失败时保留原文件。

## 6. 用户流程

### 首次扫描

1. 用户 clone 仓库并运行快捷入口。
2. 面板检测环境并显示可扫描 Provider。
3. 用户开始扫描；部分失败不阻止可用结果。
4. 总览显示发现数量、诊断和 Catalog 差异。

完成条件：用户能定位任一发现项的真实来源和 scope，且仓库没有被扫描动作修改。

### 修改 Skill 简述

1. 用户从已安装列表打开 Skill。
2. 详情页并列显示原始 description 与 Catalog short description。
3. 用户编辑 short description，预览 YAML diff 并保存。

完成条件：第三方 `SKILL.md` 未变化；重扫后人工简述仍存在。

### 收藏未安装条目

1. 用户输入 Git URL 或 Marketplace 标识。
2. 系统确定性读取可安全获得的元数据；网络不可用时允许手工保存。
3. 用户补充摘要、目标 Provider、许可证状态和安装说明。
4. 系统预览并写入 Catalog。

完成条件：条目标记为 catalog-only，不能伪装成已安装。

### 纳入本地自定义 Skill

1. 用户选择扫描到的本地 Skill。
2. 系统显示来源判定、文件清单、敏感数据结果和许可证状态。
3. 用户选择仅保存元数据或复制允许的内容。
4. 系统生成 ChangeSet 并等待确认。

完成条件：复制范围与 diff 完全一致；敏感或未授权内容不会被默认复制。

## 7. 非功能需求

- **NFR-001 可重复性**：相同输入与解析器版本产生相同规范化记录和 ID。
- **NFR-002 性能**：常见机器上 2,000 个候选文件的增量扫描目标在 5 秒内完成；首次扫描提供进度事件。
- **NFR-003 容错**：一个 Provider 缺失或一个文件损坏不影响其他 Provider。
- **NFR-004 可观测性**：日志使用稳定事件名和 run ID，默认脱敏。
- **NFR-005 可扩展性**：新增 Provider 通过 adapter contract 接入，不修改 Catalog 核心。
- **NFR-006 可迁移性**：schema 有明确版本与迁移器；升级前备份被修改文件。
- **NFR-007 本地优先**：除用户请求远程元数据或 AI 外，不产生网络请求。

## 8. v1 总体验收

v1 可交付需同时满足：

1. 全新 clone 可通过文档中的 Windows 快捷命令启动。
2. Claude Code 与 Codex fixture 以及真实空/缺失环境扫描通过。
3. 六类 Artifact 能以稳定 ID 展示，并可追溯 Observation 证据。
4. 编辑 Overlay、收藏条目和保存规则片段均产生可审阅 Git diff。
5. 关闭网络和 AI 后，核心流程全部通过。
6. secret、路径、Hook 不执行和原子写入安全测试通过。
7. 页面关键流程满足键盘和错误态验收。
