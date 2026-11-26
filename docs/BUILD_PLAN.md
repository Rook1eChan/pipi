# 构建计划（BUILD_PLAN）

本文件只记录**已由用户明确确认 B 阶段**的构建任务。未确认的方案、想法、待讨论项一律不进入本文件。

## 1. 门禁

任务进入本文件必须同时满足：

1. 对应课程的 A 阶段已学完
2. B 阶段已经过讨论并整理为完整方案
3. 用户明确确认 B 阶段

任务开始编码前，需再次确认：依赖已完成、文件范围清晰、验收标准可验证。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| 待执行 | 已批准，尚未开始 |
| 实现中 | 正在编码或测试 |
| 待用户验收 | 实现与自测完成，等待用户验收 |
| 已验收 | 用户明确验收通过 |
| 阻塞 | 依赖缺失或方案需重新确认 |

## 3. 决策表

本表是项目决策的唯一来源。课程文档、`LEARNING_PLAN.md`、`SOURCE_COVERAGE.md` 只引用，不重复记录。

| ID | 决策（简述） | 详细内容 | 状态 | 日期 |
| --- | --- | --- | --- | --- |
| D-001 | 采用五包 monorepo | npm workspaces；目录 `packages/{llm,agent,tui,harness,eval}`；依赖方向 `llm ← agent ← harness`，`tui` 独立，`eval ← harness` | 生效 | 2026-10-29 |
| D-002 | 包名与目录一致 | 包名 `@pipi/{llm,agent,tui,harness,eval}`；目录与包名同名 | 生效 | 2026-10-29 |
| D-003 | coding-agent 重命名为 harness | 原项目 `pi-coding-agent` 在新项目对应 `@pipi/harness` / `packages/harness`；原项目路径不改 | 生效 | 2026-10-29 |
| D-004 | 课程拆分为 00–24 | 25 门课程，按构建顺序组织；课程编号与文件名前缀一致（原为 00–25，课程 13 取消后前移，见 D-068） | 生效 | 2026-10-29 |
| D-005 | 课程 00 不产出代码 | 只确定仓库级约定；配置与代码在课程 01 落地 | 生效 | 2026-10-29 |
| D-006 | pipi 使用独立 Public 仓库 | `pipi/` 独立 Git 历史与 GitHub Public 仓库；`my-pi/` 只读 | 生效 | 2026-10-29 |
| D-007 | 引入 Biome | 格式化与 lint 使用 Biome；不引入第二套格式化工具 | 生效 | 2026-10-29 |
| D-008 | TypeScript 使用 NodeNext 单配置 | 不使用原项目 `Node16` + `NodeNext` 双配置 | 生效 | 2026-10-29 |
| D-009 | 测试隔离先用临时目录 | 测试使用 `os.tmpdir()`，不写用户目录；完整隔离脚本后置到课程 24 | 生效 | 2026-10-29 |
| D-010 | eval 包骨架阶段只建占位包 | 当前只保留空包与 smoke 测试；实现后置到课程 24 | 待课程 24 时生效 | 2026-10-29 |
| D-011 | TUI 整体保留，复现深度后定 | 保留课程 21–23；全屏、鼠标、图片、latex 等深度在课程 21 学习时确定 | 待课程 21 时生效 | 2026-10-29 |
| D-012 | tui/native 后置或简化 | 原生剪贴板、平台能力、原生图片能力后置或简化 | 待课程 21 时生效 | 2026-10-29 |
| D-013 | 图像生成后置，课程 08 跳过 | 用户决定跳过课程 08，图像生成不实现；后续是否复现待定 | 生效 | 2026-11-18 |
| D-014 | 剪贴板图片与终端图像后置 | 剪贴板图片、终端图片渲染后置到课程 23 | 待课程 23 时生效 | 2026-10-29 |
| D-015 | evals/SWE-bench 仅了解 | 只做 smoke 与 faux 集成测试，不复现 SWE-bench | 待课程 24 时生效 | 2026-10-29 |
| D-016 | Bun 运行时适配仅了解 | 不影响 Node 运行与主要功能 | 待课程 24 时生效 | 2026-10-29 |
| D-017 | 会话导出 vendor 最小实现 | 使用最小实现或轻量依赖，不复现完整 vendor | 待课程 23 时生效 | 2026-10-29 |
| D-018 | Provider 范围限定三类 | 只构建 OpenAI、Anthropic、DeepSeek 系列，加 faux 测试 provider | 生效 | 2026-10-31 |
| D-019 | 认证只支持 API key，OAuth 不实现 | 用户决定本项目不实现 OAuth：不保留 OAuth 类型、登录、刷新；课程 07 已按 API key 验收 | 生效 | 2026-11-20 |
| D-020 | 不实现 deferred response | 删除 `DeferredHandle`、`deferred` 字段与 `stopReason: "deferred"`；仅在课程中保留说明 | 生效 | 2026-11-05 |
| D-021 | deferred tools 不做改动 | 保留原项目设计，课程 05/06 再决定是否实现 | 生效 | 2026-11-05 |
| D-022 | 模型目录只保留最小条目 | 不复现全量 provider 数据与生成脚本；每个 provider 先保留 1–2 个模型 | 生效 | 2026-10-29 |
| D-023 | compat 只做最小子集 | 先实现 OpenAI Completions 需要的兼容字段；05/06 按需增补 | 生效 | 2026-10-31 |
| D-024 | 课程 02 只做类型与测试 | 工具参数校验归 11，跨 provider 归一化归 06，事件归 03 | 生效 | 2026-10-31 |
| D-025 | 事件类型放在 types.ts | 事件依赖消息类型，同文件避免循环导入 | 生效 | 2026-11-03 |
| D-026 | 引入 partial-json 0.1.7 | 流式 JSON 前缀补全使用该依赖，不自行实现 | 生效 | 2026-11-03 |
| D-027 | lazyApi 后置到课程 05 | 课程 03 只实现 `lazyStream`；04 没有真实适配器，05 实现适配器后再加 `lazyApi` | 生效 | 2026-11-06 |
| D-028 | 不提供事件序列校验器 | 与原项目一致；适配器正确性由测试断言 | 生效 | 2026-11-03 |
| D-029 | 中止测试手工 push aborted | 真实 AbortSignal 接线放到课程 05 | 生效 | 2026-11-03 |
| D-030 | 解析回退改为三步 | 直接解析 → 修复后解析 → partial-json；测试固定新顺序 | 生效 | 2026-11-03 |
| D-031 | 思考事件保留 | 协议包含 `thinking_*` | 生效 | 2026-11-03 |
| D-032 | lazyStream 原样实现 | 初始化失败也进入流协议 | 生效 | 2026-11-03 |
| D-033 | 采用包级 CHANGELOG | 每包一份 `packages/<pkg>/CHANGELOG.md`；只在 `[Unreleased]` 下追加；不加脚本、hook 或 CI 门禁 | 生效 | 2026-10-29 |
| D-034 | 04 只做注册表与目录 | 04 实现 Provider/Models、`createProvider`、`ModelsStore`、模型目录与 faux；不绑定真实适配器 | 生效 | 2026-11-06 |
| D-035 | 真实 provider 工厂后置到 05/06 | 04 不创建真实 provider 工厂；05/06 实现适配器后再绑定 `api` | 生效 | 2026-11-06 |
| D-036 | 动态刷新远端实现后置到 19 | 04 实现接口与内存 store；远端拉取在 19 接入 | 待课程 18 时生效 | 2026-11-06 |
| D-037 | `createProvider` 原样实现 | 支持单一 API、API 映射、静态模型 + 动态覆盖 | 生效 | 2026-11-06 |
| D-038 | 05 使用原生 `fetch` + SSE | 不引入 `openai` SDK；自己实现 HTTP 请求、SSE 分帧与错误体解析 | 生效 | 2026-11-08 |
| D-039 | 05 的 provider 范围 | 实现 OpenAI 与 DeepSeek 两个工厂，共用 `openai-completions` adapter；`lazyApi` 包装 | 生效 | 2026-11-08 |
| D-040 | 工具只做 function + strict | 语法约束工具（`custom` + grammar）后置 | 生效 | 2026-11-08 |
| D-041 | 思考字段只做两种 | 支持 `reasoning_content` 与 `reasoning`；`reasoning_details` 结构化回放后置 | 生效 | 2026-11-08 |
| D-042 | 重试只做核心策略 | 429、5xx、网络错误重试；遵守 `Retry-After` 与 `maxRetryDelayMs` | 生效 | 2026-11-08 |
| D-043 | maxTokens 收窄按原项目 | 实现 `estimateContextTokens` 与 `clampMaxTokensToContext`；思考预算按 `adjustMaxTokensForThinking` | 生效 | 2026-11-08 |
| D-044 | 请求钩子按原项目实现 | `onPayload` 发送前可替换请求体；`onResponse` 在消费 body 前调用 | 生效 | 2026-11-08 |
| D-045 | 07 的 credential 持久化用文件存储 | `FileCredentialStore` 读写 `auth.json`；权限 `0600`、目录 `0700`、临时文件加 `rename` 原子替换、进程内串行写入；跨进程文件锁后置 | 生效 | 2026-11-13 |
| D-046 | 登录与登出放在 Models 层 | `ApiKeyAuth` 增加可选 `login`；`Models.login(providerId, interaction)` 负责调用并写入 store，`logout` 删除记录；登录交互只做 secret 文本输入 | 生效 | 2026-11-13 |
| D-047 | `streamFn` 必传，不设全局默认 | 课程 09 定义 `StreamFn` 类型，由调用方显式传入；不复现原项目 `stream-fn.ts` 的 `setDefaultStreamFn` / `getDefaultStreamFn` 全局槽位 | 生效 | 2026-11-18 |
| D-048 | 课程 09 完整复现循环与事件 | 实现两层循环、四组事件、串行/并行工具批次与全部钩子；`AgentMessage` 支持声明合并扩展自定义角色；参数校验归课程 11，状态机归课程 10 | 生效 | 2026-11-18 |
| D-049 | 不实现 `streamProxy` | 课程 10 不做服务端代理 `StreamFn`；`agent/src/proxy.ts` 标为舍弃 | 生效 | 2026-11-22 |
| D-050 | 课程 10 按原项目实现 | `AgentState` 暴露全部运行态字段；监听者按注册顺序串行 await，异常冒泡；`steeringMode`、`followUpMode` 默认 `single` | 生效 | 2026-11-22 |
| D-051 | `continue` 不预取 steering | `continue` 只判断 steering 是否存在，交由循环入口轮询注入；followUp 仍先 drain 作为 prompt。删除 `skipInitialSteeringPoll` | 生效 | 2026-11-22 |
| D-052 | 队列模式取值改为 `single` | `QueueMode` 使用 `"all"` / `"single"`；语义仍是“一次取一条”，仅改名，与原项目的 `one-at-a-time` 不同 | 生效 | 2026-11-23 |
| D-054 | 课程 12 实现全部八个工具 | 含 `powershell`（复用 bash 实现，仅换 shell 配置与提示）；渲染器后置到 TUI 课程 | 生效 | 2026-11-24 |
| D-055 | `read` 图片分支按原项目 | MIME 识别、EXIF 方向、等比缩放，超出限制时压缩；引入 `@silvia-odwyer/photon-node` 0.3.4 | 生效 | 2026-11-24 |
| D-056 | 搜索与编辑跟随原项目 | rg / fd 系统 PATH 优先，缺失时从 GitHub Releases 下载；`edit` 含模糊匹配、diff 与 unified patch | 生效 | 2026-11-24 |
| D-057 | 截断、输出累积与写入队列纳入课程 12 | 工具执行直接依赖这些能力；原计划单独成课的工具治理内容随之并入课程 12 | 生效 | 2026-11-24 |
| D-058 | bash 注入 `PIPI_*` 环境变量 | `PIPI_SESSION_ID`、`PIPI_SESSION_FILE`、`PIPI_PROVIDER`、`PIPI_MODEL`、`PIPI_REASONING_LEVEL` 来自工具上下文，默认开启；原项目为 `PI_*`，本项目统一加 `PIPI_` 前缀 | 生效 | 2026-11-24 |
| D-059 | 截断函数改名为 `truncateKeepHead` / `truncateKeepTail` | 原名 `truncateHead` / `truncateTail` 容易被读成“截掉头部 / 截掉尾部”，与“保留头部 / 保留尾部”的语义相反；仅改名，行为不变 | 生效 | 2026-11-24 |
| D-060 | 修正尾部截断的 `truncatedBy` 误标 | 删除循环后的 `truncatedBy = "lines"` 兜底行；原项目在 `maxLines = 1` 且单行超字节时会错误报 `"lines"` | 生效 | 2026-11-24 |
| D-061 | 课程 12 按“一个工具一次完整交付” | 每个任务交付一个工具的全部内容：路径/基础设施、实现、测试、导出、changelog；基础能力随首个使用它的工具一起实现 | 生效 | 2026-11-24 |
| D-064 | `edit` 的模糊匹配只处理行尾空白 | 精确匹配失败时按“逐行去行尾空白”比较；原项目还处理缩进差异、智能引号与短横线归一化，暂不复现 | 生效 | 2026-11-24 |
| D-065 | 命令执行直接用 `node:child_process` | 不引入 `cross-spawn`；Windows 的 `.cmd` 解析差异后续按需处理 | 生效 | 2026-11-24 |
| D-066 | 工具文件按“工具 + 支撑”分层 | 八个工具与注册表放 `tools/`，`path-utils`、`truncate`、`queue`、`edit-diff`、`shell` 等放 `tools/support/`，图片在 `images/`；与原项目的扁平结构不同 | 生效 | 2026-11-24 |
| D-067 | 二进制下载器简化 | `rg` / `fd` 先查安装目录与系统 PATH，缺失时从 GitHub Releases 下载；不校验 checksum，不内置解压实现（调用 `tar` / `unzip`） | 生效 | 2026-11-24 |
| D-075 | prompt 模块参数统一为 `projectDir` / `agentDir` | 上下文、技能、模板与资源加载器的选项字段统一用 `projectDir`，与 `agentDir` 对齐；`system-prompt` 仍用 `cwd`，因为它对应提示里输出的 “Current working directory” | 生效 | 2026-11-26 |
| D-073 | 配置目录按原项目结构 | 用户级资源在 `~/.pipi/agent`（skills、prompts、sessions、AGENTS.md），项目级在 `<projectDir>/.pipi`；原项目对应 `~/.pi/agent` 与 `.pi/` | 生效 | 2026-11-26 |
| D-071 | 不保留会话版本与迁移 | 删除 `CURRENT_SESSION_VERSION`、`SessionHeader.version` 与迁移函数，只读写当前格式；格式变更后旧会话文件不再兼容。原项目保留 v1→v3 迁移以兼容早期版本 | 生效 | 2026-11-25 |
| D-069 | 课程 13 实现扩展条目 | `custom`、`custom_message`、`session_info` 与核心条目一起实现；读取时未知类型忽略 | 生效 | 2026-11-25 |
| D-070 | 分支摘要后置到课程 15 | 课程 13 不实现 `branch_summary` 条目与 `branchWithSummary`，摘要生成随压缩一起做 | 生效 | 2026-11-25 |
| D-068 | 取消课程 13（工具治理与安全） | 原计划覆盖的截断、输出累积、diff、写入队列、路径解析已并入课程 12（D-057）；剩余文件按归属前移：`render-utils.ts` → 课程 23，`bash-executor.ts` → 课程 19，`exec.ts` → 课程 20；后续课程编号整体前移一位，课程总数为 00–24 | 生效 | 2026-11-25 |
| D-063 | 工具提示文案内联，不单独导出常量 | `promptSnippet` / `promptGuidelines` 直接写在工具定义里，后续工具一致；与上游的 `xxxToolSystemPromptContribution` 常量不同，代价是一致性测试要重复字面量 | 生效 | 2026-11-24 |
| D-062 | 图片缩放同步执行 | 不实现 `image-resize-worker.ts` 的 worker 线程；缩放直接在进程内调用 photon，行为一致但会短暂占用事件循环 | 生效 | 2026-11-24 |
| D-082 | 摘要调用沿用同一 `StreamFn` | `compact` 与普通对话使用同一个 stream 函数，只替换 context 与请求选项；调用方可选传入 `completeSimple` 回调作为兜底。原项目缺省走 ai 包的全局 `completeSimple`，本项目没有全局 provider registry，因此兜底由调用方注入 | 生效 | 2026-11-26 |
| D-083 | 摘要重试放在 `@pipi/llm` | 新增 `RetryPolicy`、`RetryCallbacks` 与 `retryAssistantCall`，只重试可恢复的 assistant 错误，`aborted` 与 `length` 直接返回；摘要调用统一经过它 | 生效 | 2026-11-26 |
| D-084 | `appendCompaction` 补齐参数 | 直接支持 `details`、`fromHook`、`usage`，与原项目一致，避免课程 17 再改接口 | 生效 | 2026-11-26 |
| D-085 | 分支摘要导航后置 | 课程 15 只实现分支收集、摘要生成与 `branchWithSummary` 存储；切换分支的界面与 `AgentSession` 编排在课程 17/23 | 生效 | 2026-11-26 |
| D-076 | 资源加载分 resolver 与 loader 两层 | `ResourceResolver` 接收 `ResourceSettings`（`agentDir`、`projectDir`、`projectTrusted`、extensions/skills/prompts 的 agent/project 条目），产出 `ResolvedResource { path, enabled, metadata }`；`ResourceLoader` 只按路径装载。原项目对应 `package-manager.resolve()` 与 `DefaultResourceLoader`；`SettingsManager` 在课程 16 填充快照。课程 16 接入前 `projectTrusted` 默认 `true` | 生效 | 2026-11-26 |
| D-077 | resolver 只管 extensions、skills、prompts | resolver 负责默认目录（`~/.pipi/agent/*`、`.pipi/*`、`~/.agents/skills`、项目目录到 git 根的祖先 `.agents/skills`）、settings 条目、目录展开、ignore、启用/禁用模式与 project > user > package 优先级；项目规则与 `SYSTEM.md` / `APPEND_SYSTEM.md` 仍由 loader 查找。原项目同样把这三类交给 package manager | 生效 | 2026-11-26 |
| D-078 | 保留 `extendResources` 命名 | 两个加载入口：`reload()` 全量、`extendResources()` 增量；不采用 `extendResourceLoad`。与原项目同名 | 生效 | 2026-11-26 |
| D-079 | 课程 14 不实现 pi 文档路径段 | 系统提示默认文案省略 README/docs/examples 路径；文档体系建立后按原项目补回。原项目在提示中列出包内 `README.md`、`docs/`、`examples/` | 待文档体系建立时生效 | 2026-11-26 |
| D-080 | 项目规则独立成文件 | `resources/context-files.ts` 单独存放 `loadProjectContextFiles` 与 worktree 遮盖逻辑；原项目写在 `resource-loader.ts` 内。用户确认独立便于阅读 | 生效 | 2026-11-26 |
| D-081 | 项目自身品牌与作用域命名统一 | 扩展清单只读 `package.json` 的 `pipi.extensions`；技能发现模式 `"pipi"`；环境变量 `PIPI_*`；资源作用域 `user` 改为 `agent`（`SourceScope`、`ResourceEntries` 与服务标记同步）；代码注释里的示例路径改为 `~/.pipi/agent`。课程与 `SOURCE_COVERAGE` 中描述原项目 `my-pi` 的内容仍写 `pi` | 生效 | 2026-11-26 |
| D-053 | 工具参数校验只走 TypeBox | 课程 11 只实现 TypeBox 路径：`structuredClone` → 删除可选 null → `Value.Convert` → `Compile().Check`；不实现普通 JSON Schema 的手写 coercion。上游 2026-11-01（`6536f80`）改为独立包 `@earendil-works/pi-schema`（draft 2020-12/7、无 eval、内建 coercion，约 12.4 万字节），本项目不引入；待接入 MCP 或第三方扩展提供的工具时重新评估 | 生效 | 2026-11-23 |

维护规则：

- 写入前通读全表，按决策对象查重；重复的合并，矛盾的先说明再处理，不静默覆盖。
- 状态只取 `生效` 或 `待xxx时生效`；`xxx` 必须是可判定的课程编号、日期或明确条件。
- 每次开始课程、每次修改本表时扫描 `待xxx时生效` 的条目；到期在对话中提醒，不自行转为生效。
- 决策变更时直接更新原行并保留 ID，在历史记录中写明变更；不新增重复行。

## 4. 当前已批准任务

课程 01–05、07、09–14 已完成并验收；课程 06 暂缓，课程 08 跳过。后续课程在 B 确认后按任务表推进。

| 任务 ID | 课程 | 目标与范围 | 涉及文件/模块 | 依赖 | 测试与验收 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T-01-1 | 01 | 建立根工作区与依赖：npm workspaces、Node 版本、根脚本、精确版本安装 | `package.json`、`.npmrc`、`.gitignore`、`package-lock.json` | 无 | `npm ci --ignore-scripts` 成功；`npm pkg get workspaces` 返回 `packages/*`；`tsc`、`vitest`、`biome` 版本可用 | 已验收 |
| T-01-2 | 01 | 配置 TypeScript 与工具链：共享编译选项、路径别名、格式规则、测试别名 | `tsconfig.base.json`、`tsconfig.json`、`biome.json`、`vitest.base.ts` | T-01-1 | `npx tsc --showConfig` 成功；`vitest.base.ts` 可被 Node 加载；`biome check biome.json` 通过；`paths` 覆盖五个包；格式检查在 T-01-4 全量执行 | 已验收 |
| T-01-3 | 01 | 创建五个空包：`llm`、`agent`、`tui`、`harness`、`eval`，建立单向依赖与构建配置 | `packages/*/package.json`、`packages/*/tsconfig.build.json`、`packages/*/vitest.config.ts`、`packages/*/src/index.ts` | T-01-2 | 每包 `npm run build -w @pipi/<pkg>` 生成 `dist/index.js` 与 `.d.ts`；`node -e "import('@pipi/llm')"` 可解析；`harness` 依赖 `llm`、`agent`、`tui`，`eval` 依赖 `harness` | 已验收 |
| T-01-4 | 01 | 建立 smoke 测试与基线验证：每包可导入、全量构建、类型检查、测试通过 | `packages/*/test/smoke.test.ts`、根脚本 | T-01-3 | `npm run build`、`npm test`、`npx tsc --noEmit`、`npx biome check .` 全部通过；测试不写用户目录，需要临时目录时使用 `os.tmpdir()` | 已验收 |
| T-01-5 | 01 | 建立变更记录：五个包各一份 CHANGELOG，写入维护规则 | `packages/*/CHANGELOG.md`、`AGENTS.md` | T-01-3 | 五份 changelog 存在，含 `[Unreleased]` 与五个分节（含 `Breaking Changes`）；AGENTS 规则与提交规范可执行 | 已验收 |
| T-02-1 | 02 | 定义基础类型与内容块：API/Provider 标识、文本/思考/图片/工具调用 | `packages/llm/src/types.ts` | T-01-4 | `tsc --noEmit` 通过；类型可被 `index.ts` 导出；不引入运行时依赖 | 已验收 |
| T-02-2 | 02 | 定义消息：用户、助手、工具结果与 `Message` 联合 | `packages/llm/src/types.ts` | T-02-1 | 类型构造与 JSON 序列化测试通过 | 已验收 |
| T-02-3 | 02 | 定义工具、模型、用量与请求容器：`Tool`、`Model`、`Usage`、`Context`、`StreamOptions` | `packages/llm/src/types.ts` | T-02-2 | `totalTokens` 计算、`reasoning <= output`、工具结果配对测试通过 | 已验收 |
| T-02-4 | 02 | 公共导出与测试：导出类型，补齐类型测试与 changelog | `packages/llm/src/index.ts`、`packages/llm/test/types.test.ts`、`packages/llm/CHANGELOG.md` | T-02-3 | `npm run build`、`npm test`、`tsc --noEmit`、`biome check .` 通过；changelog 有 Added 条目 | 已验收 |
| T-02-5 | 02 | 移除 deferred response：删除句柄、字段、结束原因与事件分支，更新测试与 changelog | `packages/llm/src/types.ts`、`packages/llm/test/types.test.ts`、`packages/llm/CHANGELOG.md` | T-02-4 | `tsc`、`test`、`build`、`biome` 通过；`packages/llm` 中不再出现 deferred | 已验收 |
| T-03-1 | 03 | 新增流式事件联合：块事件、完成事件与错误事件 | `packages/llm/src/types.ts`、`packages/llm/src/index.ts` | T-02-4 | `tsc --noEmit` 通过；12 个事件成员齐全；可由公共入口导出 | 已验收 |
| T-03-2 | 03 | 实现流式 JSON 解析：`repairJson`、`parseJsonWithRepair`、`parseStreamingJson` | `packages/llm/src/utils/json-parse.ts`、`packages/llm/package.json` | T-03-1 | 四种残缺形态均返回对象且不抛异常；`partial-json` 固定为 `0.1.7` | 已验收 |
| T-03-3 | 03 | 实现事件流：`FifoQueue`、`EventStream`、`AssistantMessageEventStream` | `packages/llm/src/utils/event-stream.ts` | T-03-1 | 顺序、结束、结果提取、完成后 `push` 忽略；双消费者行为符合 4.3 | 已验收 |
| T-03-4 | 03 | 实现延迟初始化：`lazyStream` | `packages/llm/src/api/lazy.ts` | T-03-3 | 成功时转发事件并传递结果；setup 失败只产生一个 `error` 事件 | 已验收 |
| T-03-5 | 03 | 公共导出、changelog 与全量验证 | `packages/llm/src/index.ts`、`packages/llm/CHANGELOG.md`、`packages/llm/test/public-api.test.ts` | T-03-4 | `npm run build`、`npm test`、`tsc --noEmit`、`biome check .` 通过；changelog 有 Added 条目 | 已验收 |
| T-04-1 | 04 | Provider/Models 接口与内存注册表；`createModels` | `packages/llm/src/models.ts` | T-03-5 | 注册、查找、删除；未知 provider 行为符合约定 | 已验收 |
| T-04-2 | 04 | `createProvider`：静态模型、动态覆盖、按 `model.api` 分派 | `packages/llm/src/models.ts` | T-04-1 | 单一 API 与 API map 都能分发；缺实现返回 error 流 | 已验收 |
| T-04-3 | 04 | 认证契约与 API key 解析、`applyAuth` | `packages/llm/src/auth/*`、`packages/llm/src/models.ts` | T-04-1 | 存储凭据优先；无凭据回退环境变量；缺失认证产生 error 流 | 已验收 |
| T-04-4 | 04 | 模型目录、三份静态目录与 faux provider | `packages/llm/src/model-catalog.ts`、`providers/catalog/*`、`providers/faux.ts` | T-04-2 | 目录压平、查找正确；faux 可流式返回 | 已验收 |
| T-04-5 | 04 | `ModelsStore` 与刷新合并 | `packages/llm/src/models-store.ts`、`packages/llm/src/models.ts` | T-04-2 | 缓存恢复、动态覆盖、旧刷新不覆盖新结果 | 已验收 |
| T-04-6 | 04 | 导出、测试与 changelog | `packages/llm/src/index.ts`、`packages/llm/test/*`、`packages/llm/CHANGELOG.md` | T-04-1..5 | `build`、`test`、`tsc --noEmit`、`biome check .` 通过 | 已验收 |
| T-05-1 | 05 | context 估算与请求选项：`estimateContextTokens`、`buildBaseOptions`、`clampMaxTokensToContext`、思考预算 | `packages/llm/src/utils/estimate.ts`、`packages/llm/src/api/simple-options.ts`、`packages/llm/src/index.ts` | T-04-6 | 估算、收窄、选项合并、思考预算的单元测试通过 | 已验收 |
| T-05-2 | 05 | 消息与工具转换：`convertMessages`、`convertTools` | `packages/llm/src/api/openai-completions.ts` | T-05-1 | 系统提示、用户文本/图片、助手文本/思考、工具结果、工具 schema 符合 OpenAI 格式 | 已验收 |
| T-05-3 | 05 | 发送请求与 SSE 解析，产出文本与思考事件 | `packages/llm/src/api/openai-completions.ts` | T-05-2 | `text_*` / `thinking_*` 事件顺序与内容正确 | 已验收 |
| T-05-4 | 05 | tool call 累积、usage、`stopReason`、`done` / `error` | `packages/llm/src/api/openai-completions.ts` | T-05-3 | 分片参数还原；usage 与终止原因正确 | 已验收 |
| T-05-5 | 05 | 重试、错误归一化、中止与 `lazyApi` | `packages/llm/src/utils/retry.ts`、`packages/llm/src/utils/error-body.ts`、`packages/llm/src/api/lazy.ts` | T-05-4 | 429/5xx 重试；中止产生 `aborted`；错误进入流 | 已验收 |
| T-05-6 | 05 | OpenAI / DeepSeek provider 工厂、导出、测试与 changelog | `packages/llm/src/providers/*`、`packages/llm/src/api/openai-completions.lazy.ts`、`packages/llm/test/*`、`packages/llm/CHANGELOG.md` | T-05-5 | `build`、`test`、`check` 通过 | 已验收 |
| T-07-1 | 07 | `FileCredentialStore`：读写删除、原子替换、权限、串行写入、中止 | `packages/llm/src/auth/file-credential-store.ts`、`packages/llm/src/index.ts` | T-05-6 | 并发写入不丢数据；重启后可读；文件为 `0600` | 已验收 |
| T-07-2 | 07 | `ApiKeyAuth.login` 与 `Models.login` / `logout` | `packages/llm/src/auth/types.ts`、`packages/llm/src/auth/helpers.ts`、`packages/llm/src/models.ts` | T-07-1 | 登录可持久化；登出可删除；失败不覆盖旧值 | 已验收 |
| T-07-3 | 07 | 解析收尾：错误包装、`source`、`check` 行为 | `packages/llm/src/auth/resolve.ts`、`packages/llm/src/models.ts` | T-07-1 | 未配置与故障可区分 | 已验收 |
| T-07-4 | 07 | 导出、测试与 changelog | `packages/llm/src/index.ts`、`packages/llm/test/*`、`packages/llm/CHANGELOG.md` | T-07-1..3 | `build`、`test`、`check` 通过 | 已验收 |
| T-09-1 | 09 | 定义 `StreamFn`、`AgentEvent`、`AgentLoopConfig`、工具与上下文类型 | `packages/agent/src/types.ts` | T-07-4 | `tsc --noEmit` 通过；类型从包入口导出 | 已验收 |
| T-09-2 | 09 | `runAgentLoop` 循环主体、事件顺序、steer/followUp、终止条件 | `packages/agent/src/agent-loop.ts` | T-09-1 | 事件顺序测试通过 | 已验收 |
| T-09-3 | 09 | `streamAssistantResponse`：partial 替换、最终结果、错误信息 | `packages/agent/src/agent-loop.ts` | T-09-2 | 流式消息测试通过 | 已验收 |
| T-09-4 | 09 | 工具批次：串行/并行、预检、钩子、length 截断、terminate | `packages/agent/src/agent-loop.ts` | T-09-3 | 工具执行测试通过 | 已验收 |
| T-09-5 | 09 | 导出、测试与 changelog | `packages/agent/src/index.ts`、`packages/agent/test/*`、`packages/agent/CHANGELOG.md` | T-09-1..4 | `build`、`test`、`check` 通过 | 已验收 |
| T-10-1 | 10 | `AgentState`、`PendingMessageQueue` 与队列行为 | `packages/agent/src/types.ts`、`packages/agent/src/message-queue.ts`、`packages/agent/src/index.ts` | T-09-5 | 两种排空模式、清空、判空、默认值测试通过 | 已验收 |
| T-10-2 | 10 | `Agent` 生命周期：`prompt`、`continue`、`abort`、`waitForIdle`、`reset`、队列 API | `packages/agent/src/agent.ts` | T-10-1 | 并发拒绝、中止、空闲等待、`continue` 分派测试通过 | 已验收 |
| T-10-3 | 10 | 事件归约与订阅：`processEvents`、`subscribe` | `packages/agent/src/agent.ts` | T-10-2 | 状态字段随事件变化；监听顺序与异常冒泡符合约定 | 已验收 |
| T-10-4 | 10 | 失败收尾、快照与 `createLoopConfig` | `packages/agent/src/agent.ts` | T-10-3 | 循环外异常产生完整事件序列 | 已验收 |
| T-10-5 | 10 | 导出、测试与 changelog | `packages/agent/src/index.ts`、`packages/agent/test/*`、`packages/agent/CHANGELOG.md` | T-10-1..4 | `build`、`test`、`check` 通过 | 已验收 |
| T-11-1 | 11 | `validateToolArguments`：克隆参数、删除可选 null、`Value.Convert`、`Compile` 校验、错误格式化 | `packages/llm/src/utils/validation.ts` | T-10-5 | 类型转换、可选 null、必填缺失、嵌套路径、原始参数不被修改的测试通过 | 已验收 |
| T-11-2 | 11 | `validateToolCall` 与 validator 缓存 | `packages/llm/src/utils/validation.ts` | T-11-1 | 按名字找不到工具时报错；同一 schema 复用缓存 | 已验收 |
| T-11-3 | 11 | 接入 `agent-loop` 的 `prepareToolCall`，失败转工具错误结果 | `packages/agent/src/agent-loop.ts` | T-11-2 | 校验失败产生 `isError: true` 结果，`beforeToolCall` 收到合法参数 | 已验收 |
| T-11-4 | 11 | 导出、测试与 changelog | `packages/llm/src/index.ts`、`packages/llm/test/*`、`packages/llm/CHANGELOG.md` | T-11-1..3 | `build`、`test`、`check` 通过 | 已验收 |
| T-12-1 | 12 | 基础：截断与输出累积 | `packages/harness/src/tools/truncate.ts`、`output-accumulator.ts` | T-11-4 | 行/字节边界、UTF-8 边界、临时文件落盘测试通过 | 已验收 |
| T-12-2 | 12 | `read`：路径解析、图像管线、分段读取、截断续读 | `packages/harness/src/tools/read.ts`、`packages/harness/src/tools/support/*`、`packages/harness/src/images/*` | T-12-1 | 文本 offset/limit、截断提示、图片返回 image 块、MIME 识别测试通过 | 已验收 |
| T-12-3 | 12 | `write` 与写入队列 | `packages/harness/src/tools/write.ts`、`packages/harness/src/tools/support/file-mutation-queue.ts` | T-12-2 | 父目录自动创建；同文件并发写串行、不同文件并行 | 已验收 |
| T-12-4 | 12 | `edit` 与 `edit-diff` | `packages/harness/src/tools/edit.ts`、`packages/harness/src/tools/support/edit-diff.ts` | T-12-3 | BOM/CRLF 保留；精确与模糊匹配；唯一性校验；返回 diff 与 patch | 已验收 |
| T-12-5 | 12 | `ls` | `packages/harness/src/tools/ls.ts` | T-12-2 | 排序、条目上限、非目录报错 | 已验收 |
| T-12-6 | 12 | `bash` 与 `PIPI_*` 环境变量 | `packages/harness/src/tools/bash.ts` | T-12-1、T-12-2 | 流式输出与进度事件；超时与中止杀进程树；非 0 退出码转错误 | 已验收 |
| T-12-7 | 12 | `powershell` | `packages/harness/src/tools/powershell.ts` | T-12-6 | 复用 bash 实现，仅换 shell 配置 | 已验收 |
| T-12-8 | 12 | `grep` 与 rg 获取 | `packages/harness/src/tools/grep.ts`、`packages/harness/src/tools/support/binary-manager.ts` | T-12-1、T-12-2 | 结果上限、长行截断、上下文行、`.gitignore` 生效 | 已验收 |
| T-12-9 | 12 | `find` 与 fd 获取 | `packages/harness/src/tools/find.ts`、`packages/harness/src/tools/support/binary-manager.ts` | T-12-2、T-12-8 | glob 匹配、结果路径相对化、上限提示 | 已验收 |
| T-12-10 | 12 | 工具注册、装配、测试与 changelog | `packages/harness/src/tools/index.ts`、`packages/harness/src/index.ts`、`packages/harness/test/*` | T-12-2..9 | `build`、`test`、`check` 通过 | 已验收 |
| T-13-1 | 13 | 条目类型与 JSONL 读写：头部、逐行解析、延迟落盘 | `packages/harness/src/session/types.ts`、`manager.ts` | T-12-10 | 写入/读回、延迟建文件、坏行跳过、空文件补头部测试通过 | 已验收 |
| T-13-2 | 13 | 树与上下文重建：`getEntryPath`、压缩裁剪、条目转消息 | `packages/harness/src/session/manager.ts`、`context.ts`、`messages.ts` | T-13-1 | 路径上溯、压缩裁剪、模型与思考级别重放测试通过 | 已验收 |
| T-13-3 | 13 | 分支：`branch`、`createBranchedSession` | `packages/harness/src/session/manager.ts` | T-13-2 | 回退后追加形成新分支；单路径导出正确 | 已验收 |
| T-13-4 | 13 | 会话发现与恢复：目录规则、最近会话、cwd 匹配 | `packages/harness/src/session/discovery.ts` | T-13-1 | 按 cwd 分组、按修改时间选中最近会话 | 已验收 |
| T-13-5 | 13 | 会话导出（JSONL）与公共导出、changelog | `packages/harness/src/session/export.ts`、`packages/harness/src/index.ts` | T-13-3 | 导出当前分支；`build`、`test`、`check` 通过 | 已验收 |
| T-14-1 | 14 | `buildSystemPrompt`：工具列表、指南、追加片段、项目规则、技能索引；技能索引格式化归位到 `skills.ts` | `packages/harness/src/prompt/system-prompt.ts`、`packages/harness/src/resources/skills.ts` | T-13-5 | 工具按 snippet 显示、指南条件生成、上下文与技能拼接测试通过 | 已验收 |
| T-14-2 | 14 | 路径工具、来源与诊断类型、`ResourceSettings` 契约 | `packages/harness/src/utils/paths.ts`、`packages/harness/src/resources/{source-info,diagnostics,settings}.ts` | T-14-1 | `~` 与 Unicode 空格解析、来源形状、设置快照测试通过 | 已验收 |
| T-14-3 | 14 | `ResourceResolver`：默认目录、settings 条目、目录展开、启用模式、优先级 | `packages/harness/src/resources/resolver.ts` | T-14-2 | 默认目录发现、项目优先、真实路径去重、排除与 `+/-` 精确匹配、`.agents` 继承、未信任过滤测试通过 | 已验收 |
| T-14-4 | 14 | 技能、命令模板、项目规则按原项目规则加载 | `packages/harness/src/resources/{skills,prompt-templates,context-files}.ts` | T-14-2 | 根目录 `.md`、名称回退、warning 后仍加载、模板静默跳过、worktree 遮盖测试通过 | 已验收 |
| T-14-5 | 14 | `ResourceLoader` 编排：inert 构造、`reload()`、`extendResources()`、`loadExtensions` 接缝、来源标记、override、公共导出与 changelog | `packages/harness/src/resources/loader.ts`、`packages/harness/src/index.ts` | T-14-3、T-14-4 | 构造不装载、全量与增量、项目优先、开关保留追加路径、系统提示发现、扩展路径传递测试通过 | 已验收 |

| T-15-1 | 15 | 估算与文件操作：`estimateTokens`、`estimateContextTokens`、`shouldCompact`、文件清单、消息序列化 | `packages/harness/src/compaction/{types,estimate,utils}.ts` | T-14-5 | 估算、usage 基线、图片折算、文件清单与序列化测试通过 | 已验收 |
| T-15-2 | 15 | 压缩核心：切点、prepare、摘要生成、split turn、`compact` | `packages/harness/src/compaction/compaction.ts` | T-15-1 | 切点边界、split turn、首次/更新摘要、失败拒绝测试通过 | 已验收 |
| T-15-3 | 15 | 分支摘要：收集、预算裁剪、生成 | `packages/harness/src/compaction/branch-summarization.ts` | T-15-1、T-15-2 | 公共祖先收集、预算裁剪、摘要结果测试通过 | 已验收 |
| T-15-4 | 15 | 会话层：`BranchSummaryEntry`、消息转换、上下文重建、`getLatestCompactionEntry`、`branchWithSummary`、`appendCompaction` 扩展 | `packages/harness/src/session/{types,messages,context,manager}.ts` | T-15-2、T-15-3 | 存储、恢复、裁剪与消息转换测试通过 | 已验收 |
| T-15-5 | 15 | 导出、测试与 changelog | `packages/harness/src/index.ts`、`packages/harness/test/compaction/*`、`packages/harness/CHANGELOG.md` | T-15-1..4 | `tsc`、harness 测试通过 | 已验收 |

## 5. 任务模板

新增任务时使用下表，一个任务对应一个可独立验证的增量。

| 任务 ID | 课程 | 目标与范围 | 涉及文件/模块 | 依赖 | 测试与验收 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T-000 | 00 | 示例：建立空仓库骨架 | `package.json`、`tsconfig.base.json` | 无 | `npm run build` 通过 | 待执行 |

任务 ID 规则：`T-<课程编号>-<序号>`，例如 `T-01-1`。

## 6. 历史记录

| 日期 | 事件 |
| --- | --- |
| 2026-10-29 | 创建本文件；当前无已批准任务 |
| 2026-10-29 | 课程 01 B 确认；批准 T-01-1 至 T-01-4 |
| 2026-10-29 | T-01-1 实现完成：`package.json`、`.npmrc`、`package-lock.json`；待用户验收 |
| 2026-10-29 | 用户确认 T-01-1；批准 T-01-5（包级 changelog，无脚本/无门禁） |
| 2026-10-29 | T-01-2 实现完成：TypeScript 与工具链配置；待用户验收 |
| 2026-10-29 | 用户确认 T-01-2；AGENTS 路径与 scope 修正，changelog 增加 Breaking Changes |
| 2026-10-29 | T-01-3 实现完成：五个空包与 workspace 依赖；根 build 改为显式拓扑顺序；待用户验收 |
| 2026-10-29 | 用户确认 T-01-3；T-01-4、T-01-5 实现完成，待用户验收 |
| 2026-10-31 | 课程 01 验收通过；T-01-4、T-01-5 已验收；进入课程 02 A |
| 2026-10-31 | 课程 02 B 确认；批准 T-02-1 至 T-02-4 |
| 2026-10-31 | T-02-1 实现完成：基础类型与内容块；待用户验收 |
| 2026-11-02 | T-02-2 实现完成：消息类型与序列化测试；待用户验收 |
| 2026-11-02 | T-02-3 实现完成：工具、模型、请求容器与不变量测试；待用户验收 |
| 2026-11-02 | T-02-4 实现完成：公共导出、类型测试与 changelog；课程 02 待验收 |
| 2026-11-02 | 课程 02 验收通过；T-02-4 已验收；进入课程 03 |
| 2026-11-03 | 课程 03 A 完成；进入 B 讨论 |
| 2026-11-03 | 课程 03 B 修改完成，十项决策确认；待用户确认 B |
| 2026-11-03 | 用户确认课程 03 B；批准 T-03-1 至 T-03-5 |
| 2026-11-03 | T-03-1 实现完成：`AssistantMessageEvent` 12 个成员，编译与导出通过；待用户验收 |
| 2026-11-03 | 用户确认 T-03-1；T-03-2 实现完成：流式 JSON 解析与测试，引入 `partial-json@0.1.7`；待用户验收 |
| 2026-11-03 | T-03-2 调整：解析回退改为三步（`JSON.parse` → 修复后部分解析 → `{}`），去掉无效的原文部分解析；测试 25 项通过，仍待用户验收 |
| 2026-11-03 | 用户确认 T-03-2；T-03-3 实现完成：`FifoQueue`、`EventStream`、`AssistantMessageEventStream`，11 项测试；待用户验收 |
| 2026-11-03 | 用户确认 T-03-3；T-03-4 实现完成：`lazyStream` 与 5 项测试；待用户验收 |
| 2026-11-04 | 用户确认 T-03-4；T-03-5 实现完成：公共导出、changelog、公共 API 测试；build/test/check 通过；待用户验收 |
| 2026-11-04 | 用户验收 T-03-5；课程 03 完成 |
| 2026-11-05 | 决策变更：deferred response 舍弃；批准 T-02-5 |
| 2026-11-05 | T-02-5 实现完成：移除 deferred 类型与测试；build、test、check 通过；待用户验收 |
| 2026-11-05 | 用户验收 T-02-5；课程 02 的 deferred 清理完成 |
| 2026-11-05 | 建立统一决策表；课程 00–04、LEARNING_PLAN、SOURCE_COVERAGE 的决策合并去重 |
| 2026-11-05 | SOURCE_COVERAGE 重构为 0–7 节，保留逐文件状态与测试附录 |
| 2026-11-06 | 课程 04 B 确认；批准 T-04-1 至 T-04-6；lazyApi 改到课程 05 |
| 2026-11-06 | T-04-1 至 T-04-6 实现完成；build、test、check 通过；待用户验收 |
| 2026-11-06 | 用户验收 T-04-1 至 T-04-6；课程 04 完成 |
| 2026-11-08 | 课程 05 A 完成；B 确认：原生 `fetch` + SSE、OpenAI + DeepSeek、function 工具、两种思考字段、核心重试；批准 T-05-1 至 T-05-6 |
| 2026-11-08 | T-05-1 实现完成：context 估算与 `simple-options`；build、test、check 通过；待用户验收 |
| 2026-11-08 | 用户验收 T-05-1；T-05-2 实现完成：消息与工具转换，30 项测试；build、test、check 通过；待用户验收 |
| 2026-11-10 | 用户验收 T-05-2；T-05-3 实现完成：请求构造与 SSE 解析，17 项测试；build、test、check 通过；待用户验收 |
| 2026-11-11 | 用户验收 T-05-3；T-05-4 实现完成：tool call 累积、usage 与 stopReason，9 项测试；build、test、check 通过；待用户验收 |
| 2026-11-12 | 用户验收 T-05-4；T-05-5 实现完成：重试、错误归一化、超时与 `lazyApi`，20 项测试；build、test、check 通过；待用户验收 |
| 2026-11-13 | 用户确认 D-027、D-035 转为生效；T-05-5 已验收；T-05-6 实现完成：provider 工厂与导出，6 项测试；build、test、check 通过；待用户验收 |
| 2026-11-13 | 更正：上一条验收记录对应 T-05-5；T-05-6 仍待用户验收，课程 05 尚未完成 |
| 2026-11-13 | 用户验收 T-05-6；课程 05 完成；课程 06 文档已生成 |
| 2026-11-13 | 用户决定暂缓课程 06，先生成并学习课程 07 文档 |
| 2026-11-13 | 课程 07 A、B 完成；用户确认 B；批准 T-07-1 至 T-07-4 |
| 2026-11-13 | T-07-1 实现完成：`FileCredentialStore` 与 11 项测试；build、test、check 通过；待用户验收 |
| 2026-11-14 | 用户验收 T-07-1；T-07-2 实现完成：`ApiKeyAuth.login`、`Models.login/logout`，8 项测试；build、test、check 通过；待用户验收 |
| 2026-11-14 | 用户验收 T-07-2；T-07-3、T-07-4 实现完成：`checkAuth`、错误包装与测试，8 项测试；build、test、check 通过；待用户验收 |
| 2026-11-18 | 用户验收 T-07-3、T-07-4，课程 07 完成；用户决定跳过课程 08，D-013 更新为“图像生成不实现”；课程 09 A 生成 |
| 2026-11-18 | 用户确认课程 09 B；D-047（streamFn 必传，不设全局默认）与 D-048（完整复现循环与事件）生效；批准 T-09-1 至 T-09-5 |
| 2026-11-18 | T-09-1 至 T-09-5 实现完成：循环、事件、工具批次与 13 项测试；build、test、check 通过；待用户验收 |
| 2026-11-20 | 用户验收 T-09-1 至 T-09-5，课程 09 完成 |
| 2026-11-22 | 用户确认课程 10 B；D-049（不实现 streamProxy）、D-050（按原项目实现）生效；批准 T-10-1 至 T-10-5 |
| 2026-11-22 | T-10-1 实现完成：`AgentState`、`PendingMessageQueue` 与 7 项测试；check、test 通过；待用户验收 |
| 2026-11-22 | 用户验收 T-10-1 |
| 2026-11-22 | T-10-2 实现完成：`Agent` 生命周期、队列 API 与 15 项测试；check、test 通过；待用户验收 |
| 2026-11-22 | D-051 生效：`continue` 不预取 steering，删除 `skipInitialSteeringPoll`；补 2 项测试，agent 38 项通过 |
| 2026-11-22 | 用户验收 T-10-2；`AgentState.isStreaming` 重命名为 `isRunning`；`Agent.runPromptMessages` 重命名为 `runAgent` |
| 2026-11-22 | T-10-3 实现完成：事件归约与 `subscribe`，新增 8 项测试；check、test 通过；待用户验收 |
| 2026-11-23 | T-10-4 实现完成：钩子接线、请求级选项与失败收尾，新增 6 项测试；check、test 通过；待用户验收 |
| 2026-11-23 | D-052 生效：`QueueMode` 的 `one-at-a-time` 改名为 `single` |
| 2026-11-23 | T-10-5 实现完成：公共入口测试与导出核对；build、test、check 通过；待用户验收 |
| 2026-11-23 | 用户验收 T-10-1 至 T-10-5，课程 10 完成 |
| 2026-11-23 | 用户确认课程 11 B：三项决策落定（只走 TypeBox、错误信息含原始参数、validator 用 `WeakMap` 按 schema 缓存）；D-053 生效，批准 T-11-1 至 T-11-4 |
| 2026-11-23 | T-11-1 实现完成：`validateToolArguments` 与可选 null 清理，新增 8 项测试；check、test 通过；待用户验收 |
| 2026-11-23 | T-11-2 实现完成：`validateToolCall` 与公共导出，缓存行为测试；llm 测试 11 项 |
| 2026-11-23 | T-11-3 实现完成：`prepareToolCall` 接入校验，新增 4 项循环测试；agent 测试改用 TypeBox schema |
| 2026-11-23 | T-11-4 实现完成：公共入口导出校验函数，llm 与 agent changelog 更新；build、test、check 通过 |
| 2026-11-23 | 用户验收 T-11-1 至 T-11-4，课程 11 完成 |
| 2026-11-24 | 用户确认课程 12 B：八个工具全做、图片按原项目、搜索与编辑跟随原项目、截断与队列纳入本课、注入 `PI_*`（2026-11-26 改名 `PIPI_*`）；D-054 至 D-058 生效，批准 T-12-1 至 T-12-13 |
| 2026-11-24 | T-12-1 实现完成：`truncate` 与 `output-accumulator`，新增 18 项测试；待用户验收 |
| 2026-11-24 | D-059 生效：截断函数改名为 `truncateKeepHead` / `truncateKeepTail` |
| 2026-11-24 | D-060 生效：删除截断循环后的兜底赋值，修正 `truncatedBy` 误标；补回归测试 |
| 2026-11-24 | D-061、D-062 生效：课程 12 改为按工具完整交付，图片缩放同步执行 |
| 2026-11-24 | T-12-2 实现完成：`read`、路径解析、图像管线；harness 测试 31 项通过；待用户验收 |
| 2026-11-24 | D-063 生效：工具提示文案改为内联，删除 `readToolSystemPromptContribution` |
| 2026-11-24 | D-064 至 D-067 生效：编辑模糊匹配范围、命令执行依赖、工具目录分层、下载器简化 |
| 2026-11-24 | T-12-3 至 T-12-10 实现完成：write、edit、ls、bash、powershell、grep、find 与注册表；harness 10 个文件 60 项测试通过；待用户验收 |
| 2026-11-24 | 用户验收 T-12-1 至 T-12-10，课程 12 完成 |
| 2026-11-25 | D-068 生效：取消课程 13，后续课程编号前移一位（14–25 → 13–24） |
| 2026-11-25 | 用户确认课程 13 B：扩展条目本课实现（D-069），分支摘要后置（D-070）；批准 T-13-1 至 T-13-5 |
| 2026-11-25 | D-071 生效：删除会话版本字段与迁移函数，只保留当前格式 |
| 2026-11-25 | T-13-1 实现完成：会话条目类型、JSONL 读写、延迟落盘；新增 8 项测试；待用户验收 |
| 2026-11-25 | T-13-2 实现完成：路径上溯、压缩裁剪、上下文重建、`convertToLlm`；新增 6 项测试；待用户验收 |
| 2026-11-25 | T-13-3 实现完成：`branch`、`resetLeaf`、`createBranchedSession`；新增 3 项测试 |
| 2026-11-25 | T-13-4、T-13-5 实现完成：会话发现、最近会话恢复、JSONL 导出；harness 14 文件 81 项通过；待用户验收 |
| 2026-11-25 | 课程 13 补漏：会话名称清洗与解析（`resolveSessionName`、`getSessionName`、列表统一读取）；harness 84 项通过 |
| 2026-11-25 | 用户验收 T-13-1 至 T-13-5，课程 13 完成 |
| 2026-11-26 | T-14-1 实现完成：系统提示拼装与技能索引格式化，新增 11 项测试；待用户验收 |
| 2026-11-26 | T-14-2 实现完成：项目规则加载（候选优先级、向上继承、去重），新增 7 项测试；待用户验收 |
| 2026-11-26 | D-073 生效：配置目录统一到 `~/.pipi` / `.pipi` |
| 2026-11-26 | T-14-3 至 T-14-5 实现完成：技能加载、命令模板、资源加载器；harness 19 文件 121 项通过；待用户验收 |
| 2026-11-26 | 修正：补回 loader 的 override 钩子、来源记录、`extendResources`、异步 reload；技能补回 ignore 文件、符号链接、任意 `.md` 入口、冲突双方路径与 `sourceInfo`；模板补回 `sourceInfo`；上下文补回 worktree 遮盖检测。目录调整为 `resources/`（装载）与 `prompt/`（拼装） |
| 2026-11-26 | 目录按原项目逻辑：`prompt/`、`resources/`、`session/`、`tools/` 平铺在 `src/` 下，通用工具与图像放 `utils/`；配置根改为 `~/.pipi/agent` |
| 2026-11-26 | D-075 生效：prompt 模块参数 `cwd` 改名为 `projectDir` |
| 2026-11-26 | D-082 至 D-085 生效：摘要调用沿用 `StreamFn`，重试放在 llm，`appendCompaction` 补齐参数，分支摘要导航后置；批准 T-15-1 至 T-15-5 |
| 2026-11-26 | 用户验收 T-15-1 至 T-15-5，课程 15 完成 |
| 2026-11-26 | T-15-1 至 T-15-5 实现完成：compaction 模块、分支摘要、会话条目与 llm 重试；harness 24 文件 177 项、llm 22 文件 207 项通过；待用户验收 |
| 2026-11-26 | D-076 至 D-080 生效：资源加载改为 resolver + loader 两层；resolver 负责路径，loader 负责装载；课程 14 暂不实现文档路径段；项目规则独立成文件 |
| 2026-11-26 | D-058 变更：`PI_*` 环境变量改为 `PIPI_*`；D-081 生效，扩展清单改为 `pipi.extensions`，技能发现模式改为 `pipi`，资源作用域 `user` 改为 `agent` |
| 2026-11-26 | 用户验收 T-14-1 至 T-14-5，课程 14 完成 |
| 2026-11-26 | T-14-1 至 T-14-5 重写完成：新增 `utils/paths.ts`、`resources/{settings,source-info,resolver,ignore}.ts`；loader 改为 inert 构造 + `reload()`；技能、模板、项目规则对齐原项目；新增 `minimatch@10.2.5`；harness 20 文件 147 项通过；待用户验收 |

## 7. 最终验收目标

项目完成时应满足：

- 用户通过课程逐步理解原项目的核心设计和实现。
- 每门课程都经过 A 学习、交互讨论、B 确认、编码测试和用户验收。
- 新项目的实现与确认后的课程方案一致，关键行为有相应测试。
- `SOURCE_COVERAGE.md` 能够说明原项目各项重要内容最终如何处理，避免模块、功能、测试或工程设施遗漏。
- `LEARNING_PLAN.md` 与实际学习进度一致。
- `BUILD_PLAN.md` 与实际代码、测试和验收状态一致。
- 代码改动有对应的包级 changelog 条目，提交与推送记录可追溯。
- 决策表无重复、无矛盾；`待xxx时生效` 的决策到期时已提醒并处理。
- 项目具有独立、可持续维护的代码结构和 Git 历史。
- 整个过程由用户逐课推进和验收，而不是由 Agent 一次性生成全部代码后再让用户检查。
