# 本机 Web 控制台规范

## 1. 设计目标

控制台帮助用户快速回答三个问题：

1. 本机和当前仓库发现了什么；
2. 哪些内容已经进入 Git Catalog，哪些只在本机或只收藏；
3. 即将写入仓库的内容是什么，依据是什么。

页面必须区分：

- **Observed fact**：扫描器事实；
- **User metadata**：人工 Overlay；
- **AI proposal**：可选、尚未接受的建议。

不要用相同颜色、标签或字段容器把三者混为一体。

## 2. 全局导航

推荐一级导航：

1. 总览
2. 已安装
3. 目录库
4. 规则
5. AI 分析（未配置时显示为可选入口或隐藏）
6. 变更
7. 来源与设置

全局区域包含：当前仓库、最后成功扫描时间、扫描按钮、全局搜索、诊断计数和未保存/待应用变更计数。

## 3. 总览

### 内容

- Claude Code/Codex 配置发现状态；
- Artifact 总数及 kind 分布；
- installed-only、catalog-only、matched、drifted、ambiguous 数量；
- 本次扫描新增、变化、消失；
- error/warning 诊断；
- 待确认 ChangeSet 与 AI Proposal 数量。

### 行为

- 开始/取消扫描；
- 点击统计进入带预设筛选的列表；
- 从诊断跳转到受影响资产；
- 不提供 Agent 启动或会话控制入口。

## 4. 已安装页

数据源是 Inventory + reconcile 状态。

### 视图

- 卡片：适合名称、简述、状态和来源概览；
- 列表：适合批量比较 Provider、scope、路径 token、hash、Catalog 状态；
- 用户选择保存在本地偏好，不进入 Git Catalog。

### 筛选

- kind；
- Provider；
- scope；
- enabled/unknown；
- reconcile 状态；
- source confirmed/candidate/unknown；
- license status；
- risk/diagnostic；
- tags；
- 最近变化。

筛选状态写入 URL query，刷新和复制链接后可恢复。空结果提示当前筛选条件，而不是笼统“没有数据”。

## 5. 目录库页

数据源是 Git Catalog。

支持：

- 浏览已收录和 archived 条目；
- 新增手工条目；
- 输入 URL/Git/Marketplace 标识收藏未安装资产；
- 从 Observation 创建 draft；
- 编辑 Overlay；
- 查看 source lock 和最后验证时间；
- 发起 vendoring 预览；
- 跳转工作树 diff。

catalog-only 必须使用明确状态，不显示“未检测到”错误式文案，因为它可能是正常收藏。

## 6. 规则页

### 左侧/列表

- Provider；
- Rule Document 类型；
- scope 和生效目录；
- 是否本次上下文实际加载；
- 优先级/覆盖关系；
- hash 和变化状态。

### 详情

- 带行号只读文本；
- imports/引用关系；
- 规则片段候选；
- 人工/静态/AI 分类；
- 重复和冲突候选；
- “保存为 Rule Fragment”动作。

v1 不在此页直接覆盖 `CLAUDE.md`/`AGENTS.md`。保存片段只写 `catalog/rule-fragments`。

## 7. AI 分析页

仅在用户配置 Provider 后启用。内容：

- 可分析任务和选中资产；
- 输入范围、预计大小和脱敏摘要；
- job 状态和错误；
- claims、confidence、evidence；
- 逐项接受/拒绝；
- 已过期 Proposal 状态。

AI summary 不替换原始 description；详情页并列展示。

## 8. 变更页

展示应用产生的仓库变更，而不是整个 Git 客户端。

- ChangeSet 列表和状态；
- 文件 create/update/archive；
- unified diff；
- schema、安全和许可证检查；
- expected hash conflict；
- apply/放弃；
- apply 后的 Git 工作树摘要。

页面文案明确：保存文件不等于 commit，commit 不等于 push。v1 不提供 push 按钮。

## 9. 来源与设置

- 扫描根与排除项；
- Provider 检测结果和配置根；
- Marketplace/Catalog Sources；
- device alias；
- 路径和 snapshot 脱敏策略；
- AI Provider profile（secret 不回显）；
- 离线模式；
- 日志级别和本地数据清理。

危险设置提供影响预览，例如启用外部扫描根、网络请求或 snapshot commit。

## 10. Artifact 详情页

### Header

- display name / canonical name；
- kind、Provider、scope；
- reconcile、enabled、risk 状态；
- 可编辑 short description。

### 功能与结构

- 原始 description/frontmatter；
- 用户 summary/tags/notes；
- Plugin 包含的 Skill/Hook/MCP 等关系；
- Skill resources/scripts 文件清单；
- Rule Fragment 来源行。

### 来源

- confirmed source；
- source candidates；
- revision/version；
- license status/evidence；
- 安装/缓存/源副本角色；
- 本机位置使用脱敏 token，提供本机复制路径动作时需明确只留本机。

### 安装说明

按 Provider 展示人工或验证过的说明，标注来源。命令使用只读代码块；v1 不执行。

### 证据与历史

- Observation evidence；
- parser/version；
- content hash；
- first/last seen；
- scan delta；
- diagnostics；
- AI Proposal 与 field origin。

### 动作

- 纳入 Catalog；
- 编辑 Overlay；
- 添加/确认来源；
- 发起可选 AI 校准；
- 预览 vendoring；
- 查看 ChangeSet/diff；
- archive Catalog entry。

## 11. 编辑体验

- 打开编辑器时保存原始 revision/hash；
- 服务端 schema 校验是权威，客户端同步提供即时提示；
- 外部文件变化返回 conflict，并支持重新加载/复制草稿；
- 关闭有未保存内容的编辑器前确认；
- 成功保存显示具体文件，而不是只有 toast；
- 表单不允许编辑 Observation 事实字段。

## 12. 通用状态

每个数据区域实现：loading、success、empty、partial、stale、offline、error、unauthorized-local-session（如使用 session token）和 schema-incompatible。

扫描期间显示阶段、Provider、已发现数和可取消状态。部分失败仍显示成功数据，并在顶部保留 summary warning。

## 13. 可访问性

- 语义化 landmark、heading 和 table/list；
- 所有操作可键盘完成，焦点顺序与视觉一致；
- 焦点样式可见，不仅依赖颜色表示状态；
- 表单错误通过 `aria-describedby` 关联字段；
- dialog 管理 focus trap 和返回焦点；
- 扫描进度使用节制的 live region；
- 文本/背景对比达到 WCAG 2.2 AA；
- 200% 缩放保留功能；
- 动画遵循 reduced motion。

## 14. 性能

- 大列表虚拟化或分页；
- filter/search 在 5,000 条记录上保持交互响应；
- 详情正文、diff 和关系图按需加载；
- SSE 事件批处理，避免每个候选触发全页 render；
- search index 不包含未授权的 raw secret 字段。

## 15. 页面完成标准

1. PRODUCT_SPEC 的五个用户流程有端到端 UI 路径；
2. 三类信息来源视觉与语义可区分；
3. 所有页面通用状态有组件测试；
4. 关键流程只用键盘可完成；
5. 5,000 条 fixture 的筛选、搜索和列表性能达标；
6. 窄窗口和 200% 缩放无阻断；
7. 变更页完整显示 apply 前 diff 和 apply 后文件结果；
8. UI 中不存在 Agent 启动、会话控制或自动 push 行为。
