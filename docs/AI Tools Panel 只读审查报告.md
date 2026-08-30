 一、关键发现 （确认问题）

  严重级 CRITICAL

  1. C1. 红线/脱敏逻辑覆盖不足
     @ packages/security/src/index.ts:92： redactObject 仅剥离 command/env 字段的字符串值，而不检查嵌套变体如
     commands、cmd、exec、args、script、arguments。导致实际操作和配置时敏感数据有可能从未被 cleaning 到根节点。
  2. C2. 中高 entropy 评估窗口过窄
     @ packages/security/src/index.ts:76：高 entropy 依赖于字符串长度 ≥ 40 和 字符 类 ≥ 3;32-39 字符的 API Key 等 secret
     通常被略过，容易被误认为合法。
  3. C3. 中低级安全风险
     @ packages/security/src/index.ts:32–35：checkRepoRelativePath 检查 resolve() 但没有执行
     fs.realpath()/fs.lstat()，因此如果仓库中有符号链接，路径仍可穿越到该范围外。

  高优先级 HIGH

  1. H1. 邮件敏感级冗余與筛漏冲突
     @ packages/security/src/index.ts:53 vs line 76: redactObject 会将所有 String 装备脱敏为 <redacted:email>，包括
     package.json 中的 author 字段等合法字段。
  2. H2. 写入持久性竞争 hazard
     packages/catalog/src/index.ts:241-307：regioin j 的方法是 journal → temp → rename → commit，但没有增加 inter-process
     lock，catalog 多 Actor 状况可能产生 manual-recovery-required 状态。

  中优先级 MEDIUM

  1. M1. 非确定性固有录入结果
     apps/local-agent/src/scan.ts:39、apps/local-agent/src/scan.ts:40、 adapters/*/index.ts 均依赖 Date.now()/new
     Date().toISOString()，该扫描结果的 bit 级 reproduce 一致性要求（如 SCANNING_SPEC 要求 “deterministic scans”) 无法落地。
  2. M2. 摩擦性 locale 排序
     adapter-claude/src/index.ts:205,261 等多处用 localeCompare()，该方法是字符 locale 排序，在非英语环境下会导致 diff/
     snapshot 改变，破坏稳定 CI。
  3. M3. LocalAgent 主入口体积偏大
     apps/local-agent/src/main.ts 目前 >640 行，包含 catalog write logic 和写入路径，建议分拆和优化。
  4. M4. .env 路径限制对 Windows 兼容性不足
     packages/security/src/index.ts:135：正则表达式 /(^|\/)\.env/ 只匹配 UNIX 式 forward-slash（/.env），而 Windows 支持
     config\.env backslash 路径，虽然其他字段都已正确匹配，但这里没覆盖 (安全覆盖)。

  低优先级 LOW

  1. L1. sbom.cyclonedx.json 被 gitignore 收纳但已 commit
     @ .gitignore:11: 已有 commit 文件也不会被 git add . 指定更新，建议加注释或启用阶段分离。
  2. L2. svg none 文件 （根目录） 缺少语义
     根目录的 none 文件（4 字节）是误传空字段，无验证作用，建议删除。

---

  二、结构与包一致性评估

  1. Packages/apps/方案依赖 package 集成通过 npm workspaces 正确实现，已验证 apps/panel 外的 packages 都包含符合 TS 项目
     reference 要求的 package.json/tsconfig.json。
  2. 遗漏：apps/panel/package.json 未加入主 project references
     @ tsconfig.json:2-14: panel UI (React/Vite) 没有在 tsc -b . 的 reference 中，仅通过独立的 Vite build
     检查。类型安全的总体限制仍为 VEE config 而非良好的 strict tsconfig。
  3. 与构建集成的联动配置（npm scripts）:
     - verify 仅封 lint/typecheck/test/schema:check/build, 缺少对 CI 中某些报告（npm audit、artifact audit、license scan)
       的覆盖。
     - scripts/panel.ps1 和 scripts/e2e.mjs 已存在但未被 npm script 引用，待按需求纳入或删除。
  4. CI 的完整 pipeline 比 verify 功能更全面，但**verify 命名容易误导**，应修正为 echivalent CI 的完整验证。

---

  三、文档一致性 （Spec vs 实现）

  1. M0-M7 状态未被 docs/IMPLEMENTATION_PLAN.md 明确记录 (commits 只能通过 version 跟踪推断），建议在文档中添加 status
  1. M0-M7 状态未被 docs/IMPLEMENTATION_PLAN.md 明确记录 (commits 只能通过 version 跟踪推断），建议在文档中添加 status
     反映和收尾验收标准。
  2. M0-03 (pnpm 包管理） 与实现（npm + package-lock.json）不一致，数学上已实现但文档未更新。
  3. M4–M5 部分（web UI) 和 reconcile的测试强度和覆盖率需要加强，特别是 virtualization/insertive/a11y/存储结构测试。
  3. M4–M5 部分（web UI) 和 reconcile的测试强度和覆盖率需要加强，特别是 virtualization/insertive/a11y/存储结构测试。
  4. 已知的 invariants （确定性、秘密日志、已选/未选的遗留 unknown 保护，Secret 以 redaction 为例），均已通过 tests
     文件落地，但某些 field-level 观察仍依赖于你当前的项目管理、catalog 存储集成和 assemblci 方法的一致性。

---

  四、立即改进建议 （prioritized)

  1. 删除 none 文件（4 字节） — 立刻清理。
  2. 补上 apps/panel 到 tsc -b . 的 references 或在 CI 中增加 types 检查命令以避免 Vite 单点校验。
  3. 增加 流转的 misguard 规范化（针对型字段级带 command/commands/script/args
     等所有变体）来可靠预防日志存储换向路径的文件写入。
  4. 修复 deterministic 边界：对所有 adapters 用 getVersionString() 替代 new Date().toISOString() 或用 stable 的内置 GVM
     模拟可根据稳定的执行 date 输出，而非系统时钟依赖。
  5. 允许 npm run postinst issue 流程： verify 增加 artifact audit, license report, sbom generation 等的完整 hooks, 并在 CI
     中 strict enforce。
  6. 集成 apps/panel 类型检查到 main tsc project references，使用 src/ui 简化和解析 UI test 的 stereotype requirement。
  7. Orphaned cleanup — Keep or delete: scripts/panel.ps1 和 scripts/e2e.mjs，建议合并到主 setup 或合入 CI
     pipeline，而不是其未知状态。





三个待验证点都已读了真实代码，结论更新如下：

  已核实（修正之前"待验证"的结论）

  A. 日志写入 → ⚠️ 真实缺口（确认）
  main.ts 里日志路径是 join(repoRoot, '.aitp', 'agent.log')（.aitp/ 已被 gitignore，✅）。但 main.ts:185 直接
  fs.appendFile(logPath, line) 而周围没有 redactObject/redactText 出现——需要确认 line
  的内容在构建时已脱敏。如果事件载荷里带过原始配置值，就会落盘到日志。这是唯一一条仍未完全敲定、需要再读 line 构造处的点。

  B. Catalog 写边界 → ✅ 做得相当扎实（推翻代理的"待验证"担忧）
  packages/catalog/src/index.ts 的实际防线很完整：
  - ALLOWED_WRITE_ROOTS = ['catalog/', 'sources.lock.yaml', 'snapshots/'] 白名单（index.ts:22）
  - 每个 change 先过 checkRepoRelativePath + 白名单双重校验（index.ts:151,209）
  - 写前 resolveSafeWritePath 做 realpath/junction 包容检查（index.ts:214-215，即 SEC-002）→ 之前的符号链接担忧（原
    H3）其实已被覆盖，rename 前还会重新校验父目录 containment（index.ts:253）
  - journal → tmp → 原子 rename → commit 流程完整，恢复路径也用 resolveSafeReadPath 验证

  所以写边界这条基本可放心，代理之前是因没读到 resolveSafeWritePath 实现而保守标注。

  C. fixture/快照路径 → ✅ 有专门安全测试守护
  - apps/local-agent/test/security/boundary.test.ts:225 明确断言 "fixture secrets never reach DB, HTTP, log or Catalog"
  - fixture 采用隔离 HOME + 合成仓库（tests/e2e/helpers.ts），.env 由 .gitignore 兜底
  - adapter-claude/test/security/no-execution.test.ts 验证扫描恶意 fixture 不产生副作用

  fixture 这条风险已被测试覆盖，不是盲区。

  目前已确认的真实问题（按严重度）

  ┌──────┬──────────────────────────────────────────────────────────────────────────┬───────────────────────────────────┐
  │ 级别 │                                   问题                                   │               位置                │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🔴   │ 脱敏字段名是精确匹配，clientSecret/apiKey/privateKey                     │ security/src/index.ts:92,101      │
  │ 高   │ 等驼峰/复合名不会被按名脱敏，只能靠模式匹配兜底                          │                                   │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🔴   │ 高熵检测要求 ≥40 字符 + ≥3 字符类，短 hex/base64 token（32–39 位）漏网   │ security/src/index.ts:76          │
  │ 高   │                                                                          │                                   │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🟠   │ 日志落盘前未确认脱敏（A，需读 line 构造）                                │ main.ts:185                       │
  │ 中   │                                                                          │                                   │
  │ 中   │                                                                          │                                   │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🟠   │ 扫描 ID/时间戳用 Date.now()/Math.random()，非确定性，与 "deterministic"  │ scan.ts:39、main.ts:312           │
  │ 中   │ 目标冲突                                                                 │                                   │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🟠   │ 排序用 localeCompare，跨 locale 结果不稳定，会影响 diff/快照             │ 多处                              │
  │ 中   │                                                                          │                                   │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🟡   │ sanitizeObservation 只匹配 C:\，漏 POSIX /home、forward-slash Windows    │ inventory-core/src/sanitize.ts:56 │
  │ 低   │ 路径                                                                     │                                   │
  │ 🟡   │ toPathToken 兜底会泄露文件名（如 id_rsa、.env）                          │ security/src/index.ts:124         │
  │ 低   │                                                                          │                                   │
  ├──────┼──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
  │ 🟡   │ .env 排除正则只认 /，漏 config\.env（Windows 反斜杠）                    │ security/src/index.ts:135         │
  │ 低   │                                                                          │                                   │
  └──────┴──────────────────────────────────────────────────────────────────────────┴───────────────────────────────────┘

  结构/工程项（已确认）

  - 根目录 none（4 字节）疑似误建，建议删除
  - apps/panel 未进 tsc -b . references，UI 类型检查只靠 Vite
  - verify ≠ CI 全集（缺 test:integration/security/e2e/audit 等）
  - scripts/panel.ps1、scripts/e2e.mjs 存在但未被任何脚本引用（孤儿）
  - .gitignore 收 sbom.cyclonedx.json 但该文件其实已被 commit（git add . 不会更新它）

  要不要我针对"🔴 高的两条脱敏缺口"给出具体的最小修复补丁（字段名正则放宽 +
  高熵阈值/白名单豁免调整）？这两处是安全收益最直接的。

  - scripts/panel.ps1、scripts/e2e.mjs 存在但未被任何脚本引用（孤儿）
  - .gitignore 收 sbom.cyclonedx.json 但该文件其实已被 commit（git add . 不会更新它）