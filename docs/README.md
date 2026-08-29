# 开发文档索引

本文档集是其他 AI 开发工具的任务路由。先读当前任务对应的文档，不需要在每次修改时加载全部规范。

## 按任务选择文档

| 任务 | 必读文档 | 完成条件 |
|---|---|---|
| 判断产品范围、用户流程或优先级 | [PRODUCT_SPEC.md](PRODUCT_SPEC.md) | 需求可追踪到编号与验收条件 |
| 设计包、API、数据流或领域对象 | [ARCHITECTURE.md](ARCHITECTURE.md)、[DECISIONS.md](DECISIONS.md) | 边界清晰且没有反向依赖 |
| 新增或修正 Claude/Codex 扫描 | [SCANNING_SPEC.md](SCANNING_SPEC.md) | fixture、证据、scope 与失败诊断齐全 |
| 修改 Git 目录、schema 或 reconcile | [CATALOG_SPEC.md](CATALOG_SPEC.md) | schema 校验、稳定 ID 与可预览 diff 齐全 |
| 实现页面或交互 | [WEB_UI_SPEC.md](WEB_UI_SPEC.md) | 页面状态、错误态、键盘与响应式验收通过 |
| 增加 AI 校准 | [AI_ENRICHMENT_SPEC.md](AI_ENRICHMENT_SPEC.md) | 关闭 AI 仍可用；输出可验证且有证据 |
| 涉及凭据、路径、Hook、文件写入或 Git | [SECURITY_AND_GIT.md](SECURITY_AND_GIT.md) | 威胁检查和敏感数据测试通过 |
| 领取下一阶段工作 | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 对应 milestone 的退出条件全部满足 |
| 编写或审查测试 | [TEST_STRATEGY.md](TEST_STRATEGY.md) | 相关测试层级与总体验收通过 |

## 权威顺序

发生冲突时按以下顺序处理：

1. 当前用户明确要求；
2. 根目录 `AGENTS.md` 的硬边界；
3. 具体功能规范；
4. `ARCHITECTURE.md` 和已接受的决策；
5. 产品调研报告。

如果实现必须改变已接受边界，先更新 [DECISIONS.md](DECISIONS.md)，记录原因、替代方案和迁移影响，再修改代码。

## 文档维护

- 每个行为只保留一个权威说明；其他文件使用链接指向它。
- 配置、脚本和 schema 能表达的事实不复制进文档。
- 新功能必须补充需求编号、验收条件和测试位置。
- 删除或替换行为时同步清理过期说明，避免文档沉积。
