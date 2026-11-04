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

## 3. 当前已批准任务

课程 01、02 已完成。课程 03 的 B 阶段已确认，以下任务按顺序执行，前一项验收通过后再开始下一项。

| 任务 ID | 课程 | 目标与范围 | 涉及文件/模块 | 依赖 | 测试与验收 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T-01-1 | 01 | 建立根工作区与依赖：npm workspaces、Node 版本、根脚本、精确版本安装 | `package.json`、`.npmrc`、`.gitignore`、`package-lock.json` | 无 | `npm ci --ignore-scripts` 成功；`npm pkg get workspaces` 返回 `packages/*`；`tsc`、`vitest`、`biome` 版本可用 | 已验收 |
| T-01-2 | 01 | 配置 TypeScript 与工具链：共享编译选项、路径别名、格式规则、测试别名 | `tsconfig.base.json`、`tsconfig.json`、`biome.json`、`vitest.base.ts` | T-01-1 | `npx tsc --showConfig` 成功；`vitest.base.ts` 可被 Node 加载；`biome check biome.json` 通过；`paths` 覆盖五个包；格式检查在 T-01-4 全量执行 | 已验收 |
| T-01-3 | 01 | 创建五个空包：`llm`、`agent`、`tui`、`harness`、`eval`，建立单向依赖与构建配置 | `packages/*/package.json`、`packages/*/tsconfig.build.json`、`packages/*/vitest.config.ts`、`packages/*/src/index.ts` | T-01-2 | 每包 `npm run build -w @pipi/<pkg>` 生成 `dist/index.js` 与 `.d.ts`；`node -e "import('@pipi/llm')"` 可解析；`harness` 依赖 `llm`、`agent`、`tui`，`eval` 依赖 `harness` | 已验收 |
| T-01-4 | 01 | 建立 smoke 测试与基线验证：每包可导入、全量构建、类型检查、测试通过 | `packages/*/test/smoke.test.ts`、根脚本 | T-01-3 | `npm run build`、`npm test`、`npx tsc --noEmit`、`npx biome check .` 全部通过；测试不写用户目录，需要临时目录时使用 `os.tmpdir()` | 已验收 |
| T-01-5 | 01 | 建立变更记录：五个包各一份 CHANGELOG，写入维护规则 | `packages/*/CHANGELOG.md`、`AGENTS.md` | T-01-3 | 五份 changelog 存在，含 `[Unreleased]` 与五个分节（含 `Breaking Changes`）；AGENTS 规则与提交规范可执行 | 已验收 |
| T-02-1 | 02 | 定义基础类型与内容块：API/Provider 标识、文本/思考/图片/工具调用、延期句柄 | `packages/llm/src/types.ts` | T-01-4 | `tsc --noEmit` 通过；类型可被 `index.ts` 导出；不引入运行时依赖 | 已验收 |
| T-02-2 | 02 | 定义消息：用户、助手、工具结果与 `Message` 联合 | `packages/llm/src/types.ts` | T-02-1 | 类型构造与 JSON 序列化测试通过 | 已验收 |
| T-02-3 | 02 | 定义工具、模型、用量与请求容器：`Tool`、`Model`、`Usage`、`Context`、`StreamOptions` | `packages/llm/src/types.ts` | T-02-2 | `totalTokens` 计算、`reasoning <= output`、工具结果配对测试通过 | 已验收 |
| T-02-4 | 02 | 公共导出与测试：导出类型，补齐类型测试与 changelog | `packages/llm/src/index.ts`、`packages/llm/test/types.test.ts`、`packages/llm/CHANGELOG.md` | T-02-3 | `npm run build`、`npm test`、`tsc --noEmit`、`biome check .` 通过；changelog 有 Added 条目 | 已验收 |
| T-03-1 | 03 | 新增流式事件联合：块事件、完成事件与错误事件 | `packages/llm/src/types.ts`、`packages/llm/src/index.ts` | T-02-4 | `tsc --noEmit` 通过；12 个事件成员齐全；可由公共入口导出 | 已验收 |
| T-03-2 | 03 | 实现流式 JSON 解析：`repairJson`、`parseJsonWithRepair`、`parseStreamingJson` | `packages/llm/src/utils/json-parse.ts`、`packages/llm/package.json` | T-03-1 | 四种残缺形态均返回对象且不抛异常；`partial-json` 固定为 `0.1.7` | 已验收 |
| T-03-3 | 03 | 实现事件流：`FifoQueue`、`EventStream`、`AssistantMessageEventStream` | `packages/llm/src/utils/event-stream.ts` | T-03-1 | 顺序、结束、结果提取、完成后 `push` 忽略；双消费者行为符合 4.3 | 已验收 |
| T-03-4 | 03 | 实现延迟初始化：`lazyStream` | `packages/llm/src/api/lazy.ts` | T-03-3 | 成功时转发事件并传递结果；setup 失败只产生一个 `error` 事件 | 已验收 |
| T-03-5 | 03 | 公共导出、changelog 与全量验证 | `packages/llm/src/index.ts`、`packages/llm/CHANGELOG.md`、`packages/llm/test/public-api.test.ts` | T-03-4 | `npm run build`、`npm test`、`tsc --noEmit`、`biome check .` 通过；changelog 有 Added 条目 | 已验收 |

## 4. 任务模板

新增任务时使用下表，一个任务对应一个可独立验证的增量。

| 任务 ID | 课程 | 目标与范围 | 涉及文件/模块 | 依赖 | 测试与验收 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T-000 | 00 | 示例：建立空仓库骨架 | `package.json`、`tsconfig.base.json` | 无 | `npm run build` 通过 | 待执行 |

任务 ID 规则：`T-<课程编号>-<序号>`，例如 `T-01-1`。

## 5. 历史记录

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

## 6. 最终验收目标

项目完成时应满足：

- 用户通过课程逐步理解原项目的核心设计和实现。
- 每门课程都经过 A 学习、交互讨论、B 确认、编码测试和用户验收。
- 新项目的实现与确认后的课程方案一致，关键行为有相应测试。
- `SOURCE_COVERAGE.md` 能够说明原项目各项重要内容最终如何处理，避免模块、功能、测试或工程设施遗漏。
- `LEARNING_PLAN.md` 与实际学习进度一致。
- `BUILD_PLAN.md` 与实际代码、测试和验收状态一致。
- 代码改动有对应的包级 changelog 条目，提交与推送记录可追溯。
- 项目具有独立、可持续维护的代码结构和 Git 历史。
- 整个过程由用户逐课推进和验收，而不是由 Agent 一次性生成全部代码后再让用户检查。
