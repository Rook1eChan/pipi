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

课程 01 的 B 阶段已由用户确认，以下任务获准执行。任务按顺序实现，前一项验收通过后再开始下一项。

| 任务 ID | 课程 | 目标与范围 | 涉及文件/模块 | 依赖 | 测试与验收 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| T-01-1 | 01 | 建立根工作区与依赖：npm workspaces、Node 版本、根脚本、精确版本安装 | `package.json`、`.npmrc`、`.gitignore`、`package-lock.json` | 无 | `npm ci --ignore-scripts` 成功；`npm pkg get workspaces` 返回 `packages/*`；`tsc`、`vitest`、`biome` 版本可用 | 已验收 |
| T-01-2 | 01 | 配置 TypeScript 与工具链：共享编译选项、路径别名、格式规则、测试别名 | `tsconfig.base.json`、`tsconfig.json`、`biome.json`、`vitest.base.ts` | T-01-1 | `npx tsc --showConfig` 成功；`vitest.base.ts` 可被 Node 加载；`biome check biome.json` 通过；`paths` 覆盖五个包；格式检查在 T-01-4 全量执行 | 已验收 |
| T-01-3 | 01 | 创建五个空包：`llm`、`agent`、`tui`、`harness`、`eval`，建立单向依赖与构建配置 | `packages/*/package.json`、`packages/*/tsconfig.build.json`、`packages/*/vitest.config.ts`、`packages/*/src/index.ts` | T-01-2 | 每包 `npm run build -w @pipi/<pkg>` 生成 `dist/index.js` 与 `.d.ts`；`node -e "import('@pipi/llm')"` 可解析；`harness` 依赖 `llm`、`agent`、`tui`，`eval` 依赖 `harness` | 已验收 |
| T-01-4 | 01 | 建立 smoke 测试与基线验证：每包可导入、全量构建、类型检查、测试通过 | `packages/*/test/smoke.test.ts`、根脚本 | T-01-3 | `npm run build`、`npm test`、`npx tsc --noEmit`、`npx biome check .` 全部通过；测试不写用户目录，需要临时目录时使用 `os.tmpdir()` | 已验收 |
| T-01-5 | 01 | 建立变更记录：五个包各一份 CHANGELOG，写入维护规则 | `packages/*/CHANGELOG.md`、`AGENTS.md` | T-01-3 | 五份 changelog 存在，含 `[Unreleased]` 与五个分节（含 `Breaking Changes`）；AGENTS 规则与提交规范可执行 | 已验收 |

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
