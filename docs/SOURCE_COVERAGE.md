# 源码覆盖清单

本清单登记 `my-pi/`（`@earendil-works/pi-*` 0.85.1）与复现相关的内容，用于确认课程规划没有遗漏。

## 0. 登记口径

- 逐文件粒度：`packages/*/src` 每个 `.ts` 一行；生成文件、非 TS 资源单独登记。
- 测试/示例/脚本粒度：测试按包/目录分组，附录列全部文件名；原项目文档、脚本逐文件；示例按目录。
- 状态含义：`分析状态` 表示源码阅读深度；`课程覆盖` 表示对应课程文档是否已生成；`复现状态` 表示 `pipi` 是否已有实现；`处理策略` 取 `复现/简化/后置/仅了解/舍弃`。
- 排除项：`node_modules`、`dist`、`.ipynb_checkpoints`、SWE-bench 数据、文档配图等，见第 6 节。

本清单中的包名 `ai`、`agent`、`tui`、`coding-agent`、`evals` 均指原项目；新项目对应 `llm`、`agent`、`tui`、`harness`、`eval`。

## 1. 总览

- 非生成源文件：**373** 个，**100475** 行
- 生成文件：**30** 个（不计入覆盖分母）
- 非 TS 资源：**37** 个（生成数据、模板、主题、素材）
- 测试文件：**382** 个

| 包 | 文件数 | 行数 | 职责 |
| --- | ---: | ---: | --- |
| `ai` | 112 | 19699 | 统一 LLM API：类型、模型目录、流式协议、API 适配器、认证、图像 |
| `agent` | 6 | 2206 | Agent 循环、状态机、工具执行、事件协议 |
| `tui` | 42 | 18107 | 终端渲染框架、布局、组件、编辑器 |
| `coding-agent` | 203 | 59050 | CLI 产品层：会话、工具、模式、扩展、压缩、配置 |
| `evals` | 10 | 1413 | 文档与扩展的冒烟评测 |

## 2. 模块职责

| 包 | 模块 | 职责 | 关联功能 | 课程 |
| --- | --- | --- | --- | --- |
| `ai` | API 适配器 | 把各家 API 的请求/响应映射到统一类型 | OpenAI/Anthropic/Google/Mistral/Codex 的兼容层 | 05/06 |
| `ai` | 流式协议 | 事件流、增量 JSON 解析、延迟初始化 | 文本/思考/工具参数的实时传输与错误编码 | 03 |
| `ai` | 图像生成 | 图像模型的统一接口 | 多模态输入与图像生成 | 08 |
| `ai` | 认证与凭据 | API key、环境变量、OAuth、凭据存储与刷新 | 请求前解析认证并注入 header | 07 |
| `ai` | Provider 注册表 | provider 集合、模型查找、流式分发、认证委托 | 模型目录与运行时入口 | 04 |
| `ai` | 公共导出面 | pi-ai 的公共 API 边界 | 只导出类型与核心类，避免副作用 | 02 |
| `ai` | Provider 与模型目录 | 各 provider 工厂与生成的模型数据 | 内置 provider 的模型清单 | 04 |
| `ai` | 会话资源 | 会话级共享资源与缓存辅助 | 跨请求复用连接/资源 | 14 |
| `ai` | 类型系统 | 跨 provider 的统一消息/内容块/用量/工具/模型类型 | 所有上层模块的共同语言 | 02 |
| `ai` | 请求基础设施 | HTTP 代理、错误体解析、header、诊断 | provider 请求的公共底座 | 06 |
| `ai` | 上下文压缩 | token 估算与溢出判定辅助 | 压缩触发 | 16 |
| `ai` | 通用工具 | 文本、哈希、UUID、TypeBox 辅助 | 各模块共用的小工具 | 02 |
| `ai` | 请求重试 | 可重试错误判定与退避 | 网络抖动与 429 的恢复 | 06 |
| `ai` | 工具参数校验 | TypeBox 校验、类型强制转换、错误格式化 | 工具调用参数的可信化 | 11 |
| `agent` | Agent 循环 | runAgentLoop：调模型、执行工具、回填结果 | 最小可运行 Agent 的核心 | 09 |
| `agent` | Agent 状态机 | 状态、消息历史、steering/followUp 队列、中止与继续 | 把循环包装成有状态对象 | 10 |
| `agent` | 公共导出面 | pi-agent-core 的公共导出 | 把 Agent、循环、类型暴露给产品层 | 00 |
| `agent` | Agent 类型与事件 | AgentMessage、AgentTool、AgentEvent、循环配置 | 核心与产品层的接口契约 | 09 |
| `tui` | 终端与渲染内核 | 终端能力、布局、帧差分、输入解析 | 所有终端 UI 的底座 | 22 |
| `tui` | 编辑器与组件 | 多行编辑器、自动补全、撤销、模糊匹配 | 交互输入体验 | 23 |
| `tui` | TUI 组件 | 文本、输入、列表、滚动、markdown 等组件 | 可组合的界面单元 | 23 |
| `tui` | 公共导出面 | pi-tui 的公共导出 | 组件与渲染 API 的统一出口 | 22 |
| `tui` | 原生模块 | 剪贴板、平台能力、原生路径 | 跨平台增强能力 | 25 |
| `tui` | 终端图像 | 终端图片协议与渲染 | 图片预览 | 23 |
| `coding-agent` | Bun 运行时适配 | Bun 下的环境恢复与沙箱 | 二进制发行版 | 25 |
| `coding-agent` | CLI 启动 | 参数解析、模式选择、首次启动、运行时创建 | 用户入口 | 17 |
| `coding-agent` | 配置与信任 | 设置分层、项目信任、配置值解析 | 安全与可配置性 | 17 |
| `coding-agent` | 会话编排 | 把 Agent、会话、工具、扩展、压缩串起来 | 产品级会话对象 | 18 |
| `coding-agent` | 认证与凭据 | 凭据存储、运行时凭据、认证指引 | 登录与鉴权 | 07 |
| `coding-agent` | 内置工具 | read/write/edit/bash/ls/grep/find/powershell | Agent 的实际动手能力 | 12 |
| `coding-agent` | 上下文压缩 | 切点选择、摘要生成、分支摘要 | 长会话继续运行 | 16 |
| `coding-agent` | 工程与诊断 | 遥测、计时、诊断、HTTP 分发、实验开关 | 可观测性与运维 | 25 |
| `coding-agent` | 会话导出 | 导出 HTML/JSON、模板与语法高亮 | 分享与归档 | 24 |
| `coding-agent` | 扩展系统 | 扩展加载、类型、执行器、UI 钩子 | 可编程扩展点 | 21 |
| `coding-agent` | 交互模式 | 聊天视口、组件、主题、选择器、快捷键 | 终端交互体验 | 24 |
| `coding-agent` | 会话持久化 | JSONL 会话、树结构、分支、上下文重建 | 历史可恢复 | 14 |
| `coding-agent` | 模型运行时 | 模型选择、解析、动态 provider、动态目录 | 运行时模型管理 | 19 |
| `coding-agent` | 扩展与包管理 | 安装/更新/锁定 pi 包，解析资源清单 | 扩展生态 | 21 |
| `coding-agent` | 提示与上下文装载 | 系统提示、AGENTS.md、技能、提示模板 | 模型行为与项目上下文 | 15 |
| `coding-agent` | 工具治理 | 截断、输出累积、diff、文件变更队列、路径约束 | 工具输出的安全与可控 | 13 |
| `coding-agent` | 工具渲染 | 把工具调用与结果渲染成终端视图 | 工具执行的可视化 | 23 |
| `coding-agent` | 本地模型接入 | llama.cpp 本地 provider 与 UI | 离线模型 | 19 |
| `coding-agent` | SDK 导出面 | 对外暴露的编程接口 | 嵌入其他程序 | 18 |
| `coding-agent` | 运行模式 | print / JSON / RPC 三种非交互模式 | 脚本集成 | 20 |
| `coding-agent` | 通用工具 | 路径、JSON、文件监听、版本检查等 | 产品层公共辅助 | 25 |
| `coding-agent` | 渲染工具 | ANSI、文本宽度、语法高亮、HTML | 终端渲染辅助 | 23 |
| `coding-agent` | 剪贴板与图像 | 剪贴板读写、图片转换/缩放/EXIF | 图片输入 | 24 |
| `coding-agent` | 会话与分支 | git 状态与分支相关辅助 | 会话分支与工作区 | 14 |
| `evals` | 评测 | 文档、扩展示例、冒烟评测 | 质量回归 | 25 |

## 3. 课程覆盖汇总

课程学习状态以 `LEARNING_PLAN.md` 为准；这里只汇总课程在原项目中覆盖的文件数。

| 课程 | 覆盖文件数 | 课程覆盖 | 复现状态 |
| --- | ---: | --- | --- |
| 00 | 1 | 已生成 | 不适用（无代码） |
| 01 | 0 | 已生成 | 已实现 |
| 02 | 7 | 已生成 | 已实现 |
| 03 | 4 | 已生成 | 已实现 |
| 04 | 37 | 已生成 | 已实现 |
| 05 | 2 | 已生成 | 部分实现 |
| 06 | 31 | 未生成 | 未开始 |
| 07 | 23 | 未生成 | 未开始 |
| 08 | 7 | 未生成 | 未开始 |
| 09 | 3 | 未生成 | 未开始 |
| 10 | 2 | 未生成 | 未开始 |
| 11 | 1 | 未生成 | 未开始 |
| 12 | 12 | 未生成 | 未开始 |
| 13 | 8 | 未生成 | 未开始 |
| 14 | 6 | 未生成 | 未开始 |
| 15 | 4 | 未生成 | 未开始 |
| 16 | 6 | 未生成 | 未开始 |
| 17 | 21 | 未生成 | 未开始 |
| 18 | 12 | 未生成 | 未开始 |
| 19 | 15 | 未生成 | 未开始 |
| 20 | 8 | 未生成 | 未开始 |
| 21 | 8 | 未生成 | 未开始 |
| 22 | 13 | 未生成 | 未开始 |
| 23 | 39 | 未生成 | 未开始 |
| 24 | 66 | 未生成 | 未开始 |
| 25 | 37 | 未生成 | 未开始 |

说明：课程 00 是全局导航，只涉及 `agent/src/index.ts`；课程 01 覆盖根配置、构建与测试设施（见 5.5），不计入 `src` 统计；课程 22–24 覆盖 `tui`；课程 25 覆盖脚本、native、CI 与 evals。

## 4. 逐文件登记

### 4.1 `packages/ai/src`（112 文件 / 19699 行）

| 文件或文件组 | 行数 | 模块 | 课程 | 分析状态 | 课程覆盖 | 复现状态 | 处理策略 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `api/anthropic-messages.lazy.ts` | 4 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `api/anthropic-messages.ts` | 1489 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `api/constrained-sampling.ts` | 277 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `api/github-copilot-headers.ts` | 37 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/google-generative-ai.lazy.ts` | 4 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/google-generative-ai.ts` | 526 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/google-shared.ts` | 452 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/google-vertex.lazy.ts` | 4 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/google-vertex.ts` | 598 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/lazy.ts` | 98 | 流式协议 | 03 | 已分析 | 已生成 | 已实现 | 复现 |
| `api/mistral-conversations.lazy.ts` | 4 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/mistral-conversations.ts` | 936 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `api/openai-codex-responses.lazy.ts` | 4 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/openai-codex-responses.ts` | 1653 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/openai-completions.lazy.ts` | 4 | API 适配器 | 05 | 已登记 | 已生成 | 未开始 | 复现 |
| `api/openai-completions.ts` | 1667 | API 适配器 | 05 | 部分分析 | 已生成 | 部分实现 | 复现 |
| `api/openai-prompt-cache.ts` | 8 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `api/openai-responses-shared.ts` | 793 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/openai-responses.lazy.ts` | 4 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/openai-responses.ts` | 390 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/openrouter-images.lazy.ts` | 10 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/openrouter-images.ts` | 196 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `api/simple-options.ts` | 94 | API 适配器 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `api/transform-messages.ts` | 223 | API 适配器 | 06 | 已分析 | 未生成 | 未开始 | 复现 |
| `auth/context.ts` | 45 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 复现 |
| `auth/credential-store.ts` | 67 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 复现 |
| `auth/helpers.ts` | 59 | 认证与凭据 | 07 | 已登记 | 未生成 | 部分实现 | 简化 |
| `auth/oauth/anthropic.ts` | 364 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/device-code.ts` | 98 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/github-copilot.ts` | 507 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/kimi-coding.ts` | 296 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/load.ts` | 58 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/oauth-page.ts` | 109 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/openai-codex.ts` | 544 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/openrouter.ts` | 311 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/pkce.ts` | 34 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/oauth/xai.ts` | 239 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `auth/resolve.ts` | 205 | 认证与凭据 | 07 | 已登记 | 未生成 | 部分实现 | 简化 |
| `auth/types.ts` | 240 | 认证与凭据 | 07 | 已登记 | 未生成 | 部分实现 | 简化 |
| `bun-oauth.ts` | 19 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `cli.ts` | 119 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `compat.ts` | 278 | Provider 注册表 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `compat/extension-oauth-types.ts` | 45 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `env-api-keys.ts` | 156 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 复现 |
| `image-models.ts` | 42 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `images-api-registry.ts` | 53 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `images-models.ts` | 275 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `images.ts` | 21 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `index.ts` | 45 | 公共导出面 | 02 | 部分分析 | 已生成 | 部分实现 | 复现 |
| `legacy-api-aliases.ts` | 94 | Provider 注册表 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `model-catalog.ts` | 27 | Provider 注册表 | 04 | 已登记 | 已生成 | 已实现 | 复现 |
| `models-store.ts` | 45 | Provider 注册表 | 04 | 已登记 | 已生成 | 已实现 | 复现 |
| `models.ts` | 957 | Provider 注册表 | 04 | 部分分析 | 已生成 | 部分实现 | 复现 |
| `oauth.ts` | 10 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 后置 |
| `providers/all.ts` | 127 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 简化 |
| `providers/anthropic.ts` | 59 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 复现 |
| `providers/data-json.d.ts` | 4 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 简化 |
| `providers/deepseek.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 复现 |
| `providers/faux.ts` | 708 | Provider 与模型目录 | 04 | 部分分析 | 已生成 | 部分实现 | 复现 |
| `providers/github-copilot.ts` | 34 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 后置 |
| `providers/google-vertex.ts` | 100 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/google.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/groq.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/images/register-builtins.ts` | 50 | 图像生成 | 08 | 已登记 | 未生成 | 未开始 | 后置 |
| `providers/kimi-coding.ts` | 24 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/minimax-cn.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/minimax.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/mistral.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/moonshotai-cn.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/moonshotai.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/openai-codex.ts` | 22 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 后置 |
| `providers/openai.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 复现 |
| `providers/opencode-go.ts` | 24 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/opencode.ts` | 24 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/openrouter-images.ts` | 22 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 后置 |
| `providers/openrouter.ts` | 27 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/qwen-token-plan-cn.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/qwen-token-plan-individual.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/qwen-token-plan.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/vercel-ai-gateway.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/xai.ts` | 24 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/xiaomi-token-plan-ams.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/xiaomi-token-plan-cn.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/xiaomi-token-plan-sgp.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/xiaomi.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/zai-coding-cn.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `providers/zai.ts` | 15 | Provider 与模型目录 | 04 | 已登记 | 已生成 | 未开始 | 仅了解 |
| `session-resources.ts` | 24 | 会话资源 | 14 | 已登记 | 未生成 | 未开始 | 复现 |
| `types.ts` | 843 | 类型系统 | 02 | 已分析 | 已生成 | 部分实现 | 复现 |
| `utils/abort-signals.ts` | 41 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/abort.ts` | 50 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/assistant-message-frame.ts` | 490 | 流式协议 | 03 | 已登记 | 已生成 | 未开始 | 复现 |
| `utils/deferred-tools.ts` | 39 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/diagnostics.ts` | 45 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/error-body.ts` | 149 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/estimate.ts` | 143 | 上下文压缩 | 16 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/event-stream.ts` | 110 | 流式协议 | 03 | 已分析 | 已生成 | 已实现 | 复现 |
| `utils/hash.ts` | 13 | 通用工具 | 02 | 已登记 | 已生成 | 未开始 | 复现 |
| `utils/headers.ts` | 18 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/json-parse.ts` | 124 | 流式协议 | 03 | 已分析 | 已生成 | 已实现 | 复现 |
| `utils/node-http-proxy.ts` | 161 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/overflow.ts` | 183 | 上下文压缩 | 16 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/pi-user-agent.ts` | 19 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/provider-env.ts` | 52 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/provider-retry.ts` | 125 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/retry.ts` | 229 | 请求重试 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/sanitize-unicode.ts` | 25 | 请求基础设施 | 06 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/sleep.ts` | 14 | 通用工具 | 02 | 已登记 | 已生成 | 未开始 | 复现 |
| `utils/text.ts` | 12 | 通用工具 | 02 | 已登记 | 已生成 | 未开始 | 复现 |
| `utils/typebox-helpers.ts` | 24 | 通用工具 | 02 | 已登记 | 已生成 | 未开始 | 复现 |
| `utils/uuid.ts` | 45 | 通用工具 | 02 | 已登记 | 已生成 | 未开始 | 复现 |
| `utils/validation.ts` | 350 | 工具参数校验 | 11 | 已分析 | 未生成 | 未开始 | 复现 |

### 4.2 `packages/agent/src`（6 文件 / 2206 行）

| 文件或文件组 | 行数 | 模块 | 课程 | 分析状态 | 课程覆盖 | 复现状态 | 处理策略 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `agent-loop.ts` | 725 | Agent 循环 | 09 | 部分分析 | 未生成 | 未开始 | 复现 |
| `agent.ts` | 617 | Agent 状态机 | 10 | 部分分析 | 未生成 | 未开始 | 复现 |
| `index.ts` | 5 | 公共导出面 | 00 | 已登记 | 已生成 | 未开始 | 复现 |
| `proxy.ts` | 402 | Agent 状态机 | 10 | 已登记 | 未生成 | 未开始 | 复现 |
| `stream-fn.ts` | 20 | Agent 循环 | 09 | 已登记 | 未生成 | 未开始 | 复现 |
| `types.ts` | 437 | Agent 类型与事件 | 09 | 部分分析 | 未生成 | 未开始 | 复现 |

### 4.3 `packages/tui/src`（42 文件 / 18107 行）

| 文件或文件组 | 行数 | 模块 | 课程 | 分析状态 | 课程覆盖 | 复现状态 | 处理策略 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `alt-screen-search.ts` | 327 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `autocomplete.ts` | 826 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/alt-screen-flash.ts` | 51 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/box.ts` | 167 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/cancellable-loader.ts` | 40 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/editor.ts` | 2461 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/h-stack.ts` | 44 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/image.ts` | 127 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/input.ts` | 494 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/loader.ts` | 101 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/markdown.ts` | 1015 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/mouse-region.ts` | 33 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/scroll-view.ts` | 224 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/select-list.ts` | 273 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/settings-list.ts` | 328 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/spacer.ts` | 28 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/stack.ts` | 154 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/text.ts` | 107 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/truncated-text.ts` | 65 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `components/v-stack.ts` | 33 | TUI 组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `editor-component.ts` | 74 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `fuzzy.ts` | 137 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `index.ts` | 156 | 公共导出面 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `keybindings.ts` | 320 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `keys.ts` | 1401 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `kill-ring.ts` | 46 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `latex.ts` | 1394 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `layout-node.ts` | 51 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `layout.ts` | 449 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `native-modifiers.ts` | 13 | 原生模块 | 25 | 已登记 | 未生成 | 未开始 | 后置 |
| `native-module-path.ts` | 31 | 原生模块 | 25 | 已登记 | 未生成 | 未开始 | 后置 |
| `native-platform.ts` | 63 | 原生模块 | 25 | 已登记 | 未生成 | 未开始 | 后置 |
| `stdin-buffer.ts` | 444 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `terminal-colors.ts` | 73 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `terminal-image.ts` | 696 | 终端图像 | 23 | 已登记 | 未生成 | 未开始 | 后置 |
| `terminal.ts` | 547 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `tui-alt-screen.ts` | 1721 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `tui-main-screen.ts` | 655 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `tui.ts` | 1456 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `undo-stack.ts` | 28 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils.ts` | 1337 | 终端与渲染内核 | 22 | 已登记 | 未生成 | 未开始 | 复现 |
| `word-navigation.ts` | 117 | 编辑器与组件 | 23 | 已登记 | 未生成 | 未开始 | 复现 |

### 4.4 `packages/coding-agent/src`（203 文件 / 59050 行）

| 文件或文件组 | 行数 | 模块 | 课程 | 分析状态 | 课程覆盖 | 复现状态 | 处理策略 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `bun/cli.ts` | 4 | Bun 运行时适配 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `bun/restore-sandbox-env.ts` | 36 | Bun 运行时适配 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `bun/runtime-setup.ts` | 6 | Bun 运行时适配 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `bun/sandbox-env-setup.ts` | 4 | Bun 运行时适配 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `cli.ts` | 24 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/args.ts` | 426 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/auth-check.ts` | 73 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/auth-command.ts` | 126 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/config-selector.ts` | 59 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/credential-print.ts` | 87 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/file-processor.ts` | 113 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/initial-message.ts` | 43 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/list-models.ts` | 115 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/project-trust.ts` | 62 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/session-picker.ts` | 55 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `cli/startup-ui.ts` | 188 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `config.ts` | 576 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/agent-session-runtime.ts` | 449 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/agent-session-services.ts` | 317 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/agent-session.ts` | 3529 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/auth-guidance.ts` | 25 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 简化 |
| `core/auth-storage.ts` | 506 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 简化 |
| `core/bash-executor.ts` | 156 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/cache-stats.ts` | 164 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/compaction/branch-summarization.ts` | 367 | 上下文压缩 | 16 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/compaction/compaction.ts` | 987 | 上下文压缩 | 16 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/compaction/index.ts` | 7 | 上下文压缩 | 16 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/compaction/utils.ts` | 175 | 上下文压缩 | 16 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/defaults.ts` | 12 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/diagnostics.ts` | 15 | 工程与诊断 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/event-bus.ts` | 33 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/exec.ts` | 107 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/experimental.ts` | 3 | 工程与诊断 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/export-html/ansi-to-html.ts` | 258 | 会话导出 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/export-html/index.ts` | 316 | 会话导出 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/export-html/tool-renderer.ts` | 172 | 会话导出 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/extensions/index.ts` | 192 | 扩展系统 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/extensions/loader.ts` | 798 | 扩展系统 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/extensions/runner.ts` | 1277 | 扩展系统 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/extensions/types.ts` | 1777 | 扩展系统 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/extensions/wrapper.ts` | 45 | 扩展系统 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/footer-data-provider.ts` | 388 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/http-dispatcher.ts` | 191 | 工程与诊断 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/index.ts` | 80 | 工程与诊断 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/keybindings.ts` | 384 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/messages.ts` | 195 | 会话持久化 | 14 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/model-config.ts` | 299 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/model-registry.ts` | 173 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/model-resolver.ts` | 770 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/model-runtime.ts` | 772 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/models-store.ts` | 147 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/output-guard.ts` | 108 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/package-manager.ts` | 2636 | 扩展与包管理 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/pi-manifest.ts` | 34 | 扩展与包管理 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/project-trust.ts` | 96 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/prompt-templates.ts` | 285 | 提示与上下文装载 | 15 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/provider-attribution.ts` | 69 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/provider-composer.ts` | 577 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/remote-catalog-provider.ts` | 137 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/resolve-config-value.ts` | 287 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/resource-loader.ts` | 921 | 提示与上下文装载 | 15 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/runtime-credentials.ts` | 52 | 认证与凭据 | 07 | 已登记 | 未生成 | 未开始 | 简化 |
| `core/sdk.ts` | 410 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/session-cwd.ts` | 60 | 会话持久化 | 14 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/session-export.ts` | 42 | 会话持久化 | 14 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/session-manager.ts` | 1642 | 会话持久化 | 14 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/settings-diagnostics.ts` | 25 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/settings-manager.ts` | 1389 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/skills.ts` | 509 | 提示与上下文装载 | 15 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/slash-commands.ts` | 43 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/source-info.ts` | 40 | 模型运行时 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/system-prompt.ts` | 149 | 提示与上下文装载 | 15 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/telemetry.ts` | 13 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/timings.ts` | 50 | 工程与诊断 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/bash.ts` | 400 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/edit-diff.ts` | 556 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/edit.ts` | 220 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/file-mutation-queue.ts` | 61 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/find.ts` | 318 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/grep.ts` | 323 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/index.ts` | 224 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/ls.ts` | 175 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/output-accumulator.ts` | 222 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/path-utils.ts` | 118 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/powershell.ts` | 67 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/read.ts` | 205 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/render-utils.ts` | 85 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/bash.ts` | 163 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/edit.ts` | 238 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/find.ts` | 77 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/grep.ts` | 82 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/index.ts` | 63 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/ls.ts` | 70 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/read.ts` | 175 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/renderers/write.ts` | 181 | 工具渲染 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/tool-definition-wrapper.ts` | 47 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/truncate.ts` | 276 | 工具治理 | 13 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/tools/write.ts` | 97 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/trust-manager.ts` | 244 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `core/usage-totals.ts` | 70 | 会话编排 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `extensions/index.ts` | 4 | 本地模型接入 | 19 | 已登记 | 未生成 | 未开始 | 复现 |
| `extensions/llama/client.ts` | 343 | 本地模型接入 | 19 | 已登记 | 未生成 | 未开始 | 后置 |
| `extensions/llama/huggingface.ts` | 158 | 本地模型接入 | 19 | 已登记 | 未生成 | 未开始 | 后置 |
| `extensions/llama/index.ts` | 230 | 本地模型接入 | 19 | 已登记 | 未生成 | 未开始 | 后置 |
| `extensions/llama/provider.ts` | 180 | 本地模型接入 | 19 | 已登记 | 未生成 | 未开始 | 后置 |
| `extensions/llama/ui.ts` | 542 | 本地模型接入 | 19 | 已登记 | 未生成 | 未开始 | 后置 |
| `index.ts` | 421 | SDK 导出面 | 18 | 已登记 | 未生成 | 未开始 | 复现 |
| `main.ts` | 1120 | CLI 启动 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `migrations.ts` | 315 | 配置与信任 | 17 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/index.ts` | 16 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/chat-viewport.ts` | 46 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/armin.ts` | 382 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/assistant-message.ts` | 202 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/bash-execution.ts` | 220 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/bordered-loader.ts` | 68 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/branch-summary-message.ts` | 58 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/compaction-summary-message.ts` | 59 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/config-selector.ts` | 935 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/countdown-timer.ts` | 39 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/custom-editor.ts` | 148 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/custom-entry.ts` | 62 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/custom-message.ts` | 113 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/daxnuts.ts` | 164 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/diff.ts` | 147 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/dynamic-border.ts` | 25 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/extension-editor.ts` | 132 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/extension-input.ts` | 87 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/extension-selector.ts` | 112 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/first-time-setup.ts` | 145 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/footer.ts` | 245 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/index.ts` | 37 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/keybinding-hints.ts` | 48 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/login-dialog.ts` | 233 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/markdown-transform.ts` | 29 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/mermaid.ts` | 89 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/model-selector.ts` | 421 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/oauth-selector.ts` | 214 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `modes/interactive/components/scoped-models-selector.ts` | 401 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/session-selector-search.ts` | 194 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/session-selector.ts` | 1031 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/settings-selector.ts` | 943 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/settings-submenu.ts` | 258 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/show-images-selector.ts` | 50 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/skill-invocation-message.ts` | 55 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/status-indicator.ts` | 123 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/thinking-selector.ts` | 154 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/tool-execution.ts` | 421 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/tree-selector.ts` | 1247 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/trust-selector.ts` | 134 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/user-message-selector.ts` | 155 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/user-message.ts` | 70 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/components/visual-truncate.ts` | 50 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/external-editor.ts` | 46 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/interactive-mode.ts` | 6533 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/model-catalog-refresh.ts` | 51 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/model-search.ts` | 21 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/session-share.ts` | 111 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/theme/theme-controller.ts` | 88 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/theme/theme.ts` | 887 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/interactive/tui-renderer.ts` | 79 | 交互模式 | 24 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/json-event.ts` | 61 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/print-mode.ts` | 168 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/rpc/jsonl.ts` | 58 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/rpc/rpc-client.ts` | 609 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/rpc/rpc-mode.ts` | 807 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `modes/rpc/rpc-types.ts` | 297 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `package-manager-cli.ts` | 1102 | 扩展与包管理 | 21 | 已登记 | 未生成 | 未开始 | 复现 |
| `rpc-entry.ts` | 13 | 运行模式 | 20 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/abort.ts` | 48 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/ansi.ts` | 60 | 渲染工具 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/changelog.ts` | 196 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/child-process.ts` | 137 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/clipboard-command.ts` | 44 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/clipboard-image.ts` | 259 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/clipboard.ts` | 77 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/deprecation.ts` | 14 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/exif-orientation.ts` | 182 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/frontmatter.ts` | 40 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/fs-watch.ts` | 30 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/git.ts` | 226 | 会话与分支 | 14 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/highlight-js.d.ts` | 36 | 渲染工具 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/html.ts` | 51 | 渲染工具 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/image-convert.ts` | 49 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/image-process.ts` | 119 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/image-resize-core.ts` | 164 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/image-resize-worker.ts` | 42 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/image-resize.ts` | 123 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/json.ts` | 6 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/management-http.ts` | 78 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/mime.ts` | 116 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/open-browser.ts` | 24 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/paths.ts` | 139 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/photon.ts` | 139 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/pi-user-agent.ts` | 4 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/shell.ts` | 247 | 内置工具 | 12 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/sleep.ts` | 18 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/source-resolver.ts` | 86 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/syntax-highlight.ts` | 212 | 渲染工具 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/text.ts` | 9 | 渲染工具 | 23 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/tool-result-images.ts` | 62 | 剪贴板与图像 | 24 | 已登记 | 未生成 | 未开始 | 后置 |
| `utils/tools-manager.ts` | 400 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/version-check.ts` | 109 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |
| `utils/windows-self-update.ts` | 84 | 通用工具 | 25 | 已登记 | 未生成 | 未开始 | 复现 |

### 4.5 `packages/evals/src`（10 文件 / 1413 行）

| 文件或文件组 | 行数 | 模块 | 课程 | 分析状态 | 课程覆盖 | 复现状态 | 处理策略 |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| `docs-catalog.ts` | 61 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `docs.eval.ts` | 71 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `extensions.eval.ts` | 140 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `pi-harness.ts` | 261 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `smoke.eval.ts` | 17 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `vitest-evals/artifacts.ts` | 113 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `vitest-evals/harness-table.ts` | 193 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `vitest-evals/reporter.ts` | 111 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `vitest-evals/setup.ts` | 8 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |
| `vitest-evals/summary.ts` | 438 | 评测 | 25 | 已登记 | 未生成 | 未开始 | 仅了解 |

## 5. 测试与工程设施

### 5.1 测试

| 内容 | 粒度 | 课程 | 处理方式 |
| --- | --- | --- | --- |
| `packages/agent/test` | 目录（4 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/agent/test/utils` | 目录（3 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/ai/test` | 目录（112 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/ai/test/data` | 目录（1 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/coding-agent/test` | 目录（157 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/coding-agent/test/fixtures` | 目录（22 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/coding-agent/test/memory` | 目录（11 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/coding-agent/test/session-manager` | 目录（7 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/coding-agent/test/suite` | 目录（11 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/evals/test` | 目录（2 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/evals/test/vitest-evals` | 目录（3 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/tui/test` | 目录（45 文件） | 随对应模块 | 按模块复现，优先核心路径 |
| `packages/tui/test/fixtures` | 目录（4 文件） | 随对应模块 | 按模块复现，优先核心路径 |

### 5.2 原项目文档

| 内容 | 粒度 | 课程 | 处理方式 |
| --- | --- | --- | --- |
| `compaction.md` | 逐文件 | 16 | 概念校准 |
| `containerization.md` | 逐文件 | 25 | 概念校准 |
| `custom-provider.md` | 逐文件 | 19 | 概念校准 |
| `development.md` | 逐文件 | 01 | 概念校准 |
| `docs.json` | 逐文件 | 00 | 概念校准 |
| `environment-variables.md` | 逐文件 | 17 | 概念校准 |
| `extensions.md` | 逐文件 | 21 | 概念校准 |
| `index.md` | 逐文件 | 00 | 概念校准 |
| `json.md` | 逐文件 | 20 | 概念校准 |
| `keybindings.md` | 逐文件 | 24 | 概念校准 |
| `llama-cpp.md` | 逐文件 | 19 | 概念校准 |
| `models.md` | 逐文件 | 19 | 概念校准 |
| `packages.md` | 逐文件 | 21 | 概念校准 |
| `prompt-templates.md` | 逐文件 | 15 | 概念校准 |
| `providers.md` | 逐文件 | 07 | 概念校准 |
| `quickstart.md` | 逐文件 | 17 | 概念校准 |
| `rpc.md` | 逐文件 | 20 | 概念校准 |
| `sdk.md` | 逐文件 | 18 | 概念校准 |
| `security.md` | 逐文件 | 17 | 概念校准 |
| `session-format.md` | 逐文件 | 14 | 概念校准 |
| `sessions.md` | 逐文件 | 14 | 概念校准 |
| `settings.md` | 逐文件 | 17 | 概念校准 |
| `shell-aliases.md` | 逐文件 | 17 | 概念校准 |
| `skills.md` | 逐文件 | 15 | 概念校准 |
| `terminal-setup.md` | 逐文件 | 24 | 概念校准 |
| `termux.md` | 逐文件 | 25 | 概念校准 |
| `tmux.md` | 逐文件 | 24 | 概念校准 |
| `tui.md` | 逐文件 | 23 | 概念校准 |
| `usage.md` | 逐文件 | 17 | 概念校准 |
| `windows.md` | 逐文件 | 25 | 概念校准 |
| `images/` | 逐文件 | 文档配图，不作为课程素材 | 概念校准 |

### 5.3 示例

| 内容 | 粒度 | 课程 | 处理方式 |
| --- | --- | --- | --- |
| `README.md` | 目录（1 文件） | 00 | 按需参考 |
| `extensions/README.md` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/auto-commit-on-exit.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/bash-spawn-hook.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/border-status-editor.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/built-in-tool-renderer.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/claude-rules.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/commands.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/confirm-destructive.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/custom-compaction.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/custom-footer.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/custom-header.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/custom-provider-anthropic` | 目录（4 文件） | 21 | 按需参考 |
| `extensions/custom-provider-gitlab-duo` | 目录（4 文件） | 21 | 按需参考 |
| `extensions/dirty-repo-guard.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/doom-overlay` | 目录（11 文件） | 21 | 按需参考 |
| `extensions/dynamic-resources` | 目录（3 文件） | 21 | 按需参考 |
| `extensions/dynamic-tools.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/entry-renderer.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/event-bus.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/file-trigger.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/git-checkpoint.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/git-merge-and-resolve.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/github-issue-autocomplete.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/gondolin` | 目录（4 文件） | 21 | 按需参考 |
| `extensions/handoff.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/hello.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/hidden-thinking-label.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/inline-bash.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/input-transform-streaming.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/input-transform.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/interactive-shell.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/kimi-deferred-tools.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/memory` | 目录（2 文件） | 21 | 按需参考 |
| `extensions/message-renderer.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/minimal-mode.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/modal-editor.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/model-status.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/notify.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/overlay-qa-tests.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/overlay-test.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/permission-gate.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/pirate.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/plan-mode` | 目录（3 文件） | 21 | 按需参考 |
| `extensions/preset.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/project-trust.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/prompt-customizer.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/protected-paths.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/provider-payload.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/qna.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/question.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/questionnaire.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/rainbow-editor.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/reload-runtime.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/rpc-demo.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/sandbox` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/send-user-message.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/session-name.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/shutdown-command.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/snake.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/space-invaders.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/ssh.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/status-line.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/structured-output.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/subagent` | 目录（10 文件） | 21 | 按需参考 |
| `extensions/summarize.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/system-prompt-header.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/tic-tac-toe.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/timed-confirm.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/titlebar-spinner.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/todo.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/tool-override.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/tools.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/trigger-compact.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/truncated-tool.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/widget-placement.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/with-deps` | 目录（4 文件） | 21 | 按需参考 |
| `extensions/working-indicator.ts` | 目录（1 文件） | 21 | 按需参考 |
| `extensions/working-message-test.ts` | 目录（1 文件） | 21 | 按需参考 |
| `rpc-extension-ui.ts` | 目录（1 文件） | 21 | 按需参考 |
| `sdk/01-minimal.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/02-custom-model.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/03-custom-prompt.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/04-skills.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/05-tools.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/06-extensions.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/07-context-files.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/08-prompt-templates.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/09-api-keys-and-oauth.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/10-settings.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/11-sessions.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/12-full-control.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/13-session-runtime.ts` | 目录（1 文件） | 18 | 按需参考 |
| `sdk/README.md` | 目录（1 文件） | 18 | 按需参考 |

### 5.4 脚本

| 内容 | 粒度 | 课程 | 处理方式 |
| --- | --- | --- | --- |
| `scripts/agent-treeshake-smoke-entry.ts` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/auto-pi.sh` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/browser-smoke-entry.ts` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/build-binaries.sh` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/build-coding-agent-bundle.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/check-browser-smoke.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/check-entry-graphs.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/check-pinned-deps.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/check-runtime-deps.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/check-runtime-deps.test.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/check-ts-relative-imports.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/coding-agent-consumer.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/coding-agent-consumer.test.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/cost.ts` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/create-source-archive.sh` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/diff-model-catalog.mjs` | 逐文件 | 19 | 构建/发布设施 |
| `scripts/edit-tool-stats.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/generate-coding-agent-install-lock.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/generate-coding-agent-shrinkwrap.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/generate-thinking-capabilities.mjs` | 逐文件 | 19 | 构建/发布设施 |
| `scripts/local-release.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/package-workspaces.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/profile-coding-agent-node.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/publish-model-catalog.mjs` | 逐文件 | 19 | 构建/发布设施 |
| `scripts/publish-release-announcement.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/publish-release-announcement.test.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/publish.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/read-tool-stats.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/release-notes.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/release-packages.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/release.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/repro-5893-wsl-bash.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/session-context-stats.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/session-transcripts.ts` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/stats.ts` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/sync-versions.js` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/sync-versions.test.mjs` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/tool-stats.ts` | 逐文件 | 25 | 构建/发布设施 |
| `scripts/update-source-imports-to-ts.sh` | 逐文件 | 25 | 构建/发布设施 |

### 5.5 原生模块、CI 与根配置

| 内容 | 粒度 | 课程 | 处理方式 |
| --- | --- | --- | --- |
| `packages/tui/native/` | 18 个文件（darwin/linux/win32 的剪贴板与终端辅助） | 25 | 按说明处理 |
| `.github/workflows/` | 7 个 workflow：approve-contributor.yml, ci.yml, issue-gate.yml, issue-triage-labels.yml, npm-audit.yml, pr-gate.yml, remove-inprogress-on-close.yml | 25 | 按说明处理 |
| `.gitattributes` | 根级配置/脚本 | 01 | 按说明处理 |
| `.gitignore` | 根级配置/脚本 | 01 | 按说明处理 |
| `.npmrc` | 根级配置/脚本 | 01 | 按说明处理 |
| `biome.json` | 根级配置/脚本 | 01 | 按说明处理 |
| `package.json` | 根级配置/脚本 | 01 | 按说明处理 |
| `package-lock.json` | 根级配置/脚本 | 01 | 按说明处理 |
| `tsconfig.base.json` | 根级配置/脚本 | 01 | 按说明处理 |
| `tsconfig.json` | 根级配置/脚本 | 01 | 按说明处理 |
| `vitest.base.ts` | 根级配置/脚本 | 01 | 按说明处理 |
| `test.sh` | 根级配置/脚本 | 01 | 按说明处理 |
| `pi-test.sh` | 根级配置/脚本 | 01 | 按说明处理 |
| `pi-test.ps1` | 根级配置/脚本 | 01 | 按说明处理 |
| `pi-test.bat` | 根级配置/脚本 | 01 | 按说明处理 |
| `tui-plan.md` | 根级配置/脚本 | 01 | 按说明处理 |
| `AGENTS.md` | 根级配置/脚本 | 01 | 按说明处理 |
| `README.md` | 根级配置/脚本 | 01 | 按说明处理 |
| `references/` | 用户自己的 Memory 方案草稿，非 pi 源码 | 不纳入 | 按说明处理 |

### 5.6 生成文件与非 TS 资源

| 内容 | 粒度 | 课程 | 处理方式 |
| --- | --- | --- | --- |
| `packages/ai/src/providers/data/*.json` | 生成数据（29 个） | 04 | 不手改；课程讲生成流程与数据形状 |
| `packages/ai/src/image-models.generated.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/models.generated.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/anthropic.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/deepseek.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/github-copilot.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/google-vertex.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/google.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/groq.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/kimi-coding.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/minimax-cn.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/minimax.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/mistral.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/moonshotai-cn.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/moonshotai.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/openai-codex.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/openai.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/opencode-go.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/opencode.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/openrouter.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/qwen-token-plan-cn.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/qwen-token-plan-individual.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/qwen-token-plan.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/vercel-ai-gateway.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/xai.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/xiaomi-token-plan-ams.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/xiaomi-token-plan-cn.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/xiaomi-token-plan-sgp.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/xiaomi.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/zai-coding-cn.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/ai/src/providers/zai.models.ts` | 生成文件 | 04 | 由脚本生成，不手改 |
| `packages/coding-agent/src/core/export-html/template.html` | 模板 | 24 | 会话导出模板 |
| `packages/coding-agent/src/core/export-html/template.css` | 模板 | 24 | 会话导出样式 |
| `packages/coding-agent/src/core/export-html/template.js` | 模板 | 24 | 会话导出脚本 |
| `packages/coding-agent/src/core/export-html/vendor/highlight.min.js` | 第三方 | 24 | 语法高亮，vendored |
| `packages/coding-agent/src/core/export-html/vendor/marked.min.js` | 第三方 | 24 | Markdown 渲染，vendored |
| `packages/coding-agent/src/modes/interactive/theme/dark.json` | 主题 | 24 | 深色主题 |
| `packages/coding-agent/src/modes/interactive/theme/light.json` | 主题 | 24 | 浅色主题 |
| `packages/coding-agent/src/modes/interactive/assets/clankolas.png` | 图片 | 24 | 启动动画素材 |

## 6. 明确排除

| 内容 | 原因 |
| --- | --- |
| `**/.ipynb_checkpoints/`（17 处） | Jupyter 编辑器自动生成的备份副本，与源文件重复 |
| `**/node_modules/`、`**/dist/` | 依赖与构建产物 |
| `packages/evals/SWE-bench_Verified/` | 第三方评测数据集，`.gitignore` 排除 |
| `packages/coding-agent/npm-shrinkwrap.json`、`install-lock/` | 发布用锁文件，属于 25 构建发布内容 |
| `packages/coding-agent/docs/images/` | 文档配图 |
| `references/PI_Memory*.md` | 用户自研方案，不是 pi 源码 |

## 7. 覆盖缺口

- 未分析：无。全部源文件已登记，`已分析`/`部分分析` 见第 4 节。
- 未分配课程：无。
- 待确认：无。课程 04 的 provider 工厂、动态刷新、`createProvider`、模型数量已记录在 `BUILD_PLAN.md` 决策表。

## 附录 A：测试文件全量清单

### `ai`（113）

<details><summary>展开文件列表</summary>

- `abort.test.ts`
- `anthropic-auth-token.test.ts`
- `anthropic-cache-write-1h-cost.test.ts`
- `anthropic-eager-tool-input-compat.test.ts`
- `anthropic-empty-thinking-signature-compat.test.ts`
- `anthropic-force-adaptive-thinking.test.ts`
- `anthropic-mid-conversation-effort.test.ts`
- `anthropic-oauth.test.ts`
- `anthropic-sse-parsing.test.ts`
- `anthropic-temperature-compat.test.ts`
- `anthropic-thinking-disable.test.ts`
- `anthropic-tool-name-normalization.test.ts`
- `assistant-message-frame.test.ts`
- `cache-retention.test.ts`
- `codex-websocket-cached-probe.ts`
- `compat-env.test.ts`
- `constrained-sampling.test.ts`
- `context-estimate.test.ts`
- `context-overflow.test.ts`
- `cross-provider-handoff.test.ts`
- `data/red-circle.png`
- `deferred-tools.test.ts`
- `empty.test.ts`
- `env-api-keys.test.ts`
- `error-body.test.ts`
- `event-stream.test.ts`
- `faux-provider.test.ts`
- `fetch-option.test.ts`
- `generate-models-strict.test.ts`
- `github-copilot-anthropic.test.ts`
- `github-copilot-oauth.test.ts`
- `google-raw-stop-reason.test.ts`
- `google-shared-convert-tools.test.ts`
- `google-shared-gemini3-unsigned-tool-call.test.ts`
- `google-shared-image-tool-result-routing.test.ts`
- `google-shared-retry.test.ts`
- `google-shared-signed-empty-blocks.test.ts`
- `google-thinking-disable.test.ts`
- `google-thinking-level-map.test.ts`
- `google-thinking-signature.test.ts`
- `google-vertex-api-key-resolution.test.ts`
- `image-model-data.test.ts`
- `image-tool-result.test.ts`
- `images-models.test.ts`
- `images.test.ts`
- `interleaved-thinking.test.ts`
- `kimi-coding-oauth.test.ts`
- `lax-message-content.test.ts`
- `lazy-module-load.test.ts`
- `mistral-http-transport.test.ts`
- `mistral-raw-stop-reason.test.ts`
- `mistral-reasoning-mode.test.ts`
- `mistral-tool-schema.test.ts`
- `model-catalog-types.test.ts`
- `model-data-validation.test.ts`
- `models-runtime.test.ts`
- `node-http-proxy.test.ts`
- `oauth-auth.test.ts`
- `oauth-device-code.test.ts`
- `oauth.ts`
- `openai-codex-oauth.test.ts`
- `openai-codex-stream.test.ts`
- `openai-completions-cache-control-format.test.ts`
- `openai-completions-empty-tools.test.ts`
- `openai-completions-prompt-cache.test.ts`
- `openai-completions-raw-stop-reason.test.ts`
- `openai-completions-reasoning-details.test.ts`
- `openai-completions-response-model.test.ts`
- `openai-completions-retry.test.ts`
- `openai-completions-thinking-as-text.test.ts`
- `openai-completions-thinking-token-budget.test.ts`
- `openai-completions-tool-choice.test.ts`
- `openai-completions-tool-result-images.test.ts`
- `openai-completions-vllm-priority.test.ts`
- `openai-responses-compat.test.ts`
- `openai-responses-empty-tool-result.test.ts`
- `openai-responses-foreign-toolcall-id.test.ts`
- `openai-responses-message-id.test.ts`
- `openai-responses-namespace.test.ts`
- `openai-responses-partial-json-cleanup.test.ts`
- `openai-responses-terminal-event.test.ts`
- `openai-responses-tool-result-images.test.ts`
- `openrouter-cache-control-models.test.ts`
- `openrouter-images.test.ts`
- `openrouter-oauth.test.ts`
- `openrouter-reasoning-options.test.ts`
- `overflow.test.ts`
- `pre-generation-error.test.ts`
- `provider-error-body-passthrough.test.ts`
- `provider-error-body-regression.test.ts`
- `provider-retry.test.ts`
- `providers.test.ts`
- `reasoning-options.test.ts`
- `responseid.test.ts`
- `retry.test.ts`
- `sampling-options.test.ts`
- `scratch.ts`
- `stream.test.ts`
- `supports-xhigh.test.ts`
- `text.test.ts`
- `tokens.test.ts`
- `tool-call-id-normalization.test.ts`
- `tool-call-without-result.test.ts`
- `total-tokens.test.ts`
- `transform-messages-copilot-openai-to-anthropic.test.ts`
- `unicode-surrogate.test.ts`
- `uuid.test.ts`
- `validation.test.ts`
- `xai-oauth.test.ts`
- `xai-responses.test.ts`
- `xhigh.test.ts`
- `zai-coding-plan-models.test.ts`
- `zen.test.ts`

</details>

### `agent`（7）

<details><summary>展开文件列表</summary>

- `agent-loop.test.ts`
- `agent.test.ts`
- `e2e.test.ts`
- `proxy.test.ts`
- `utils/calculate.ts`
- `utils/get-current-time.ts`
- `utils/wait-for-tick.ts`

</details>

### `tui`（49）

<details><summary>展开文件列表</summary>

- `alt-screen-large-transcript-bench.ts`
- `autocomplete.test.ts`
- `bug-regression-isimageline-startswith-bug.test.ts`
- `chat-simple.ts`
- `editor-history-keybindings.test.ts`
- `editor.test.ts`
- `fixtures/clipboard-reader.cjs`
- `fixtures/clipboard-worker-test.c`
- `fixtures/clipboard-worker-test.cjs`
- `fixtures/clipboard-x11-test.c`
- `fuzzy.test.ts`
- `image-test.ts`
- `input.test.ts`
- `key-tester.ts`
- `keybindings.test.ts`
- `keys.test.ts`
- `latex.test.ts`
- `layout.test.ts`
- `markdown.test.ts`
- `mouse-components.test.ts`
- `native-clipboard-linux.test.ts`
- `native-module-path.test.ts`
- `native-platform.test.ts`
- `overlay-non-capturing.test.ts`
- `overlay-options.test.ts`
- `overlay-short-content.test.ts`
- `regression-overlay-cjk-boundary.test.ts`
- `regression-regional-indicator-width.test.ts`
- `regression-sigwinch-kill-eacces.test.ts`
- `render-churn-bench.ts`
- `select-list.test.ts`
- `settings-list.test.ts`
- `stdin-buffer.test.ts`
- `tab-width.test.ts`
- `terminal-colors.test.ts`
- `terminal-image.test.ts`
- `terminal.test.ts`
- `test-themes.ts`
- `truncate-to-width.test.ts`
- `truncated-text.test.ts`
- `tui-alt-screen.test.ts`
- `tui-cell-size-input.test.ts`
- `tui-overlay-style-leak.test.ts`
- `tui-render.test.ts`
- `tui-shrink.test.ts`
- `viewport-overwrite-repro.ts`
- `virtual-terminal.ts`
- `word-navigation.test.ts`
- `wrap-ansi.test.ts`

</details>

### `coding-agent`（208）

<details><summary>展开文件列表</summary>

- `agent-session-auto-compaction-queue.test.ts`
- `agent-session-branching.test.ts`
- `agent-session-compaction.test.ts`
- `agent-session-concurrent.test.ts`
- `agent-session-dynamic-provider.test.ts`
- `agent-session-dynamic-tools.test.ts`
- `agent-session-retry.test.ts`
- `agent-session-runtime-events.test.ts`
- `agent-session-stats.test.ts`
- `agent-session-tree-navigation.test.ts`
- `ansi-utils.test.ts`
- `args.test.ts`
- `assistant-message.test.ts`
- `auth-check.test.ts`
- `auth-storage.test.ts`
- `bash-close-hang-windows.test.ts`
- `bash-execution-width.test.ts`
- `block-images.test.ts`
- `branch-summarization.test.ts`
- `branch-summary-extensions.test.ts`
- `builtin-tool-strict-mode.test.ts`
- `cache-stats.test.ts`
- `changelog.test.ts`
- `chat-viewport.test.ts`
- `clipboard-command.test.ts`
- `clipboard-image-bmp-conversion.test.ts`
- `clipboard-image-native-errors.test.ts`
- `clipboard-image.test.ts`
- `clipboard.test.ts`
- `compaction-extensions-example.test.ts`
- `compaction-extensions.test.ts`
- `compaction-serialization.test.ts`
- `compaction-summary-reasoning.test.ts`
- `compaction.test.ts`
- `config-value-migration.test.ts`
- `config.test.ts`
- `credential-print.test.ts`
- `custom-editor-history-keybindings.test.ts`
- `custom-message.test.ts`
- `default-tools-setting.test.ts`
- `edit-tool-legacy-input.test.ts`
- `edit-tool-no-full-redraw.test.ts`
- `experimental.test.ts`
- `export-html-skill-block.test.ts`
- `export-html-whitespace.test.ts`
- `export-html-xss.test.ts`
- `extensions-discovery.test.ts`
- `extensions-input-event.test.ts`
- `extensions-runner.test.ts`
- `external-editor.test.ts`
- `file-mutation-queue.test.ts`
- `first-time-setup-fork.test.ts`
- `first-time-setup.test.ts`
- `fixtures/assistant-message-with-thinking-code.json`
- `fixtures/before-compaction.jsonl`
- `fixtures/empty-agent/.gitkeep`
- `fixtures/empty-cwd/.gitkeep`
- `fixtures/fake-external-editor.mjs`
- `fixtures/large-session.jsonl`
- `fixtures/skills-collision/first/calendar/SKILL.md`
- `fixtures/skills-collision/second/calendar/SKILL.md`
- `fixtures/skills/consecutive-hyphens/SKILL.md`
- `fixtures/skills/disable-model-invocation/SKILL.md`
- `fixtures/skills/invalid-name-chars/SKILL.md`
- `fixtures/skills/invalid-yaml/SKILL.md`
- `fixtures/skills/long-name/SKILL.md`
- `fixtures/skills/missing-description/SKILL.md`
- `fixtures/skills/multiline-description/SKILL.md`
- `fixtures/skills/name-mismatch/SKILL.md`
- `fixtures/skills/nested/child-skill/SKILL.md`
- `fixtures/skills/no-frontmatter/SKILL.md`
- `fixtures/skills/root-skill-preferred/SKILL.md`
- `fixtures/skills/root-skill-preferred/nested-child/SKILL.md`
- `fixtures/skills/unknown-field/SKILL.md`
- `fixtures/skills/valid-skill/SKILL.md`
- `footer-data-provider.test.ts`
- `footer-width.test.ts`
- `format-resume-command.test.ts`
- `frontmatter.test.ts`
- `git-merge-and-resolve-extension.test.ts`
- `git-ssh-url.test.ts`
- `git-update.test.ts`
- `http-dispatcher.test.ts`
- `image-process.test.ts`
- `image-processing.test.ts`
- `image-resize-callers.test.ts`
- `initial-message.test.ts`
- `input-transform-streaming-example.test.ts`
- `interactive-mode-anthropic-warning.test.ts`
- `interactive-mode-assistant-diagnostics.test.ts`
- `interactive-mode-clone-command.test.ts`
- `interactive-mode-compaction.test.ts`
- `interactive-mode-import-command.test.ts`
- `interactive-mode-startup-input.test.ts`
- `interactive-mode-status.test.ts`
- `interactive-mode-suspend.test.ts`
- `interactive-mode-tree-navigation.test.ts`
- `interactive-tui.test.ts`
- `keybindings-migration.test.ts`
- `keybindings.test.ts`
- `llama-extension.test.ts`
- `management-http.test.ts`
- `memory/config.test.ts`
- `memory/display.test.ts`
- `memory/extension.test.ts`
- `memory/extractor.test.ts`
- `memory/harness.test.ts`
- `memory/online.test.ts`
- `memory/prompt.test.ts`
- `memory/retriever.test.ts`
- `memory/span.test.ts`
- `memory/store.test.ts`
- `memory/test-helpers.ts`
- `mermaid.test.ts`
- `model-catalog-refresh.test.ts`
- `model-registry.test.ts`
- `model-resolver.test.ts`
- `model-runtime-auth-options.test.ts`
- `model-runtime-credential-sync.test.ts`
- `model-runtime-modify-models-compat.test.ts`
- `model-runtime-test-utils.ts`
- `model-selector.test.ts`
- `models-store.test.ts`
- `oauth-selector.test.ts`
- `package-command-paths.test.ts`
- `package-distribution.test.ts`
- `package-manager-ssh.test.ts`
- `package-manager.test.ts`
- `path-utils.test.ts`
- `paths.test.ts`
- `pi-user-agent.test.ts`
- `plan-mode-extension.test.ts`
- `plan-mode-utils.test.ts`
- `powershell-tool.test.ts`
- `print-mode.test.ts`
- `prompt-templates.test.ts`
- `remote-catalog-provider.test.ts`
- `resolve-config-value.test.ts`
- `resource-loader.test.ts`
- `restore-sandbox-env.test.ts`
- `rpc-client-clear-queue.test.ts`
- `rpc-client-clone.test.ts`
- `rpc-client-process-exit.test.ts`
- `rpc-example.ts`
- `rpc-jsonl.test.ts`
- `rpc-prompt-response-semantics.test.ts`
- `rpc.test.ts`
- `runtime-credentials.test.ts`
- `scoped-models-selector.test.ts`
- `sdk-codex-cache-probe-tool-loop.ts`
- `sdk-openrouter-attribution.test.ts`
- `sdk-session-manager.test.ts`
- `sdk-skills.test.ts`
- `sdk-stream-options.test.ts`
- `session-cwd.test.ts`
- `session-file-invalid.test.ts`
- `session-id-readonly.test.ts`
- `session-info-modified-timestamp.test.ts`
- `session-manager/build-context.test.ts`
- `session-manager/custom-session-id.test.ts`
- `session-manager/file-operations.test.ts`
- `session-manager/load-entries.test.ts`
- `session-manager/migration.test.ts`
- `session-manager/save-entry.test.ts`
- `session-manager/tree-traversal.test.ts`
- `session-selector-path-delete.test.ts`
- `session-selector-rename.test.ts`
- `session-selector-search.test.ts`
- `session-share.test.ts`
- `settings-diagnostics.test.ts`
- `settings-manager-bug.test.ts`
- `settings-manager.test.ts`
- `settings-selector.test.ts`
- `skills.test.ts`
- `startup-session-name.test.ts`
- `status-indicator.test.ts`
- `stdout-cleanliness.test.ts`
- `streaming-render-debug.ts`
- `suite/README.md`
- `suite/agent-session-bash-persistence.test.ts`
- `suite/agent-session-compaction.test.ts`
- `suite/agent-session-model-extension.test.ts`
- `suite/agent-session-prompt.test.ts`
- `suite/agent-session-queue.test.ts`
- `suite/agent-session-retry-events.test.ts`
- `suite/agent-session-runtime.test.ts`
- `suite/agent-session-tool-result-images.test.ts`
- `suite/harness.ts`
- `suite/lax-message-content.test.ts`
- `syntax-highlight.test.ts`
- `system-prompt.test.ts`
- `test-harness.test.ts`
- `test-harness.ts`
- `test-network-env.ts`
- `thinking-selector.test.ts`
- `tool-execution-component.test.ts`
- `tool-result-images.test.ts`
- `tool-system-prompt-contributions.test.ts`
- `tools-manager.test.ts`
- `tools.test.ts`
- `tree-selector.test.ts`
- `trigger-compact-extension.test.ts`
- `truncate-to-width.test.ts`
- `trust-manager.test.ts`
- `trust-selector.test.ts`
- `user-message.test.ts`
- `utilities.ts`
- `version-check.test.ts`

</details>

### `evals`（5）

<details><summary>展开文件列表</summary>

- `docs-catalog.test.ts`
- `pi-harness.test.ts`
- `vitest-evals/artifacts.test.ts`
- `vitest-evals/harness-table.test.ts`
- `vitest-evals/summary.test.ts`

</details>

