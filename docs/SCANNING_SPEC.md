# 扫描与 Provider Adapter 规范

## 1. 目的

扫描器负责把本机和当前仓库中的已知配置转换为可复现的 Observation。它只报告能由文件、受支持的 CLI/API 元数据或 Git 证据证明的事实。

扫描器不负责：

- 生成营销式摘要；
- 猜测远程仓库；
- 安装、启停或删除资产；
- 执行 Hook、Skill、Plugin 或配置命令；
- 修改被扫描文件。

## 2. 扫描边界

默认根：

1. 当前 Git 仓库根及当前工作目录到仓库根的规则链；
2. 当前 Windows 用户的 Claude Code/Codex 官方配置位置；
3. 已登记 Marketplace/Catalog Source 的本地清单与缓存元数据；
4. 用户在设置中明确增加的额外只读根。

默认不扫描整个用户主目录、其他磁盘、网络盘、可移动盘或未知仓库集合。

## 3. 扫描阶段

### Detect

确定 Provider 是否可用、配置根是否存在、版本是否可获得。缺少 CLI 但存在配置文件时允许文件扫描；二者都缺少时返回 `not-installed`，不是错误。

### Discover

枚举候选文件/目录和受支持的 CLI/API 记录。候选排序必须稳定：Provider、scope、规范化路径、kind、name。

### Parse

将候选按 kind 解析为 Provider-specific intermediate record。解析器：

- 限制最大文件和目录数量；
- Markdown 只解析 frontmatter、标题和文本；
- JSON/TOML/YAML 作为数据读取；
- JavaScript/TypeScript 配置不 import、不 eval；
- 符号链接只在策略允许时跟随，并记录 link 与 resolved target。

### Normalize

映射为公共 Artifact/Observation，计算稳定 ID、内容 hash、scope 和证据。

### Persist and Delta

原子保存本次 ScanRun，与上一成功 run 比较 added、changed、missing。失败或取消的 run 不替换 last-successful 基线。

## 4. Windows 路径规则

- 内部使用 `fs.realpath` 可得结果；不存在目标保留 lexical path。
- 比较键统一盘符大小写、`.`/`..`、分隔符和尾斜杠；显示值保留用户可识别格式。
- 目录身份不得只依赖大小写，因为目标可能位于大小写敏感目录。
- Junction、symlink 与真实目录分别记录 `linkPath`、`resolvedPath`、`linkType`。
- resolved target 超出允许根时默认只记录链接，不递归读取。
- UNC、网络盘与可移动盘默认拒绝，用户显式启用后仍标注 `external-root`。
- 仓库文件中不保存绝对路径；使用本地 path token 或 repo-relative path。

## 5. Claude Code Adapter

以下位置以官方文档为基线，版本兼容信息记录在 adapter 中。第三方项目使用的旧路径只能作为有测试的 compatibility probe，不能覆盖官方规则。

| 资产 | 用户级 | 仓库级/项目级 | 关键解析 |
|---|---|---|---|
| Skill | `~/.claude/skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` | frontmatter、目录资源、scripts 只列清单 |
| Rule Document | 用户 memory/config 中官方支持位置 | `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md` | scope、import、适用目录 |
| Modular Rule | — | `.claude/rules/**/*.md` | frontmatter/path scope、文本片段 |
| Hook | 用户 settings | `.claude/settings.json`、`.claude/settings.local.json` | event、matcher、type；命令字段脱敏且不执行 |
| Plugin | 已安装元数据和 plugin cache | 本地 plugin root 或声明 | `.claude-plugin/plugin.json` 与组件树 |
| Marketplace | 已登记来源和本地清单 | 仓库内 marketplace source | `.claude-plugin/marketplace.json` 与 plugin entries |

### Claude Plugin 关系

Plugin Observation 与其组件建立 `contains` 边：Skill、Agent、Hook、MCP、LSP、Monitor。v1 Catalog 重点展示 Skill/Hook，但保留未知组件元数据，避免未来 schema 丢失信息。

缓存副本记录 `copyRole: cache`，不能仅因存在缓存就判定启用；启用状态必须来自受支持的 settings/安装元数据，否则为 `unknown`。

### CLAUDE.md import

解析 `@path` 只生成引用边。被引用路径仍需落在允许根并作为独立 Rule Document 扫描；循环引用返回诊断，不无限递归。

## 6. Codex Adapter

| 资产 | 用户级 | 仓库级/项目级 | 关键解析 |
|---|---|---|---|
| Skill | `~/.agents/skills/<name>/SKILL.md` | 从 CWD 到 Git 根的 `.agents/skills` | 同名不静默合并；记录发现目录 |
| Rule Document | Codex home 的 `AGENTS.override.md` 或 `AGENTS.md` | Git 根到 CWD 每层的 override/AGENTS/fallback | 保留加载顺序、覆盖和生效目录 |
| Hook | 官方用户 hooks/config | 项目 hooks/config 与 plugin hooks | trust/enable 状态未知时只读告警 |
| Plugin | 已安装 plugin 元数据 | `.codex-plugin/plugin.json` 所在根 | manifest、assets、source 与组件关系 |
| Catalog Source | 本地 plugin marketplace 元数据 | 仓库声明源 | 只使用官方格式或有版本测试的兼容格式 |

### AGENTS.md 规则链

对一个扫描上下文记录：

1. global selected document；
2. project root；
3. root 到 CWD 的每层 selected document；
4. 同目录候选中被 override/fallback 排除的文件。

UI 必须能解释“文件存在”和“本次上下文实际加载”之间的区别。

## 7. 各 kind 解析契约

### Skill

必须提取：name、description、frontmatter 原值、主文件 hash、资源清单、脚本清单、Provider 扩展字段和解析诊断。description 缺失时保持空并给 warning；静态摘要不冒充原始 description。

### Plugin

必须提取：manifest name/version/description、plugin root、source evidence、组件清单、cache/source/install role、启用状态证据。manifest 未声明版本时为 `unknown`。

### Marketplace/Catalog Source

必须提取：source identity、manifest location、revision/last update（若有证据）、条目列表和本机登记状态。“源已登记”与“其中插件已安装”是不同状态。

### Hook

必须提取：Provider、scope、owner（settings/plugin/skill/agent）、event、matcher、handler type、enabled/trusted evidence。命令、URL、header 和环境变量经过字段级脱敏；UI 默认折叠原始 payload。

### Rule Document

必须提取：文件角色、scope、生效目录、加载顺序、imports、内容 hash、行索引和解析诊断。

### Rule Fragment

扫描器只产生候选片段：source document、start/end line、text hash。分类属于静态/AI Proposal 或人工 Overlay，不属于扫描事实。

## 8. 来源与可信度

来源证据按强到弱排序：

1. 安装器/Marketplace/Plugin 的明确锁定元数据；
2. manifest 中的 source/repository 与固定 revision；
3. 资产所在 Git 工作树的 `remote`、HEAD 和相对路径；
4. 用户人工确认；
5. 内容或名称匹配产生的 candidate；
6. 未知。

前四类可成为 confirmed source；第 5 类只能是 candidate。AI 永远不能单独提升为 confirmed。

## 9. 身份与重复

扫描器生成三个不同概念：

- `artifactId`：逻辑资产；
- `observationId`：Provider + scope + local location + content identity；
- `contentHash`：规范化内容。

重复候选类型：

- `same-source`：同一来源和 revision 的多个安装副本；
- `same-content`：不同位置内容相同；
- `same-name`：同名但来源/内容不同；
- `derived-copy`：cache、junction 或 vendored 副本。

只在证据足够时建立关系，不自动删除或折叠记录。

## 10. 诊断错误码

首批稳定码：

| Code | Severity | 含义 |
|---|---|---|
| `PROVIDER_NOT_INSTALLED` | info | 未检测到 Provider |
| `ROOT_NOT_FOUND` | info | 可选配置根不存在 |
| `ACCESS_DENIED` | warning | 无读取权限 |
| `FILE_TOO_LARGE` | warning | 超过解析上限 |
| `INVALID_FRONTMATTER` | warning | Markdown metadata 无效 |
| `INVALID_MANIFEST` | error | Plugin/Marketplace manifest 无效 |
| `UNSUPPORTED_VERSION` | warning | 格式版本未知，保留原始字段 |
| `SYMLINK_OUTSIDE_ROOT` | warning | 链接目标越界 |
| `IMPORT_CYCLE` | warning | 规则 import 循环 |
| `SECRET_REDACTED` | info | 字段已脱敏 |
| `PARTIAL_SCAN` | warning | Provider 部分候选失败 |

错误消息可本地化；code 和 details schema 稳定。

## 11. 增量扫描

- watcher 只标记 invalidation，不直接解析；
- 以路径、size、mtime 作为快速候选，最终以内容 hash 判断变化；
- adapter/version、扫描配置或 schema 变化使相关 cache 失效；
- 删除使用上一 run 与本次成功枚举差异判断；
- 正在写入的文件使用有限重试和稳定窗口，不能无限等待。

## 12. Fixture 要求

每个 adapter 必须有：

- 空用户目录；
- 最小合法配置；
- 用户级 + 项目级同名资产；
- Plugin 包含 Skill/Hook；
- Marketplace 已登记但插件未安装；
- 缓存副本与源目录；
- 无效 frontmatter/JSON/TOML；
- Junction/symlink、越界链接、循环 import；
- Unicode、空格、长路径和大小写差异；
- 包含假凭据的脱敏样例；
- Provider 新旧格式兼容样例。

Fixture 不得复制真实用户凭据或未经允许的完整第三方内容。

## 13. Adapter 完成标准

一个 adapter 完成需满足：

1. detect/discover/parse contract 全部有类型和单元测试；
2. 支持表中每种 v1 Artifact 或返回明确 unsupported 诊断；
3. 相同 fixture 在重复运行中产生相同 ID、排序和 hash；
4. 部分失败、权限、链接和损坏文件测试通过；
5. 没有执行 fixture 中任何命令的可能；
6. 日志、持久化和测试快照通过敏感数据检查。
