# 安全、隐私与 Git 边界

## 1. 威胁模型

被扫描的 Skill、Plugin、Marketplace、Hook、规则文件和远程元数据都不可信。攻击者可能尝试：

- 利用解析器执行配置代码；
- 用 symlink/path traversal 读取或写入仓库外文件；
- 在 Hook/安装命令中放置恶意 shell；
- 把凭据、主目录路径或会话内容带入日志、Git 或 AI；
- 用 prompt injection 操纵 AI 校准；
- 通过本机 HTTP 服务发起跨站写请求；
- 在 preview 与 apply 之间替换目标文件；
- 诱导用户复制无许可证的第三方内容。

系统将扫描内容视为数据，不信任其指令、脚本、HTML 或命令。

## 2. 信任边界

```text
Untrusted files/remotes
        │ read as data
        ▼
Parsers + redaction ──► Inventory (local)
        │ selected minimal payload
        ▼
Optional AI Provider (external boundary)

Browser ── authenticated loopback API ── Local Agent
                                         │ validated changes only
                                         ▼
                                   Git worktree allowlist
```

Catalog 文件在写入前仍是不可信输入；手工编辑可能损坏 schema。

## 3. 解析安全

- JSON/YAML/TOML 使用无代码执行的 parser；
- 禁止 import/eval JavaScript 配置；
- Markdown 禁止执行 HTML/script，预览经过 sanitize；
- 压缩包或远程仓库导入先进入隔离临时目录，限制文件数、展开大小和路径；
- 读取设置最大单文件、总字节、目录深度和候选数；
- MIME/扩展名与实际内容不一致产生诊断；
- parser 超时或异常隔离到单候选；
- 不运行 package lifecycle scripts。

## 4. Hook 与命令

Hook、Skill scripts、Plugin binaries 和安装命令在 v1 只展示，不执行。

- 保存 event、matcher、handler type 和脱敏摘要；
- command、URL、headers、env 单独标记敏感字段；
- Web 预览不把命令变成可点击执行按钮；
- copy 命令动作显示来源和风险提示；
- fixture 中放置会创建标记文件的恶意命令，测试扫描后标记文件不存在。

## 5. 路径与文件写入

- 启动时解析并固定 Git root；
- 所有仓库写入使用 repo-relative path 和 allowlist 根；
- resolve 后再次验证目标仍在 Git root；
- 拒绝 `..`、绝对输入、设备路径、ADS 和越界 symlink/junction；
- 临时文件创建在目标同目录并使用不可预测名称；
- apply 前验证 expected hash，防止 TOCTOU 覆盖；
- 写入后重新读取并校验 schema/hash；
- recovery 备份放 app-owned 目录，不进入 Git。

允许写入根默认只有 `catalog/`、`sources.lock.yaml`、`snapshots/`（显式启用）和将来 schema 指定的项目配置目录。修改 `CLAUDE.md`、`AGENTS.md` 或 `.claude/.agents` 需要未来单独决策，v1 不开放。

## 6. 本地 HTTP 服务

- 默认绑定 `127.0.0.1`/`::1`，不绑定 `0.0.0.0`；
- 启动生成高熵 session token，通过启动 URL 或安全 cookie 建立本机会话；
- cookie 使用 HttpOnly、SameSite=Strict；
- 写请求校验 Origin、session 和 anti-CSRF token；
- CORS 默认关闭，不允许任意 origin；
- CSP 禁止 inline script 和未知远程资源；
- WebSocket/SSE 也校验 session；
- 限制 body、并发、速率和空闲 session；
- 健康检查不暴露路径、版本细节或配置内容；
- 端口变化由启动器传递，不写公共配置。

本项目没有远程控制需求，因此不提供局域网/公网监听开关。

## 7. 敏感数据

至少识别：

- API key、OAuth/token、Authorization/Cookie；
- private key、证书私钥；
- connection string 和带密码 URL；
- `.env` 值与 settings 中敏感字段；
- email、用户名、Windows 主目录和绝对路径；
- session/transcript/auth 文件；
- 高熵字符串。

使用字段规则 + pattern + entropy 多层检测。脱敏值包含稳定类型标记，例如 `<redacted:api-key>`；不保留可逆前后缀到 Git。

仓库 snapshot 使用 device alias 和 path tokens。默认不生成或提交 snapshot。

## 8. AI 与网络

- AI 默认关闭；
- Provider secret 不进入仓库、日志或浏览器持久化；
- 发送前展示数据类别、大小和 Provider；
- prompt injection 内容作为引用数据；
- 模型没有 shell/filesystem/write 工具；
- raw payload/response 默认只驻留内存；
- 网络错误不触发降级到另一个未授权 Provider；
- 远程 source fetch 使用 HTTPS、超时、大小限制和 redirect policy；
- 下载内容不执行，revision 和 digest 可验证时必须校验。

## 9. Git 行为

应用只负责文本文件和 diff：

- 使用原生 Git 读取 root、status、diff 和必要的 remote metadata；
- 不自动 stage、commit、pull、merge、rebase、push；
- 不修改 Git config、hooks 或 credentials；
- 工作树有无关修改时只展示本应用目标文件 diff，不覆盖其他内容；
- apply 前检测同文件外部变化；
- 用户要求 commit 时，commit 与 push 授权分别判断。

## 10. 许可证与第三方内容

- 远程公开可读不等于可复制；
- 无 LICENSE 默认 `unknown`，内容策略 metadata-only；
- AI 许可证识别只能 candidate；
- vendoring 保存 source、revision、license evidence 和 NOTICE；
- 不复制依赖、构建产物、缓存或仓库历史；
- 品牌资产和代码许可证分开检查；
- 不直接复用 AEM BSL 竞争产品代码或无许可证项目代码。

这不是法律意见；商业发布前进行许可证审计。

## 11. 日志与诊断

- structured log 包含 event、requestId/runId、Provider、duration、result code；
- 默认不记录正文、绝对路径、headers、env、命令全文或 AI payload；
- path 使用 token；
- error stack 只写本地调试日志，UI 展示稳定诊断；
- 日志轮转、大小上限和清理设置；
- 导出支持预览脱敏结果。

## 12. 依赖与发布

- lockfile 提交；
- 安装依赖时禁止不必要 lifecycle script，确需原生模块记录理由；
- CI 做依赖审计、secret scan、license report 和构建产物校验；
- Windows 启动脚本不拼接用户输入到 shell；
- 发布包不包含 fixture secrets、`.aitp`、用户 snapshot 或开发日志；
- 生成 SBOM 和 checksum；代码签名属于发布阶段要求。

## 13. 安全测试门

发布前必须通过：

1. path traversal、absolute path、ADS、symlink/junction 越界；
2. malformed/oversized/deeply nested parser inputs；
3. Hook/Skill/Plugin 恶意命令未执行；
4. secret、主目录、email 和 token 不出现在 Git/log/AI payload；
5. localhost CSRF、Origin、CORS、session 和 body limit；
6. expected hash race 与外部编辑 conflict；
7. vendoring license/NOTICE/denylist；
8. prompt injection 与非法 AI 输出；
9. recovery/atomic write 故障注入；
10. 构建产物内容审计。
