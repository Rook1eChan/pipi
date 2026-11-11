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
| D-004 | 课程拆分为 00–25 | 26 门课程，按构建顺序组织；课程编号与文件名前缀一致 | 生效 | 2026-10-29 |
| D-005 | 课程 00 不产出代码 | 只确定仓库级约定；配置与代码在课程 01 落地 | 生效 | 2026-10-29 |
| D-006 | pipi 使用独立 Public 仓库 | `pipi/` 独立 Git 历史与 GitHub Public 仓库；`my-pi/` 只读 | 生效 | 2026-10-29 |
| D-007 | 引入 Biome | 格式化与 lint 使用 Biome；不引入第二套格式化工具 | 生效 | 2026-10-29 |
| D-008 | TypeScript 使用 NodeNext 单配置 | 不使用原项目 `Node16` + `NodeNext` 双配置 | 生效 | 2026-10-29 |
| D-009 | 测试隔离先用临时目录 | 测试使用 `os.tmpdir()`，不写用户目录；完整隔离脚本后置到课程 25 | 生效 | 2026-10-29 |
| D-010 | eval 包骨架阶段只建占位包 | 当前只保留空包与 smoke 测试；实现后置到课程 25 | 待课程 25 时生效 | 2026-10-29 |
| D-011 | TUI 整体保留，复现深度后定 | 保留课程 22–24；全屏、鼠标、图片、latex 等深度在课程 22 学习时确定 | 待课程 22 时生效 | 2026-10-29 |
| D-012 | tui/native 后置或简化 | 原生剪贴板、平台能力、原生图片能力后置或简化 | 待课程 22 时生效 | 2026-10-29 |
| D-013 | 图像生成后置 | 先做图像输入；图像生成放到课程 08 | 待课程 08 时生效 | 2026-10-29 |
| D-014 | 剪贴板图片与终端图像后置 | 剪贴板图片、终端图片渲染后置到课程 24 | 待课程 24 时生效 | 2026-10-29 |
| D-015 | evals/SWE-bench 仅了解 | 只做 smoke 与 faux 集成测试，不复现 SWE-bench | 待课程 25 时生效 | 2026-10-29 |
| D-016 | Bun 运行时适配仅了解 | 不影响 Node 运行与主要功能 | 待课程 25 时生效 | 2026-10-29 |
| D-017 | 会话导出 vendor 最小实现 | 使用最小实现或轻量依赖，不复现完整 vendor | 待课程 24 时生效 | 2026-10-29 |
| D-018 | Provider 范围限定三类 | 只构建 OpenAI、Anthropic、DeepSeek 系列，加 faux 测试 provider | 生效 | 2026-10-31 |
| D-019 | 认证只支持 API key，OAuth 后置 | 当前只保留 `ApiKeyCredential`；OAuth 类型、登录、刷新不实现，课程 07 复审是否恢复 | 待课程 07 时生效 | 2026-11-05 |
| D-020 | 不实现 deferred response | 删除 `DeferredHandle`、`deferred` 字段与 `stopReason: "deferred"`；仅在课程中保留说明 | 生效 | 2026-11-05 |
| D-021 | deferred tools 不做改动 | 保留原项目设计，课程 05/06 再决定是否实现 | 生效 | 2026-11-05 |
| D-022 | 模型目录只保留最小条目 | 不复现全量 provider 数据与生成脚本；每个 provider 先保留 1–2 个模型 | 生效 | 2026-10-29 |
| D-023 | compat 只做最小子集 | 先实现 OpenAI Completions 需要的兼容字段；05/06 按需增补 | 生效 | 2026-10-31 |
| D-024 | 课程 02 只做类型与测试 | 工具参数校验归 11，跨 provider 归一化归 06，事件归 03 | 生效 | 2026-10-31 |
| D-025 | 事件类型放在 types.ts | 事件依赖消息类型，同文件避免循环导入 | 生效 | 2026-11-03 |
| D-026 | 引入 partial-json 0.1.7 | 流式 JSON 前缀补全使用该依赖，不自行实现 | 生效 | 2026-11-03 |
| D-027 | lazyApi 后置到课程 05 | 课程 03 只实现 `lazyStream`；04 没有真实适配器，05 实现适配器后再加 `lazyApi` | 待课程 05 时生效 | 2026-11-06 |
| D-028 | 不提供事件序列校验器 | 与原项目一致；适配器正确性由测试断言 | 生效 | 2026-11-03 |
| D-029 | 中止测试手工 push aborted | 真实 AbortSignal 接线放到课程 05 | 生效 | 2026-11-03 |
| D-030 | 解析回退改为三步 | 直接解析 → 修复后解析 → partial-json；测试固定新顺序 | 生效 | 2026-11-03 |
| D-031 | 思考事件保留 | 协议包含 `thinking_*` | 生效 | 2026-11-03 |
| D-032 | lazyStream 原样实现 | 初始化失败也进入流协议 | 生效 | 2026-11-03 |
| D-033 | 采用包级 CHANGELOG | 每包一份 `packages/<pkg>/CHANGELOG.md`；只在 `[Unreleased]` 下追加；不加脚本、hook 或 CI 门禁 | 生效 | 2026-10-29 |
| D-034 | 04 只做注册表与目录 | 04 实现 Provider/Models、`createProvider`、`ModelsStore`、模型目录与 faux；不绑定真实适配器 | 生效 | 2026-11-06 |
| D-035 | 真实 provider 工厂后置到 05/06 | 04 不创建真实 provider 工厂；05/06 实现适配器后再绑定 `api` | 待课程 05 时生效 | 2026-11-06 |
| D-036 | 动态刷新远端实现后置到 19 | 04 实现接口与内存 store；远端拉取在 19 接入 | 待课程 19 时生效 | 2026-11-06 |
| D-037 | `createProvider` 原样实现 | 支持单一 API、API 映射、静态模型 + 动态覆盖 | 生效 | 2026-11-06 |
| D-038 | 05 使用原生 `fetch` + SSE | 不引入 `openai` SDK；自己实现 HTTP 请求、SSE 分帧与错误体解析 | 生效 | 2026-11-08 |
| D-039 | 05 的 provider 范围 | 实现 OpenAI 与 DeepSeek 两个工厂，共用 `openai-completions` adapter；`lazyApi` 包装 | 生效 | 2026-11-08 |
| D-040 | 工具只做 function + strict | 语法约束工具（`custom` + grammar）后置 | 生效 | 2026-11-08 |
| D-041 | 思考字段只做两种 | 支持 `reasoning_content` 与 `reasoning`；`reasoning_details` 结构化回放后置 | 生效 | 2026-11-08 |
| D-042 | 重试只做核心策略 | 429、5xx、网络错误重试；遵守 `Retry-After` 与 `maxRetryDelayMs` | 生效 | 2026-11-08 |
| D-043 | maxTokens 收窄按原项目 | 实现 `estimateContextTokens` 与 `clampMaxTokensToContext`；思考预算按 `adjustMaxTokensForThinking` | 生效 | 2026-11-08 |
| D-044 | 请求钩子按原项目实现 | `onPayload` 发送前可替换请求体；`onResponse` 在消费 body 前调用 | 生效 | 2026-11-08 |

维护规则：

- 写入前通读全表，按决策对象查重；重复的合并，矛盾的先说明再处理，不静默覆盖。
- 状态只取 `生效` 或 `待xxx时生效`；`xxx` 必须是可判定的课程编号、日期或明确条件。
- 每次开始课程、每次修改本表时扫描 `待xxx时生效` 的条目；到期在对话中提醒，不自行转为生效。
- 决策变更时直接更新原行并保留 ID，在历史记录中写明变更；不新增重复行。

## 4. 当前已批准任务

课程 01–04 已完成，T-05-1 至 T-05-3 已验收，T-05-4 已实现待验收，T-05-5、T-05-6 待执行。以下任务按顺序执行，前一项验收通过后再开始下一项。

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
| T-05-4 | 05 | tool call 累积、usage、`stopReason`、`done` / `error` | `packages/llm/src/api/openai-completions.ts` | T-05-3 | 分片参数还原；usage 与终止原因正确 | 待用户验收 |
| T-05-5 | 05 | 重试、错误归一化、中止与 `lazyApi` | `packages/llm/src/utils/retry.ts`、`packages/llm/src/api/lazy.ts` | T-05-4 | 429/5xx 重试；中止产生 `aborted`；错误进入流 | 待执行 |
| T-05-6 | 05 | OpenAI / DeepSeek provider 工厂、导出、测试与 changelog | `packages/llm/src/providers/*`、`packages/llm/test/*`、`packages/llm/CHANGELOG.md` | T-05-5 | `build`、`test`、`check` 通过 | 待执行 |

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
