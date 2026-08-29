# AI Tools Panel

AI Tools Panel 是一个 Windows 优先、Git 仓库驱动的本机配置资产面板。它扫描 Claude Code 与 Codex 的 Skill、Plugin、Marketplace、Hook 和规则文件，把结果整理为可搜索、可注释、可追踪来源的本机 Web 页面。

项目的核心闭环是：

```text
确定性本机扫描 → 结构化清单 → 可选 AI 信息校准 → 人工编辑 → Git 文件变更
```

AI 不是扫描器，也不是必需依赖。关闭 AI 后，扫描、查阅、编辑、收藏和 Git 保存仍需完整可用。

## v1 范围

- Windows 本机运行；
- Claude Code 与 Codex；
- 用户级与仓库级 Skill；
- Plugin、Marketplace/Catalog Source、Hook；
- `CLAUDE.md`、`AGENTS.md` 及模块化规则；
- 卡片/列表、搜索、筛选和详情页；
- 编辑摘要、标签、备注和安装说明；
- 收藏尚未安装的远程条目；
- 将人工维护内容保存为可审阅的 YAML/Markdown；
- 可选 AI 摘要、规则分类、来源候选和风险提示。

## 明确不做

- 手机 App；
- 启动、控制或远程操作 Claude/Codex 会话；
- 会话记录、用量或审批面板；
- 默认安装、卸载或执行扫描到的 Hook；
- 自动 Git commit 或 push；
- 把凭据、会话、绝对个人路径或原始私有配置提交到仓库。

## 项目状态

仓库当前处于 documentation-first 阶段，尚未生成应用代码。其他开发工具应先阅读 [开发文档索引](docs/README.md)，再按 [实施计划](docs/IMPLEMENTATION_PLAN.md) 从 Milestone 0 开始。

完整现有产品调研见 [调研报告](docs/research/agent-config-control-plane-landscape-2026-08-29.md)。

## 文档入口

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
