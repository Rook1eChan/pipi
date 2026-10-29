# 教学路线（LEARNING_ROADMAP）

本路线按照"从最小可运行 Agent 到完整编码助手"的构建顺序组织，不照搬 `my-pi/` 的目录结构。

每个教学模块对应一篇文档，编号 `D00`–`D25`。每篇文档固定包含：

- 步骤 A：概念与功能讲解（为什么需要、解决什么问题、如何融入系统）
- 步骤 B：具体实现规划（文件、类型、接口、数据流、测试、原项目取舍、待确认决策）

学习状态由用户确认后更新；未确认前不得标记为完成，也不得进入编码。

## 阶段与依赖

```text
阶段 0  工程基座
  D00 全景 ── D01 基座
                │
阶段 1  LLM 层  ▼
  D02 类型 ── D03 流式协议 ── D04 Provider 注册表 ── D05 首个适配器
                                                   ├─ D06 多 API 家族
                                                   ├─ D07 认证
                                                   └─ D08 图像（可选）
                │
阶段 2  Agent   ▼
  D09 循环 ── D10 状态与队列 ── D11 工具执行语义
                │
阶段 3  工具    ▼
  D12 内置工具 ── D13 输出治理与安全
                │
阶段 4  上下文  ▼
  D14 会话持久化 ── D15 提示与上下文装载 ── D16 压缩与分支摘要
                │
阶段 5  应用    ▼
  D17 CLI/配置/信任 ── D18 会话编排 ── D19 模型运行时
                          ├─ D20 运行模式
                          └─ D21 扩展与包管理
                │
阶段 6  TUI     ▼
  D22 终端与渲染内核 ── D23 组件与编辑器 ── D24 交互模式
                │
阶段 7  设施    ▼
  D25 构建/发布/评测
```

## 文档清单

| ID | 标题 | 构建目标 | 前置 | 主要源码 |
| --- | --- | --- | --- | --- |
| D00 | 项目全景与构建地图 | 理解问题域、五包职责、一次请求的完整链路、为什么按此顺序构建 | 无 | 全部（导航级） |
| D01 | 工程基座 | 建立可编译、可测试、可运行的 monorepo 骨架 | D00 | 根配置、`tsconfig.base.json`、`vitest.base.ts`、`test.sh` |
| D02 | 核心类型层 | 定义跨 provider 的统一消息、工具、模型、用量类型 | D01 | `ai/src/types.ts`、`index.ts` |
| D03 | 流式响应协议 | 用事件流表达增量文本/思考/工具参数，并统一错误与中止 | D02 | `ai/src/utils/event-stream.ts`、`json-parse.ts`、`api/lazy.ts` |
| D04 | Provider 注册表与模型目录 | 管理 provider、模型清单、认证入口与流式分发 | D03 | `ai/src/models.ts`、`providers/*`、`models-store.ts` |
| D05 | 第一个 API 适配器（OpenAI 兼容） | 打通"请求 → 增量事件 → 完整 AssistantMessage" | D04 | `api/openai-completions.ts`、`simple-options.ts` |
| D06 | 多 API 家族与请求基础设施 | 支持 Anthropic/Responses/Google/Mistral，处理兼容差异、重试、代理、跨 provider 归一化 | D05 | `api/*`、`utils/retry.ts`、`transform-messages.ts` |
| D07 | 认证与凭据 | 解析 API key、环境变量、OAuth，持久化凭据并在请求前注入 | D04 | `ai/src/auth/*`、`oauth.ts`、`coding-agent/src/core/auth-storage.ts` |
| D08 | 图像输入与生成（可选） | 支持图片消息与图像模型 | D04 | `ai/src/images*.ts`、`api/openrouter-images.ts` |
| D09 | Agent 循环与事件协议 | 实现"调模型 → 执行工具 → 再调模型"的循环 | D05 | `agent/src/agent-loop.ts`、`types.ts` |
| D10 | Agent 状态机与消息队列 | 管理状态、steering/followUp 队列、中止与继续 | D09 | `agent/src/agent.ts`、`proxy.ts` |
| D11 | 工具执行语义 | 串行/并行执行、参数校验、before/after 钩子、结果回填 | D09 | `agent-loop.ts` 工具段、`ai/src/utils/validation.ts` |
| D12 | 内置工具 | 实现 read/write/edit/bash/ls/grep/find/powershell | D11 | `coding-agent/src/core/tools/*`、`bash-executor.ts` |
| D13 | 工具输出治理与安全 | 截断、输出累积、diff、文件变更串行化、路径约束 | D12 | `tools/truncate.ts`、`output-accumulator.ts`、`edit-diff.ts`、`file-mutation-queue.ts`、`path-utils.ts` |
| D14 | 会话持久化与分支 | JSONL 会话格式、消息树、分支切换、上下文重建 | D10 | `core/session-manager.ts`、`messages.ts`、`session-export.ts` |
| D15 | 提示、上下文与技能 | 系统提示构造、AGENTS.md 装载、技能发现、提示模板 | D14 | `core/system-prompt.ts`、`resource-loader.ts`、`skills.ts`、`prompt-templates.ts` |
| D16 | 上下文压缩与分支摘要 | 估算 token、选择切点、生成摘要、保持会话可继续 | D15 | `core/compaction/*`、`ai/src/utils/estimate.ts` |
| D17 | CLI、配置与项目信任 | 参数解析、设置分层、项目信任、首次启动流程 | D14 | `cli/*`、`main.ts`、`config.ts`、`settings-manager.ts`、`trust-manager.ts` |
| D18 | AgentSession 编排 | 把 Agent、会话、工具、扩展、压缩串成产品级会话 | D16, D17 | `core/agent-session.ts`、`agent-session-runtime.ts`、`sdk.ts` |
| D19 | 模型运行时与解析 | 模型选择、动态目录、自定义 provider、本地 llama | D17 | `core/model-*.ts`、`provider-composer.ts`、`extensions/llama/*` |
| D20 | 运行模式 | print / JSON 事件流 / RPC 三种非交互模式 | D18 | `modes/print-mode.ts`、`json-event.ts`、`modes/rpc/*` |
| D21 | 扩展系统与包管理 | 扩展加载/执行/UI 钩子、pi 包安装与资源发现 | D18 | `core/extensions/*`、`package-manager.ts`、`pi-manifest.ts` |
| D22 | 终端与渲染内核 | 终端能力探测、布局、帧差分渲染、输入解析 | D01 | `tui/src/tui.ts`、`layout.ts`、`terminal.ts`、`keys.ts` |
| D23 | 组件与编辑器 | 文本/输入/列表/编辑器/markdown/latex 等组件 | D22 | `tui/src/components/*`、`editor-component.ts` |
| D24 | 交互模式 | 聊天视口、工具渲染、主题、选择器、快捷键、导出 | D21, D23 | `coding-agent/src/modes/interactive/*` |
| D25 | 构建、发布与评测 | 打包、原生模块、CI、模型代码生成、evals | 全部 | `scripts/*`、`packages/evals/*`、workflows、native |

## 每篇文档的结构

1. 构建目标
2. 前置知识与依赖
3. 步骤 A——概念与功能讲解
4. 步骤 B——具体实现规划
   - 原项目实现（文件、函数、关键逻辑）
   - 新项目实现建议（文件划分、类型、接口、数据流）
   - 待用户确认的决策
   - 测试与验证方案
5. 原源码对应关系（文件 + 行号）
6. 与整体系统的关系（依赖什么、支撑什么）
7. 复现选项（原样 / 简化 / 重设计 / 舍弃）
8. 学习检查点

## 学习状态跟踪

状态值：`未开始` / `已生成` / `A 已学` / `B 已学` / `已确认` / `已实现`。
只有用户明确表示某篇学完，才能把"学习确认"改为"已确认"；只有用户明确要求开始实现，才能进入编码。

| 文档 | 文档状态 | 步骤 A | 步骤 B | 学习确认 | 复现策略 | 允许编码 | 实现状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D00 | 已生成 | 未开始 | 未开始 | 未确认 | 未定 | 否 | 未开始 |
| D01 | 已生成 | 未开始 | 未开始 | 未确认 | 未定 | 否 | 未开始 |
| D02 | 已生成 | 未开始 | 未开始 | 未确认 | 未定 | 否 | 未开始 |
| D03 | 已生成 | 未开始 | 未开始 | 未确认 | 未定 | 否 | 未开始 |
| D04–D25 | 未生成 | 未开始 | 未开始 | 未确认 | 未定 | 否 | 未开始 |

## 批次计划

| 批次 | 文档 | 目的 |
| --- | --- | --- |
| 第 1 批（已完成） | D00–D03 | 建立全局认知与 LLM 抽象地基 |
| 第 2 批 | D04–D08 | 完成可真实调用模型的 LLM 层 |
| 第 3 批 | D09–D11 | 完成最小可运行 Agent |
| 第 4 批 | D12–D16 | 完成编码工具与会话上下文 |
| 第 5 批 | D17–D21 | 完成产品级编排与可编程接口 |
| 第 6 批 | D22–D24 | 完成 TUI 与交互模式 |
| 第 7 批 | D25 | 完成工程设施 |
