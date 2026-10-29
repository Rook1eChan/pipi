# 课程大纲与学习进度（LEARNING_PLAN）

本文件是课程顺序、依赖与学习进度的唯一总表。课程内容在 `NN-*.md` 中，构建任务在 `BUILD_PLAN.md` 中。

## 1. 组织原则

课程按"从最小可运行系统到完整产品"的构建顺序组织，不照搬 `my-pi/` 的目录结构。

- 先建立必要的基础能力，再叠加依赖它的上层功能
- 一个原项目模块可以跨多门课程；一门课程可以覆盖多个模块
- 每门课程包含 A 阶段（概念）、讨论记录、B 阶段（实现规划）
- 不提前生成全部课程的详细实现方案；后续课程在学到时再展开 B
- 课程完成与否以用户确认为准

## 2. 课程总表

状态取值：`待学习 / A 学习中 / A 已完成 / B 待确认 / B 已确认 / 实现中 / 待用户验收 / 验收通过`。
`文档` 列表示课程 Markdown 是否已生成，与学习状态分开记录。

| 编号 | 课程 | 学习目标与核心问题 | 系统能力 | 原项目覆盖 | 前置 | 课程文件 | 文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 00 | 项目全景与构建地图 | 一个编码 Agent 由哪些能力组成？为什么按这个顺序构建？ | 全局认知 | 五包导航、入口、调用链、依赖方向 | 无 | `00-project-overview.md` | 已生成 | 验收通过 |
| 01 | 工程基座 | 如何建立可编译、可测试、可发布的 monorepo？ | 工程骨架 | 根配置、构建脚本、测试设施、包边界 | 00 | `01-engineering-base.md` | 已生成 | 待用户验收 |
| 02 | 核心类型层 | 如何用一套类型覆盖多个 provider 与多种消息？ | 统一数据模型 | `ai/src/types.ts`、公共导出面 | 01 | `02-core-types.md` | 已生成 | 待学习 |
| 03 | 流式响应协议 | 如何表达增量文本、工具参数、错误与中止？ | 事件流 | `event-stream.ts`、`json-parse.ts`、`lazy.ts` | 02 | `03-streaming-protocol.md` | 已生成 | 待学习 |
| 04 | Provider 注册表与模型目录 | 如何登记 provider、查找模型并分发请求？ | 注册与分发 | `ai/src/models.ts`、`providers/*`、`models-store.ts` | 03 | `04-provider-registry.md` | 未生成 | 待学习 |
| 05 | 第一个 API 适配器（OpenAI 兼容） | 如何把一次真实请求映射成统一事件流？ | 模型接入 | `api/openai-completions.ts`、`simple-options.ts` | 04 | `05-openai-adapter.md` | 未生成 | 待学习 |
| 06 | 多 API 家族与请求基础设施 | 如何兼容 Anthropic/Responses/Google/Mistral 并处理重试与归一化？ | 适配器矩阵 | `api/*`、`utils/retry.ts`、`transform-messages.ts` | 05 | `06-api-families.md` | 未生成 | 待学习 |
| 07 | 认证与凭据 | 如何解析、存储、刷新 API key 与 OAuth 凭据？ | 认证 | `ai/src/auth/*`、`oauth.ts`、`coding-agent/src/core/auth-storage.ts` | 04 | `07-auth-and-credentials.md` | 未生成 | 待学习 |
| 08 | 图像输入与生成（可选） | 多模态输入与图像模型如何接入统一类型？ | 图像能力 | `ai/src/images*.ts`、`api/openrouter-images.ts` | 04 | `08-images.md` | 未生成 | 待学习 |
| 09 | Agent 循环与事件协议 | 如何把"调模型 → 执行工具 → 再调模型"组织成循环？ | 循环控制 | `agent/src/agent-loop.ts`、`types.ts` | 05 | `09-agent-loop.md` | 未生成 | 待学习 |
| 10 | Agent 状态机与消息队列 | 状态、steering/followUp 队列、中止与继续如何管理？ | 有状态 Agent | `agent/src/agent.ts`、`proxy.ts` | 09 | `10-agent-state.md` | 未生成 | 待学习 |
| 11 | 工具执行语义 | 串行/并行、参数校验、前后钩子、结果回填如何工作？ | 工具执行 | `agent-loop.ts` 工具段、`ai/src/utils/validation.ts` | 09 | `11-tool-execution.md` | 未生成 | 待学习 |
| 12 | 内置工具 | 如何安全地读写文件、搜索代码、执行命令？ | 动手能力 | `coding-agent/src/core/tools/*`、`bash-executor.ts` | 11 | `12-builtin-tools.md` | 未生成 | 待学习 |
| 13 | 工具输出治理与安全 | 如何截断输出、串行化写入、约束路径、生成 diff？ | 输出治理 | `truncate.ts`、`output-accumulator.ts`、`edit-diff.ts`、`file-mutation-queue.ts`、`path-utils.ts` | 12 | `13-tool-output-safety.md` | 未生成 | 待学习 |
| 14 | 会话持久化与分支 | JSONL 会话、消息树、分支切换、上下文重建如何实现？ | 会话存储 | `session-manager.ts`、`messages.ts`、`session-export.ts` | 10 | `14-session-persistence.md` | 未生成 | 待学习 |
| 15 | 提示、上下文与技能 | 系统提示、AGENTS.md、技能、提示模板如何装载？ | 上下文构造 | `system-prompt.ts`、`resource-loader.ts`、`skills.ts`、`prompt-templates.ts` | 14 | `15-prompts-context-skills.md` | 未生成 | 待学习 |
| 16 | 上下文压缩与分支摘要 | 超出上下文窗口时如何压缩并保持可继续？ | 长会话 | `core/compaction/*`、`ai/src/utils/estimate.ts` | 15 | `16-compaction.md` | 未生成 | 待学习 |
| 17 | CLI、配置与项目信任 | 参数、设置分层、项目信任、首次启动如何组织？ | 启动与配置 | `cli/*`、`main.ts`、`config.ts`、`settings-manager.ts`、`trust-manager.ts` | 14 | `17-cli-config-trust.md` | 未生成 | 待学习 |
| 18 | AgentSession 编排 | 如何把 Agent、会话、工具、扩展、压缩串成产品级会话？ | 会话编排 | `agent-session.ts`、`agent-session-runtime.ts`、`sdk.ts` | 16, 17 | `18-agent-session.md` | 未生成 | 待学习 |
| 19 | 模型运行时与解析 | 模型选择、动态目录、自定义 provider、本地模型如何工作？ | 模型运行时 | `core/model-*.ts`、`provider-composer.ts`、`extensions/llama/*` | 17 | `19-model-runtime.md` | 未生成 | 待学习 |
| 20 | 运行模式 | print、JSON 事件流、RPC 三种非交互模式如何实现？ | 集成接口 | `modes/print-mode.ts`、`json-event.ts`、`modes/rpc/*` | 18 | `20-run-modes.md` | 未生成 | 待学习 |
| 21 | 扩展系统与包管理 | 扩展如何加载、执行、挂 UI 钩子？pi 包如何安装？ | 扩展生态 | `core/extensions/*`、`package-manager.ts`、`pi-manifest.ts` | 18 | `21-extensions-packages.md` | 未生成 | 待学习 |
| 22 | 终端与渲染内核 | 终端能力、布局、帧差分、输入解析如何实现？ | TUI 基础 | `tui/src/tui.ts`、`layout.ts`、`terminal.ts`、`keys.ts` | 01 | `22-tui-core.md` | 未生成 | 待学习 |
| 23 | 组件与编辑器 | 文本、输入、列表、编辑器、markdown 如何组合？ | TUI 组件 | `tui/src/components/*`、`editor-component.ts` | 22 | `23-tui-components.md` | 未生成 | 待学习 |
| 24 | 交互模式 | 聊天视口、工具渲染、主题、选择器、快捷键如何组织？ | 交互体验 | `modes/interactive/*`、`core/keybindings.ts` | 21, 23 | `24-interactive-mode.md` | 未生成 | 待学习 |
| 25 | 构建、发布与评测 | 打包、原生模块、CI、模型代码生成、evals 如何运作？ | 工程设施 | `scripts/*`、`packages/evals/*`、workflows、native | 全部 | `25-build-release-evals.md` | 未生成 | 待学习 |

## 3. 学习进度

| 项 | 状态 |
| --- | --- |
| 当前课程 | 01 工程基座 |
| 已完成课程 | 00（约定类，无代码） |
| 已完成 A 的课程 | 00、01 |
| 已确认 B 的课程 | 00、01 |
| 已生成文档 | 00–03 |
| 已实现课程 | 无 |
| 当前阶段 | 课程 01 待用户验收（T-01-4、T-01-5 待确认） |

## 4. 已确认的项目级约定

以下约定已由用户确认，后续课程直接遵循；如需变更，按"提出影响 → 确认 → 修订课程与构建计划"的流程处理。

| 约定 | 内容 |
| --- | --- |
| 课程粒度 | 26 门细粒度课程（00–25） |
| 首批文档 | 00–03 |
| 工程形态 | npm workspaces monorepo；TypeScript + ESM + NodeNext + Vitest + Biome；Node >= 22 |
| 目录结构 | `packages/{llm,agent,tui,harness,eval}` |
| 包名 | `@pipi/{llm,agent,tui,harness,eval}` |
| 仓库 | `pipi` 已是独立 Public GitHub 仓库 |
| TUI 范围 | 纳入课程 22–24，复现深度在课程 22 学习时确定 |
| 原项目 | `my-pi/` 只读，不修改其文件与历史 |

## 5. 简化与后置清单

以下为已由用户确认的简化、后置或仅需了解项。后续课程不得无意扩大该范围；确需扩大时，先说明影响并取得确认。

状态一律为 `已确认`；未确认的简化想法不会写入本表。

| 项目 | 类型 | 范围 | 状态 | 影响课程 | 备注 |
| --- | --- | --- | --- | --- | --- |
| TUI 整体 | 后置 | 保留在课程 22–24；复现深度到课程 22 学习时确定 | 已确认 | 22–24 | 后置不等于已简化 |
| `eval` 包 | 后置 | 骨架阶段只建占位包，实现在课程 25 | 已确认 | 01、25 | |
| `evals` / SWE-bench | 仅了解 | 只做 smoke 与 faux provider 集成测试，不复现 SWE-bench | 已确认 | 25 | |
| `tui/native` 原生模块 | 简化/后置 | 剪贴板、平台能力、原生图片能力后置或简化 | 已确认 | 22、25 | |
| Bun 运行时适配 | 仅了解 | 不影响 Node 运行与主要功能 | 已确认 | 25 | |
| 图像生成、剪贴板图片、终端图像 | 简化 | 先做图像输入；生成、剪贴板图片、终端图片后置 | 已确认 | 08、24 | |
| 模型目录全量生成 | 简化 | 了解生成流程，不复现全量 provider 数据 | 已确认 | 04 | |
| 会话导出 vendor | 简化 | 最小实现或使用轻量依赖 | 已确认 | 24 | |
| 课程 00 的产出 | 边界 | 不产出代码，只确定仓库级约定 | 已确认 | 00、01 | |

新增简化项或调整范围时：

1. 在对应课程中说明原因与影响
2. 取得用户确认
3. 更新本表与 `SOURCE_COVERAGE.md` 的 8.1 节

## 6. 待确认前提索引

这些事项会影响对应课程的设计，在学到该课程时讨论并记录到课程 Markdown，不在此处展开。

| 事项 | 对应课程 |
| --- | --- |
| 许可证 | 01 |
| 首批真实 API 支持范围 | 05、06 |
| 模型目录是否复现代码生成 | 04 |
| OAuth 是否纳入 | 07 |
| 图像输入/生成/剪贴板范围 | 08 |
| 会话格式是否与原项目双向兼容 | 14 |
| TUI 全屏、鼠标、图片、原生模块范围 | 22 |
| 扩展 UI 钩子与包管理范围 | 21 |
| evals 是否纳入、是否保留 SWE-bench | 25 |

## 7. 课程生成规则

- 当前只生成到 03；04 起的课程在学到前不提前写详细 B。
- 每批生成后检查：编号连续、文件名一致、前置依赖已完成或已生成、覆盖范围无遗漏。
- 新增课程或调整顺序时，同步更新本表、`SOURCE_COVERAGE.md` 的课程列与 `BUILD_PLAN.md` 的依赖。
