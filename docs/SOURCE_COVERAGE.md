# 源码覆盖清单（SOURCE_COVERAGE）

本清单登记 `my-pi/`（`@earendil-works/pi-*` 0.85.1）工作树中所有与复现相关的内容，用于证明教学路线没有遗漏源码功能。

## 0. 登记口径

| 类别 | 粒度 | 说明 |
| --- | --- | --- |
| `packages/*/src` | **逐文件** | 每个 `.ts` 一行；生成文件单独列出，不进入教学覆盖面统计 |
| `packages/*/test` | 按目录分组 | 测试文件数量大，按包/子目录登记，附录列出全部文件名；教学文档在对应模块中引用代表性测试 |
| `packages/coding-agent/docs` | 逐文件 | 原项目自带文档，作为概念校准来源 |
| `packages/coding-agent/examples` | 按示例目录分组 | 145 个文件，按扩展/示例类型登记 |
| `scripts/`、`.github/`、根配置 | 逐文件 | 构建、发布、CI 等工程设施 |
| 生成物 / 依赖 / 编辑器残留 | 单列 | `.ipynb_checkpoints`、`dist`、`node_modules`、`providers/data` 等，说明排除原因 |

状态含义：`已分析` = 首批文档已逐段阅读；`部分分析` = 已阅读关键实现但未全文；`已登记` = 已纳入路线，尚未深读。

## 1. 总览

- 参与教学的源文件：**373** 个（不含生成文件）
- 源文件总行数：**100475** 行
- 生成文件：**30** 个（不计入覆盖分母）
- 非 TS 资源：**37** 个（29 个生成数据 + 8 个模板/主题/素材）
- 测试文件：**382** 个

| 包 | 源文件 | 行数 | 职责 |
| --- | ---: | ---: | --- |
| `ai` | 112 | 19699 | 统一 LLM API：类型、模型目录、流式协议、API 适配器、认证、图像 |
| `agent` | 6 | 2206 | Agent 循环、状态机、工具执行、事件协议 |
| `tui` | 42 | 18107 | 终端渲染框架、布局、组件、编辑器 |
| `coding-agent` | 203 | 59050 | CLI 产品层：会话、工具、模式、扩展、压缩、配置 |
| `evals` | 10 | 1413 | 文档与扩展的冒烟评测 |

## 2. 逐文件登记

### 2.1 `packages/ai/src`（112 文件 / 19699 行）

| 文件 | 行数 | 模块 | 教学文档 | 状态 |
| --- | ---: | --- | --- | --- |
| `api/anthropic-messages.lazy.ts` | 4 | API 适配器 | D06 | 已登记 |
| `api/anthropic-messages.ts` | 1489 | API 适配器 | D06 | 已登记 |
| `api/constrained-sampling.ts` | 277 | API 适配器 | D06 | 已登记 |
| `api/github-copilot-headers.ts` | 37 | API 适配器 | D06 | 已登记 |
| `api/google-generative-ai.lazy.ts` | 4 | API 适配器 | D06 | 已登记 |
| `api/google-generative-ai.ts` | 526 | API 适配器 | D06 | 已登记 |
| `api/google-shared.ts` | 452 | API 适配器 | D06 | 已登记 |
| `api/google-vertex.lazy.ts` | 4 | API 适配器 | D06 | 已登记 |
| `api/google-vertex.ts` | 598 | API 适配器 | D06 | 已登记 |
| `api/lazy.ts` | 98 | 流式协议 | D03 | 已分析 |
| `api/mistral-conversations.lazy.ts` | 4 | API 适配器 | D06 | 已登记 |
| `api/mistral-conversations.ts` | 936 | API 适配器 | D06 | 已登记 |
| `api/openai-codex-responses.lazy.ts` | 4 | API 适配器 | D06 | 已登记 |
| `api/openai-codex-responses.ts` | 1653 | API 适配器 | D06 | 已登记 |
| `api/openai-completions.lazy.ts` | 4 | API 适配器 | D05 | 已登记 |
| `api/openai-completions.ts` | 1667 | API 适配器 | D05 | 部分分析 |
| `api/openai-prompt-cache.ts` | 8 | API 适配器 | D06 | 已登记 |
| `api/openai-responses-shared.ts` | 793 | API 适配器 | D06 | 已登记 |
| `api/openai-responses.lazy.ts` | 4 | API 适配器 | D06 | 已登记 |
| `api/openai-responses.ts` | 390 | API 适配器 | D06 | 已登记 |
| `api/openrouter-images.lazy.ts` | 10 | 图像生成 | D08 | 已登记 |
| `api/openrouter-images.ts` | 196 | 图像生成 | D08 | 已登记 |
| `api/simple-options.ts` | 94 | API 适配器 | D06 | 已登记 |
| `api/transform-messages.ts` | 223 | API 适配器 | D06 | 已分析 |
| `auth/context.ts` | 45 | 认证与凭据 | D07 | 已登记 |
| `auth/credential-store.ts` | 67 | 认证与凭据 | D07 | 已登记 |
| `auth/helpers.ts` | 59 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/anthropic.ts` | 364 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/device-code.ts` | 98 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/github-copilot.ts` | 507 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/kimi-coding.ts` | 296 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/load.ts` | 58 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/oauth-page.ts` | 109 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/openai-codex.ts` | 544 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/openrouter.ts` | 311 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/pkce.ts` | 34 | 认证与凭据 | D07 | 已登记 |
| `auth/oauth/xai.ts` | 239 | 认证与凭据 | D07 | 已登记 |
| `auth/resolve.ts` | 205 | 认证与凭据 | D07 | 已登记 |
| `auth/types.ts` | 240 | 认证与凭据 | D07 | 已登记 |
| `bun-oauth.ts` | 19 | 认证与凭据 | D07 | 已登记 |
| `cli.ts` | 119 | 认证与凭据 | D07 | 已登记 |
| `compat.ts` | 278 | Provider 注册表 | D04 | 已登记 |
| `compat/extension-oauth-types.ts` | 45 | 认证与凭据 | D07 | 已登记 |
| `env-api-keys.ts` | 156 | 认证与凭据 | D07 | 已登记 |
| `image-models.ts` | 42 | 图像生成 | D08 | 已登记 |
| `images-api-registry.ts` | 53 | 图像生成 | D08 | 已登记 |
| `images-models.ts` | 275 | 图像生成 | D08 | 已登记 |
| `images.ts` | 21 | 图像生成 | D08 | 已登记 |
| `index.ts` | 45 | 公共导出面 | D02 | 部分分析 |
| `legacy-api-aliases.ts` | 94 | Provider 注册表 | D04 | 已登记 |
| `model-catalog.ts` | 27 | Provider 注册表 | D04 | 已登记 |
| `models-store.ts` | 45 | Provider 注册表 | D04 | 已登记 |
| `models.ts` | 957 | Provider 注册表 | D04 | 部分分析 |
| `oauth.ts` | 10 | 认证与凭据 | D07 | 已登记 |
| `providers/all.ts` | 127 | Provider 与模型目录 | D04 | 已登记 |
| `providers/anthropic.ts` | 59 | Provider 与模型目录 | D04 | 已登记 |
| `providers/data-json.d.ts` | 4 | Provider 与模型目录 | D04 | 已登记 |
| `providers/deepseek.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/faux.ts` | 708 | Provider 与模型目录 | D04 | 部分分析 |
| `providers/github-copilot.ts` | 34 | Provider 与模型目录 | D04 | 已登记 |
| `providers/google-vertex.ts` | 100 | Provider 与模型目录 | D04 | 已登记 |
| `providers/google.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/groq.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/images/register-builtins.ts` | 50 | 图像生成 | D08 | 已登记 |
| `providers/kimi-coding.ts` | 24 | Provider 与模型目录 | D04 | 已登记 |
| `providers/minimax-cn.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/minimax.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/mistral.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/moonshotai-cn.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/moonshotai.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/openai-codex.ts` | 22 | Provider 与模型目录 | D04 | 已登记 |
| `providers/openai.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/opencode-go.ts` | 24 | Provider 与模型目录 | D04 | 已登记 |
| `providers/opencode.ts` | 24 | Provider 与模型目录 | D04 | 已登记 |
| `providers/openrouter-images.ts` | 22 | Provider 与模型目录 | D04 | 已登记 |
| `providers/openrouter.ts` | 27 | Provider 与模型目录 | D04 | 已登记 |
| `providers/qwen-token-plan-cn.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/qwen-token-plan-individual.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/qwen-token-plan.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/vercel-ai-gateway.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/xai.ts` | 24 | Provider 与模型目录 | D04 | 已登记 |
| `providers/xiaomi-token-plan-ams.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/xiaomi-token-plan-cn.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/xiaomi-token-plan-sgp.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/xiaomi.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/zai-coding-cn.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `providers/zai.ts` | 15 | Provider 与模型目录 | D04 | 已登记 |
| `session-resources.ts` | 24 | 会话资源 | D14 | 已登记 |
| `types.ts` | 843 | 类型系统 | D02 | 已分析 |
| `utils/abort-signals.ts` | 41 | 请求基础设施 | D06 | 已登记 |
| `utils/abort.ts` | 50 | 请求基础设施 | D06 | 已登记 |
| `utils/assistant-message-frame.ts` | 490 | 流式协议 | D03 | 已登记 |
| `utils/deferred-tools.ts` | 39 | 请求基础设施 | D06 | 已登记 |
| `utils/diagnostics.ts` | 45 | 请求基础设施 | D06 | 已登记 |
| `utils/error-body.ts` | 149 | 请求基础设施 | D06 | 已登记 |
| `utils/estimate.ts` | 143 | 上下文压缩 | D16 | 已登记 |
| `utils/event-stream.ts` | 110 | 流式协议 | D03 | 已分析 |
| `utils/hash.ts` | 13 | 通用工具 | D02 | 已登记 |
| `utils/headers.ts` | 18 | 请求基础设施 | D06 | 已登记 |
| `utils/json-parse.ts` | 124 | 流式协议 | D03 | 已分析 |
| `utils/node-http-proxy.ts` | 161 | 请求基础设施 | D06 | 已登记 |
| `utils/overflow.ts` | 183 | 上下文压缩 | D16 | 已登记 |
| `utils/pi-user-agent.ts` | 19 | 请求基础设施 | D06 | 已登记 |
| `utils/provider-env.ts` | 52 | 请求基础设施 | D06 | 已登记 |
| `utils/provider-retry.ts` | 125 | 请求基础设施 | D06 | 已登记 |
| `utils/retry.ts` | 229 | 请求重试 | D06 | 已登记 |
| `utils/sanitize-unicode.ts` | 25 | 请求基础设施 | D06 | 已登记 |
| `utils/sleep.ts` | 14 | 通用工具 | D02 | 已登记 |
| `utils/text.ts` | 12 | 通用工具 | D02 | 已登记 |
| `utils/typebox-helpers.ts` | 24 | 通用工具 | D02 | 已登记 |
| `utils/uuid.ts` | 45 | 通用工具 | D02 | 已登记 |
| `utils/validation.ts` | 350 | 工具参数校验 | D11 | 已分析 |

### 2.2 `packages/agent/src`（6 文件 / 2206 行）

| 文件 | 行数 | 模块 | 教学文档 | 状态 |
| --- | ---: | --- | --- | --- |
| `agent-loop.ts` | 725 | Agent 循环 | D09 | 部分分析 |
| `agent.ts` | 617 | Agent 状态机 | D10 | 部分分析 |
| `index.ts` | 5 | 公共导出面 | D00 | 已登记 |
| `proxy.ts` | 402 | Agent 状态机 | D10 | 已登记 |
| `stream-fn.ts` | 20 | Agent 循环 | D09 | 已登记 |
| `types.ts` | 437 | Agent 类型与事件 | D09 | 部分分析 |

### 2.3 `packages/tui/src`（42 文件 / 18107 行）

| 文件 | 行数 | 模块 | 教学文档 | 状态 |
| --- | ---: | --- | --- | --- |
| `alt-screen-search.ts` | 327 | 终端与渲染内核 | D22 | 已登记 |
| `autocomplete.ts` | 826 | 编辑器与组件 | D23 | 已登记 |
| `components/alt-screen-flash.ts` | 51 | TUI 组件 | D23 | 已登记 |
| `components/box.ts` | 167 | TUI 组件 | D23 | 已登记 |
| `components/cancellable-loader.ts` | 40 | TUI 组件 | D23 | 已登记 |
| `components/editor.ts` | 2461 | TUI 组件 | D23 | 已登记 |
| `components/h-stack.ts` | 44 | TUI 组件 | D23 | 已登记 |
| `components/image.ts` | 127 | TUI 组件 | D23 | 已登记 |
| `components/input.ts` | 494 | TUI 组件 | D23 | 已登记 |
| `components/loader.ts` | 101 | TUI 组件 | D23 | 已登记 |
| `components/markdown.ts` | 1015 | TUI 组件 | D23 | 已登记 |
| `components/mouse-region.ts` | 33 | TUI 组件 | D23 | 已登记 |
| `components/scroll-view.ts` | 224 | TUI 组件 | D23 | 已登记 |
| `components/select-list.ts` | 273 | TUI 组件 | D23 | 已登记 |
| `components/settings-list.ts` | 328 | TUI 组件 | D23 | 已登记 |
| `components/spacer.ts` | 28 | TUI 组件 | D23 | 已登记 |
| `components/stack.ts` | 154 | TUI 组件 | D23 | 已登记 |
| `components/text.ts` | 107 | TUI 组件 | D23 | 已登记 |
| `components/truncated-text.ts` | 65 | TUI 组件 | D23 | 已登记 |
| `components/v-stack.ts` | 33 | TUI 组件 | D23 | 已登记 |
| `editor-component.ts` | 74 | 编辑器与组件 | D23 | 已登记 |
| `fuzzy.ts` | 137 | 编辑器与组件 | D23 | 已登记 |
| `index.ts` | 156 | 公共导出面 | D22 | 已登记 |
| `keybindings.ts` | 320 | 终端与渲染内核 | D22 | 已登记 |
| `keys.ts` | 1401 | 终端与渲染内核 | D22 | 已登记 |
| `kill-ring.ts` | 46 | 编辑器与组件 | D23 | 已登记 |
| `latex.ts` | 1394 | 编辑器与组件 | D23 | 已登记 |
| `layout-node.ts` | 51 | 终端与渲染内核 | D22 | 已登记 |
| `layout.ts` | 449 | 终端与渲染内核 | D22 | 已登记 |
| `native-modifiers.ts` | 13 | 原生模块 | D25 | 已登记 |
| `native-module-path.ts` | 31 | 原生模块 | D25 | 已登记 |
| `native-platform.ts` | 63 | 原生模块 | D25 | 已登记 |
| `stdin-buffer.ts` | 444 | 终端与渲染内核 | D22 | 已登记 |
| `terminal-colors.ts` | 73 | 终端与渲染内核 | D22 | 已登记 |
| `terminal-image.ts` | 696 | 终端图像 | D23 | 已登记 |
| `terminal.ts` | 547 | 终端与渲染内核 | D22 | 已登记 |
| `tui-alt-screen.ts` | 1721 | 终端与渲染内核 | D22 | 已登记 |
| `tui-main-screen.ts` | 655 | 终端与渲染内核 | D22 | 已登记 |
| `tui.ts` | 1456 | 终端与渲染内核 | D22 | 已登记 |
| `undo-stack.ts` | 28 | 编辑器与组件 | D23 | 已登记 |
| `utils.ts` | 1337 | 终端与渲染内核 | D22 | 已登记 |
| `word-navigation.ts` | 117 | 编辑器与组件 | D23 | 已登记 |

### 2.4 `packages/coding-agent/src`（203 文件 / 59050 行）

| 文件 | 行数 | 模块 | 教学文档 | 状态 |
| --- | ---: | --- | --- | --- |
| `bun/cli.ts` | 4 | Bun 运行时适配 | D25 | 已登记 |
| `bun/restore-sandbox-env.ts` | 36 | Bun 运行时适配 | D25 | 已登记 |
| `bun/runtime-setup.ts` | 6 | Bun 运行时适配 | D25 | 已登记 |
| `bun/sandbox-env-setup.ts` | 4 | Bun 运行时适配 | D25 | 已登记 |
| `cli.ts` | 24 | CLI 启动 | D17 | 已登记 |
| `cli/args.ts` | 426 | CLI 启动 | D17 | 已登记 |
| `cli/auth-check.ts` | 73 | CLI 启动 | D17 | 已登记 |
| `cli/auth-command.ts` | 126 | CLI 启动 | D17 | 已登记 |
| `cli/config-selector.ts` | 59 | CLI 启动 | D17 | 已登记 |
| `cli/credential-print.ts` | 87 | CLI 启动 | D17 | 已登记 |
| `cli/file-processor.ts` | 113 | CLI 启动 | D17 | 已登记 |
| `cli/initial-message.ts` | 43 | CLI 启动 | D17 | 已登记 |
| `cli/list-models.ts` | 115 | CLI 启动 | D17 | 已登记 |
| `cli/project-trust.ts` | 62 | CLI 启动 | D17 | 已登记 |
| `cli/session-picker.ts` | 55 | CLI 启动 | D17 | 已登记 |
| `cli/startup-ui.ts` | 188 | CLI 启动 | D17 | 已登记 |
| `config.ts` | 576 | 配置与信任 | D17 | 已登记 |
| `core/agent-session-runtime.ts` | 449 | 会话编排 | D18 | 已登记 |
| `core/agent-session-services.ts` | 317 | 会话编排 | D18 | 已登记 |
| `core/agent-session.ts` | 3529 | 会话编排 | D18 | 已登记 |
| `core/auth-guidance.ts` | 25 | 认证与凭据 | D07 | 已登记 |
| `core/auth-storage.ts` | 506 | 认证与凭据 | D07 | 已登记 |
| `core/bash-executor.ts` | 156 | 内置工具 | D12 | 已登记 |
| `core/cache-stats.ts` | 164 | 会话编排 | D18 | 已登记 |
| `core/compaction/branch-summarization.ts` | 367 | 上下文压缩 | D16 | 已登记 |
| `core/compaction/compaction.ts` | 987 | 上下文压缩 | D16 | 已登记 |
| `core/compaction/index.ts` | 7 | 上下文压缩 | D16 | 已登记 |
| `core/compaction/utils.ts` | 175 | 上下文压缩 | D16 | 已登记 |
| `core/defaults.ts` | 12 | 配置与信任 | D17 | 已登记 |
| `core/diagnostics.ts` | 15 | 工程与诊断 | D25 | 已登记 |
| `core/event-bus.ts` | 33 | 会话编排 | D18 | 已登记 |
| `core/exec.ts` | 107 | 内置工具 | D12 | 已登记 |
| `core/experimental.ts` | 3 | 工程与诊断 | D25 | 已登记 |
| `core/export-html/ansi-to-html.ts` | 258 | 会话导出 | D24 | 已登记 |
| `core/export-html/index.ts` | 316 | 会话导出 | D24 | 已登记 |
| `core/export-html/tool-renderer.ts` | 172 | 会话导出 | D24 | 已登记 |
| `core/extensions/index.ts` | 192 | 扩展系统 | D21 | 已登记 |
| `core/extensions/loader.ts` | 798 | 扩展系统 | D21 | 已登记 |
| `core/extensions/runner.ts` | 1277 | 扩展系统 | D21 | 已登记 |
| `core/extensions/types.ts` | 1777 | 扩展系统 | D21 | 已登记 |
| `core/extensions/wrapper.ts` | 45 | 扩展系统 | D21 | 已登记 |
| `core/footer-data-provider.ts` | 388 | 会话编排 | D18 | 已登记 |
| `core/http-dispatcher.ts` | 191 | 工程与诊断 | D25 | 已登记 |
| `core/index.ts` | 80 | 工程与诊断 | D25 | 已登记 |
| `core/keybindings.ts` | 384 | 交互模式 | D24 | 已登记 |
| `core/messages.ts` | 195 | 会话持久化 | D14 | 已登记 |
| `core/model-config.ts` | 299 | 模型运行时 | D19 | 已登记 |
| `core/model-registry.ts` | 173 | 模型运行时 | D19 | 已登记 |
| `core/model-resolver.ts` | 770 | 模型运行时 | D19 | 已登记 |
| `core/model-runtime.ts` | 772 | 模型运行时 | D19 | 已登记 |
| `core/models-store.ts` | 147 | 模型运行时 | D19 | 已登记 |
| `core/output-guard.ts` | 108 | 会话编排 | D18 | 已登记 |
| `core/package-manager.ts` | 2636 | 扩展与包管理 | D21 | 已登记 |
| `core/pi-manifest.ts` | 34 | 扩展与包管理 | D21 | 已登记 |
| `core/project-trust.ts` | 96 | 配置与信任 | D17 | 已登记 |
| `core/prompt-templates.ts` | 285 | 提示与上下文装载 | D15 | 已登记 |
| `core/provider-attribution.ts` | 69 | 模型运行时 | D19 | 已登记 |
| `core/provider-composer.ts` | 577 | 模型运行时 | D19 | 已登记 |
| `core/remote-catalog-provider.ts` | 137 | 模型运行时 | D19 | 已登记 |
| `core/resolve-config-value.ts` | 287 | 配置与信任 | D17 | 已登记 |
| `core/resource-loader.ts` | 921 | 提示与上下文装载 | D15 | 已登记 |
| `core/runtime-credentials.ts` | 52 | 认证与凭据 | D07 | 已登记 |
| `core/sdk.ts` | 410 | 会话编排 | D18 | 已登记 |
| `core/session-cwd.ts` | 60 | 会话持久化 | D14 | 已登记 |
| `core/session-export.ts` | 42 | 会话持久化 | D14 | 已登记 |
| `core/session-manager.ts` | 1642 | 会话持久化 | D14 | 已登记 |
| `core/settings-diagnostics.ts` | 25 | 配置与信任 | D17 | 已登记 |
| `core/settings-manager.ts` | 1389 | 配置与信任 | D17 | 已登记 |
| `core/skills.ts` | 509 | 提示与上下文装载 | D15 | 已登记 |
| `core/slash-commands.ts` | 43 | 会话编排 | D18 | 已登记 |
| `core/source-info.ts` | 40 | 模型运行时 | D19 | 已登记 |
| `core/system-prompt.ts` | 149 | 提示与上下文装载 | D15 | 已登记 |
| `core/telemetry.ts` | 13 | 会话编排 | D18 | 已登记 |
| `core/timings.ts` | 50 | 工程与诊断 | D25 | 已登记 |
| `core/tools/bash.ts` | 400 | 内置工具 | D12 | 已登记 |
| `core/tools/edit-diff.ts` | 556 | 工具治理 | D13 | 已登记 |
| `core/tools/edit.ts` | 220 | 内置工具 | D12 | 已登记 |
| `core/tools/file-mutation-queue.ts` | 61 | 工具治理 | D13 | 已登记 |
| `core/tools/find.ts` | 318 | 内置工具 | D12 | 已登记 |
| `core/tools/grep.ts` | 323 | 内置工具 | D12 | 已登记 |
| `core/tools/index.ts` | 224 | 工具治理 | D13 | 已登记 |
| `core/tools/ls.ts` | 175 | 内置工具 | D12 | 已登记 |
| `core/tools/output-accumulator.ts` | 222 | 工具治理 | D13 | 已登记 |
| `core/tools/path-utils.ts` | 118 | 工具治理 | D13 | 已登记 |
| `core/tools/powershell.ts` | 67 | 内置工具 | D12 | 已登记 |
| `core/tools/read.ts` | 205 | 内置工具 | D12 | 已登记 |
| `core/tools/render-utils.ts` | 85 | 工具治理 | D13 | 已登记 |
| `core/tools/renderers/bash.ts` | 163 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/edit.ts` | 238 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/find.ts` | 77 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/grep.ts` | 82 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/index.ts` | 63 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/ls.ts` | 70 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/read.ts` | 175 | 工具渲染 | D23 | 已登记 |
| `core/tools/renderers/write.ts` | 181 | 工具渲染 | D23 | 已登记 |
| `core/tools/tool-definition-wrapper.ts` | 47 | 工具治理 | D13 | 已登记 |
| `core/tools/truncate.ts` | 276 | 工具治理 | D13 | 已登记 |
| `core/tools/write.ts` | 97 | 内置工具 | D12 | 已登记 |
| `core/trust-manager.ts` | 244 | 配置与信任 | D17 | 已登记 |
| `core/usage-totals.ts` | 70 | 会话编排 | D18 | 已登记 |
| `extensions/index.ts` | 4 | 本地模型接入 | D19 | 已登记 |
| `extensions/llama/client.ts` | 343 | 本地模型接入 | D19 | 已登记 |
| `extensions/llama/huggingface.ts` | 158 | 本地模型接入 | D19 | 已登记 |
| `extensions/llama/index.ts` | 230 | 本地模型接入 | D19 | 已登记 |
| `extensions/llama/provider.ts` | 180 | 本地模型接入 | D19 | 已登记 |
| `extensions/llama/ui.ts` | 542 | 本地模型接入 | D19 | 已登记 |
| `index.ts` | 421 | SDK 导出面 | D18 | 已登记 |
| `main.ts` | 1120 | CLI 启动 | D17 | 已登记 |
| `migrations.ts` | 315 | 配置与信任 | D17 | 已登记 |
| `modes/index.ts` | 16 | 运行模式 | D20 | 已登记 |
| `modes/interactive/chat-viewport.ts` | 46 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/armin.ts` | 382 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/assistant-message.ts` | 202 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/bash-execution.ts` | 220 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/bordered-loader.ts` | 68 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/branch-summary-message.ts` | 58 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/compaction-summary-message.ts` | 59 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/config-selector.ts` | 935 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/countdown-timer.ts` | 39 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/custom-editor.ts` | 148 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/custom-entry.ts` | 62 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/custom-message.ts` | 113 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/daxnuts.ts` | 164 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/diff.ts` | 147 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/dynamic-border.ts` | 25 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/extension-editor.ts` | 132 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/extension-input.ts` | 87 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/extension-selector.ts` | 112 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/first-time-setup.ts` | 145 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/footer.ts` | 245 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/index.ts` | 37 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/keybinding-hints.ts` | 48 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/login-dialog.ts` | 233 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/markdown-transform.ts` | 29 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/mermaid.ts` | 89 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/model-selector.ts` | 421 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/oauth-selector.ts` | 214 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/scoped-models-selector.ts` | 401 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/session-selector-search.ts` | 194 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/session-selector.ts` | 1031 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/settings-selector.ts` | 943 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/settings-submenu.ts` | 258 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/show-images-selector.ts` | 50 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/skill-invocation-message.ts` | 55 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/status-indicator.ts` | 123 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/thinking-selector.ts` | 154 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/tool-execution.ts` | 421 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/tree-selector.ts` | 1247 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/trust-selector.ts` | 134 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/user-message-selector.ts` | 155 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/user-message.ts` | 70 | 交互模式 | D24 | 已登记 |
| `modes/interactive/components/visual-truncate.ts` | 50 | 交互模式 | D24 | 已登记 |
| `modes/interactive/external-editor.ts` | 46 | 交互模式 | D24 | 已登记 |
| `modes/interactive/interactive-mode.ts` | 6533 | 交互模式 | D24 | 已登记 |
| `modes/interactive/model-catalog-refresh.ts` | 51 | 交互模式 | D24 | 已登记 |
| `modes/interactive/model-search.ts` | 21 | 交互模式 | D24 | 已登记 |
| `modes/interactive/session-share.ts` | 111 | 交互模式 | D24 | 已登记 |
| `modes/interactive/theme/theme-controller.ts` | 88 | 交互模式 | D24 | 已登记 |
| `modes/interactive/theme/theme.ts` | 887 | 交互模式 | D24 | 已登记 |
| `modes/interactive/tui-renderer.ts` | 79 | 交互模式 | D24 | 已登记 |
| `modes/json-event.ts` | 61 | 运行模式 | D20 | 已登记 |
| `modes/print-mode.ts` | 168 | 运行模式 | D20 | 已登记 |
| `modes/rpc/jsonl.ts` | 58 | 运行模式 | D20 | 已登记 |
| `modes/rpc/rpc-client.ts` | 609 | 运行模式 | D20 | 已登记 |
| `modes/rpc/rpc-mode.ts` | 807 | 运行模式 | D20 | 已登记 |
| `modes/rpc/rpc-types.ts` | 297 | 运行模式 | D20 | 已登记 |
| `package-manager-cli.ts` | 1102 | 扩展与包管理 | D21 | 已登记 |
| `rpc-entry.ts` | 13 | 运行模式 | D20 | 已登记 |
| `utils/abort.ts` | 48 | 通用工具 | D25 | 已登记 |
| `utils/ansi.ts` | 60 | 渲染工具 | D23 | 已登记 |
| `utils/changelog.ts` | 196 | 通用工具 | D25 | 已登记 |
| `utils/child-process.ts` | 137 | 内置工具 | D12 | 已登记 |
| `utils/clipboard-command.ts` | 44 | 剪贴板与图像 | D24 | 已登记 |
| `utils/clipboard-image.ts` | 259 | 剪贴板与图像 | D24 | 已登记 |
| `utils/clipboard.ts` | 77 | 剪贴板与图像 | D24 | 已登记 |
| `utils/deprecation.ts` | 14 | 通用工具 | D25 | 已登记 |
| `utils/exif-orientation.ts` | 182 | 剪贴板与图像 | D24 | 已登记 |
| `utils/frontmatter.ts` | 40 | 通用工具 | D25 | 已登记 |
| `utils/fs-watch.ts` | 30 | 通用工具 | D25 | 已登记 |
| `utils/git.ts` | 226 | 会话与分支 | D14 | 已登记 |
| `utils/highlight-js.d.ts` | 36 | 渲染工具 | D23 | 已登记 |
| `utils/html.ts` | 51 | 渲染工具 | D23 | 已登记 |
| `utils/image-convert.ts` | 49 | 剪贴板与图像 | D24 | 已登记 |
| `utils/image-process.ts` | 119 | 剪贴板与图像 | D24 | 已登记 |
| `utils/image-resize-core.ts` | 164 | 剪贴板与图像 | D24 | 已登记 |
| `utils/image-resize-worker.ts` | 42 | 剪贴板与图像 | D24 | 已登记 |
| `utils/image-resize.ts` | 123 | 剪贴板与图像 | D24 | 已登记 |
| `utils/json.ts` | 6 | 通用工具 | D25 | 已登记 |
| `utils/management-http.ts` | 78 | 通用工具 | D25 | 已登记 |
| `utils/mime.ts` | 116 | 剪贴板与图像 | D24 | 已登记 |
| `utils/open-browser.ts` | 24 | 通用工具 | D25 | 已登记 |
| `utils/paths.ts` | 139 | 通用工具 | D25 | 已登记 |
| `utils/photon.ts` | 139 | 剪贴板与图像 | D24 | 已登记 |
| `utils/pi-user-agent.ts` | 4 | 通用工具 | D25 | 已登记 |
| `utils/shell.ts` | 247 | 内置工具 | D12 | 已登记 |
| `utils/sleep.ts` | 18 | 通用工具 | D25 | 已登记 |
| `utils/source-resolver.ts` | 86 | 通用工具 | D25 | 已登记 |
| `utils/syntax-highlight.ts` | 212 | 渲染工具 | D23 | 已登记 |
| `utils/text.ts` | 9 | 渲染工具 | D23 | 已登记 |
| `utils/tool-result-images.ts` | 62 | 剪贴板与图像 | D24 | 已登记 |
| `utils/tools-manager.ts` | 400 | 通用工具 | D25 | 已登记 |
| `utils/version-check.ts` | 109 | 通用工具 | D25 | 已登记 |
| `utils/windows-self-update.ts` | 84 | 通用工具 | D25 | 已登记 |

### 2.5 `packages/evals/src`（10 文件 / 1413 行）

| 文件 | 行数 | 模块 | 教学文档 | 状态 |
| --- | ---: | --- | --- | --- |
| `docs-catalog.ts` | 61 | 评测 | D25 | 已登记 |
| `docs.eval.ts` | 71 | 评测 | D25 | 已登记 |
| `extensions.eval.ts` | 140 | 评测 | D25 | 已登记 |
| `pi-harness.ts` | 261 | 评测 | D25 | 已登记 |
| `smoke.eval.ts` | 17 | 评测 | D25 | 已登记 |
| `vitest-evals/artifacts.ts` | 113 | 评测 | D25 | 已登记 |
| `vitest-evals/harness-table.ts` | 193 | 评测 | D25 | 已登记 |
| `vitest-evals/reporter.ts` | 111 | 评测 | D25 | 已登记 |
| `vitest-evals/setup.ts` | 8 | 评测 | D25 | 已登记 |
| `vitest-evals/summary.ts` | 438 | 评测 | D25 | 已登记 |

### 2.6 生成文件（不参与教学覆盖统计）

| 文件/目录 | 处理方式 |
| --- | --- |
| `packages/ai/src/image-models.generated.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/models.generated.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/anthropic.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/deepseek.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/github-copilot.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/google-vertex.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/google.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/groq.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/kimi-coding.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/minimax-cn.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/minimax.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/mistral.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/moonshotai-cn.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/moonshotai.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/openai-codex.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/openai.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/opencode-go.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/opencode.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/openrouter.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/qwen-token-plan-cn.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/qwen-token-plan-individual.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/qwen-token-plan.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/vercel-ai-gateway.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/xai.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/xiaomi-token-plan-ams.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/xiaomi-token-plan-cn.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/xiaomi-token-plan-sgp.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/xiaomi.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/zai-coding-cn.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/zai.models.ts` | 代码生成产物（由 packages/ai/scripts 生成，禁止手改） |
| `packages/ai/src/providers/data/*.json` | 由 `generate-models.ts` 生成、`.gitignore` 排除；教学只讲生成流程与数据形状 |

### 2.7 非 TS 资源（37 个）

| 文件 | 类型 | 教学文档 | 处理方式 |
| --- | --- | --- | --- |
| `packages/ai/src/providers/data/*.json`（29 个） | 生成数据 | D04 | 不逐文件登记，见 2.6 |
| `packages/coding-agent/src/core/export-html/template.html` | 模板 | D24 | 会话导出模板 |
| `packages/coding-agent/src/core/export-html/template.css` | 模板 | D24 | 会话导出样式 |
| `packages/coding-agent/src/core/export-html/template.js` | 模板 | D24 | 会话导出脚本 |
| `packages/coding-agent/src/core/export-html/vendor/highlight.min.js` | 第三方 | D24 | 语法高亮（vendored） |
| `packages/coding-agent/src/core/export-html/vendor/marked.min.js` | 第三方 | D24 | Markdown 渲染（vendored） |
| `packages/coding-agent/src/modes/interactive/theme/dark.json` | 主题 | D24 | 深色主题 |
| `packages/coding-agent/src/modes/interactive/theme/light.json` | 主题 | D24 | 浅色主题 |
| `packages/coding-agent/src/modes/interactive/assets/clankolas.png` | 图片 | D24 | 启动动画素材 |

## 3. 测试文件登记

原项目共有 382 个测试文件。教学不要求逐文件复现测试，但必须知道每个模块有哪些测试覆盖。分组如下：

| 包 | 目录 | 文件数 | 覆盖的教学模块 |
| --- | --- | ---: | --- |
| `ai` | `(根目录)` | 112 | 随对应模块（见第 2 节） |
| `ai` | `data` | 1 | 随对应模块（见第 2 节） |
| `agent` | `(根目录)` | 4 | 随对应模块（见第 2 节） |
| `agent` | `utils` | 3 | 随对应模块（见第 2 节） |
| `tui` | `(根目录)` | 45 | 随对应模块（见第 2 节） |
| `tui` | `fixtures` | 4 | 随对应模块（见第 2 节） |
| `coding-agent` | `(根目录)` | 157 | 随对应模块（见第 2 节） |
| `coding-agent` | `fixtures` | 22 | 随对应模块（见第 2 节） |
| `coding-agent` | `memory` | 11 | 随对应模块（见第 2 节） |
| `coding-agent` | `session-manager` | 7 | 随对应模块（见第 2 节） |
| `coding-agent` | `suite` | 11 | 随对应模块（见第 2 节） |
| `evals` | `(根目录)` | 2 | 随对应模块（见第 2 节） |
| `evals` | `vitest-evals` | 3 | 随对应模块（见第 2 节） |

## 4. 原项目自带文档

`packages/coding-agent/docs/` 是官方产品文档，用于校准概念与行为，不作为教学目录直接照搬。

| 文件 | 对应教学文档 |
| --- | --- |
| `compaction.md` | D16 |
| `containerization.md` | D25 |
| `custom-provider.md` | D19 |
| `development.md` | D01 |
| `docs.json` | D00 |
| `environment-variables.md` | D17 |
| `extensions.md` | D21 |
| `index.md` | D00 |
| `json.md` | D20 |
| `keybindings.md` | D24 |
| `llama-cpp.md` | D19 |
| `models.md` | D19 |
| `packages.md` | D21 |
| `prompt-templates.md` | D15 |
| `providers.md` | D07 |
| `quickstart.md` | D17 |
| `rpc.md` | D20 |
| `sdk.md` | D18 |
| `security.md` | D17 |
| `session-format.md` | D14 |
| `sessions.md` | D14 |
| `settings.md` | D17 |
| `shell-aliases.md` | D17 |
| `skills.md` | D15 |
| `terminal-setup.md` | D24 |
| `termux.md` | D25 |
| `tmux.md` | D24 |
| `tui.md` | D23 |
| `usage.md` | D17 |
| `windows.md` | D25 |
| `images/` | 文档配图，不作为教学素材 |

## 5. 示例（examples）

| 目录 | 文件数 | 关联教学 |
| --- | ---: | --- |
| `README.md` | 1 | D00 |
| `extensions/README.md` | 1 | D21 |
| `extensions/auto-commit-on-exit.ts` | 1 | D21 |
| `extensions/bash-spawn-hook.ts` | 1 | D21 |
| `extensions/border-status-editor.ts` | 1 | D21 |
| `extensions/built-in-tool-renderer.ts` | 1 | D21 |
| `extensions/claude-rules.ts` | 1 | D21 |
| `extensions/commands.ts` | 1 | D21 |
| `extensions/confirm-destructive.ts` | 1 | D21 |
| `extensions/custom-compaction.ts` | 1 | D21 |
| `extensions/custom-footer.ts` | 1 | D21 |
| `extensions/custom-header.ts` | 1 | D21 |
| `extensions/custom-provider-anthropic` | 4 | D21 |
| `extensions/custom-provider-gitlab-duo` | 4 | D21 |
| `extensions/dirty-repo-guard.ts` | 1 | D21 |
| `extensions/doom-overlay` | 11 | D21 |
| `extensions/dynamic-resources` | 3 | D21 |
| `extensions/dynamic-tools.ts` | 1 | D21 |
| `extensions/entry-renderer.ts` | 1 | D21 |
| `extensions/event-bus.ts` | 1 | D21 |
| `extensions/file-trigger.ts` | 1 | D21 |
| `extensions/git-checkpoint.ts` | 1 | D21 |
| `extensions/git-merge-and-resolve.ts` | 1 | D21 |
| `extensions/github-issue-autocomplete.ts` | 1 | D21 |
| `extensions/gondolin` | 4 | D21 |
| `extensions/handoff.ts` | 1 | D21 |
| `extensions/hello.ts` | 1 | D21 |
| `extensions/hidden-thinking-label.ts` | 1 | D21 |
| `extensions/inline-bash.ts` | 1 | D21 |
| `extensions/input-transform-streaming.ts` | 1 | D21 |
| `extensions/input-transform.ts` | 1 | D21 |
| `extensions/interactive-shell.ts` | 1 | D21 |
| `extensions/kimi-deferred-tools.ts` | 1 | D21 |
| `extensions/memory` | 2 | D21 |
| `extensions/message-renderer.ts` | 1 | D21 |
| `extensions/minimal-mode.ts` | 1 | D21 |
| `extensions/modal-editor.ts` | 1 | D21 |
| `extensions/model-status.ts` | 1 | D21 |
| `extensions/notify.ts` | 1 | D21 |
| `extensions/overlay-qa-tests.ts` | 1 | D21 |
| `extensions/overlay-test.ts` | 1 | D21 |
| `extensions/permission-gate.ts` | 1 | D21 |
| `extensions/pirate.ts` | 1 | D21 |
| `extensions/plan-mode` | 3 | D21 |
| `extensions/preset.ts` | 1 | D21 |
| `extensions/project-trust.ts` | 1 | D21 |
| `extensions/prompt-customizer.ts` | 1 | D21 |
| `extensions/protected-paths.ts` | 1 | D21 |
| `extensions/provider-payload.ts` | 1 | D21 |
| `extensions/qna.ts` | 1 | D21 |
| `extensions/question.ts` | 1 | D21 |
| `extensions/questionnaire.ts` | 1 | D21 |
| `extensions/rainbow-editor.ts` | 1 | D21 |
| `extensions/reload-runtime.ts` | 1 | D21 |
| `extensions/rpc-demo.ts` | 1 | D21 |
| `extensions/sandbox` | 1 | D21 |
| `extensions/send-user-message.ts` | 1 | D21 |
| `extensions/session-name.ts` | 1 | D21 |
| `extensions/shutdown-command.ts` | 1 | D21 |
| `extensions/snake.ts` | 1 | D21 |
| `extensions/space-invaders.ts` | 1 | D21 |
| `extensions/ssh.ts` | 1 | D21 |
| `extensions/status-line.ts` | 1 | D21 |
| `extensions/structured-output.ts` | 1 | D21 |
| `extensions/subagent` | 10 | D21 |
| `extensions/summarize.ts` | 1 | D21 |
| `extensions/system-prompt-header.ts` | 1 | D21 |
| `extensions/tic-tac-toe.ts` | 1 | D21 |
| `extensions/timed-confirm.ts` | 1 | D21 |
| `extensions/titlebar-spinner.ts` | 1 | D21 |
| `extensions/todo.ts` | 1 | D21 |
| `extensions/tool-override.ts` | 1 | D21 |
| `extensions/tools.ts` | 1 | D21 |
| `extensions/trigger-compact.ts` | 1 | D21 |
| `extensions/truncated-tool.ts` | 1 | D21 |
| `extensions/widget-placement.ts` | 1 | D21 |
| `extensions/with-deps` | 4 | D21 |
| `extensions/working-indicator.ts` | 1 | D21 |
| `extensions/working-message-test.ts` | 1 | D21 |
| `rpc-extension-ui.ts` | 1 | D21 |
| `sdk/01-minimal.ts` | 1 | D18 |
| `sdk/02-custom-model.ts` | 1 | D18 |
| `sdk/03-custom-prompt.ts` | 1 | D18 |
| `sdk/04-skills.ts` | 1 | D18 |
| `sdk/05-tools.ts` | 1 | D18 |
| `sdk/06-extensions.ts` | 1 | D18 |
| `sdk/07-context-files.ts` | 1 | D18 |
| `sdk/08-prompt-templates.ts` | 1 | D18 |
| `sdk/09-api-keys-and-oauth.ts` | 1 | D18 |
| `sdk/10-settings.ts` | 1 | D18 |
| `sdk/11-sessions.ts` | 1 | D18 |
| `sdk/12-full-control.ts` | 1 | D18 |
| `sdk/13-session-runtime.ts` | 1 | D18 |
| `sdk/README.md` | 1 | D18 |

## 6. 工程脚本

| 脚本 | 作用类别 | 教学文档 |
| --- | --- | --- |
| `scripts/agent-treeshake-smoke-entry.ts` | 构建/校验/发布 | D25 |
| `scripts/auto-pi.sh` | 构建/校验/发布 | D25 |
| `scripts/browser-smoke-entry.ts` | 构建/校验/发布 | D25 |
| `scripts/build-binaries.sh` | 构建/校验/发布 | D25 |
| `scripts/build-coding-agent-bundle.mjs` | 构建/校验/发布 | D25 |
| `scripts/check-browser-smoke.mjs` | 构建/校验/发布 | D25 |
| `scripts/check-entry-graphs.mjs` | 构建/校验/发布 | D25 |
| `scripts/check-pinned-deps.mjs` | 构建/校验/发布 | D25 |
| `scripts/check-runtime-deps.mjs` | 构建/校验/发布 | D25 |
| `scripts/check-runtime-deps.test.mjs` | 构建/校验/发布 | D25 |
| `scripts/check-ts-relative-imports.mjs` | 构建/校验/发布 | D25 |
| `scripts/coding-agent-consumer.mjs` | 构建/校验/发布 | D25 |
| `scripts/coding-agent-consumer.test.mjs` | 构建/校验/发布 | D25 |
| `scripts/cost.ts` | 构建/校验/发布 | D25 |
| `scripts/create-source-archive.sh` | 构建/校验/发布 | D25 |
| `scripts/diff-model-catalog.mjs` | 构建/校验/发布 | D19 |
| `scripts/edit-tool-stats.mjs` | 构建/校验/发布 | D25 |
| `scripts/generate-coding-agent-install-lock.mjs` | 构建/校验/发布 | D25 |
| `scripts/generate-coding-agent-shrinkwrap.mjs` | 构建/校验/发布 | D25 |
| `scripts/generate-thinking-capabilities.mjs` | 构建/校验/发布 | D19 |
| `scripts/local-release.mjs` | 构建/校验/发布 | D25 |
| `scripts/package-workspaces.mjs` | 构建/校验/发布 | D25 |
| `scripts/profile-coding-agent-node.mjs` | 构建/校验/发布 | D25 |
| `scripts/publish-model-catalog.mjs` | 构建/校验/发布 | D19 |
| `scripts/publish-release-announcement.mjs` | 构建/校验/发布 | D25 |
| `scripts/publish-release-announcement.test.mjs` | 构建/校验/发布 | D25 |
| `scripts/publish.mjs` | 构建/校验/发布 | D25 |
| `scripts/read-tool-stats.mjs` | 构建/校验/发布 | D25 |
| `scripts/release-notes.mjs` | 构建/校验/发布 | D25 |
| `scripts/release-packages.mjs` | 构建/校验/发布 | D25 |
| `scripts/release.mjs` | 构建/校验/发布 | D25 |
| `scripts/repro-5893-wsl-bash.mjs` | 构建/校验/发布 | D25 |
| `scripts/session-context-stats.mjs` | 构建/校验/发布 | D25 |
| `scripts/session-transcripts.ts` | 构建/校验/发布 | D25 |
| `scripts/stats.ts` | 构建/校验/发布 | D25 |
| `scripts/sync-versions.js` | 构建/校验/发布 | D25 |
| `scripts/sync-versions.test.mjs` | 构建/校验/发布 | D25 |
| `scripts/tool-stats.ts` | 构建/校验/发布 | D25 |
| `scripts/update-source-imports-to-ts.sh` | 构建/校验/发布 | D25 |

## 7. 原生模块、CI 与根配置

| 条目 | 数量/说明 | 教学文档 |
| --- | --- | --- |
| `packages/tui/native/` | 18 个文件（darwin/linux/win32 的剪贴板与终端辅助） | D25 |
| `.github/workflows/` | 7 个 workflow：approve-contributor.yml, ci.yml, issue-gate.yml, issue-triage-labels.yml, npm-audit.yml, pr-gate.yml, remove-inprogress-on-close.yml | D25 |
| `.gitattributes` | 根级配置/脚本 | D01 |
| `.gitignore` | 根级配置/脚本 | D01 |
| `.npmrc` | 根级配置/脚本 | D01 |
| `biome.json` | 根级配置/脚本 | D01 |
| `package.json` | 根级配置/脚本 | D01 |
| `package-lock.json` | 根级配置/脚本 | D01 |
| `tsconfig.base.json` | 根级配置/脚本 | D01 |
| `tsconfig.json` | 根级配置/脚本 | D01 |
| `vitest.base.ts` | 根级配置/脚本 | D01 |
| `test.sh` | 根级配置/脚本 | D01 |
| `pi-test.sh` | 根级配置/脚本 | D01 |
| `pi-test.ps1` | 根级配置/脚本 | D01 |
| `pi-test.bat` | 根级配置/脚本 | D01 |
| `tui-plan.md` | 根级配置/脚本 | D01 |
| `AGENTS.md` | 根级配置/脚本 | D01 |
| `README.md` | 根级配置/脚本 | D01 |
| `references/` | 用户自己的 Memory 方案草稿，非 pi 源码 | 不纳入 |

## 8. 明确排除的内容

| 内容 | 原因 |
| --- | --- |
| `**/.ipynb_checkpoints/`（17 处） | Jupyter 编辑器自动生成的备份副本，与源文件重复 |
| `**/node_modules/`、`**/dist/` | 依赖与构建产物 |
| `packages/evals/SWE-bench_Verified/` | 第三方评测数据集，`.gitignore` 排除 |
| `packages/coding-agent/npm-shrinkwrap.json`、`install-lock/` | 发布用锁文件，属于 D25 构建发布内容 |
| `packages/coding-agent/docs/images/` | 文档配图 |
| `references/PI_Memory*.md` | 用户自研方案，不是 pi 源码 |

## 9. 附录：测试文件全量清单

### `ai`（113）

<details><summary>展开文件列表</summary>

- `../../../../../../tmp/packages/ai/test/abort.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-auth-token.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-cache-write-1h-cost.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-eager-tool-input-compat.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-empty-thinking-signature-compat.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-force-adaptive-thinking.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-mid-conversation-effort.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-oauth.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-sse-parsing.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-temperature-compat.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-thinking-disable.test.ts`
- `../../../../../../tmp/packages/ai/test/anthropic-tool-name-normalization.test.ts`
- `../../../../../../tmp/packages/ai/test/assistant-message-frame.test.ts`
- `../../../../../../tmp/packages/ai/test/cache-retention.test.ts`
- `../../../../../../tmp/packages/ai/test/codex-websocket-cached-probe.ts`
- `../../../../../../tmp/packages/ai/test/compat-env.test.ts`
- `../../../../../../tmp/packages/ai/test/constrained-sampling.test.ts`
- `../../../../../../tmp/packages/ai/test/context-estimate.test.ts`
- `../../../../../../tmp/packages/ai/test/context-overflow.test.ts`
- `../../../../../../tmp/packages/ai/test/cross-provider-handoff.test.ts`
- `../../../../../../tmp/packages/ai/test/data/red-circle.png`
- `../../../../../../tmp/packages/ai/test/deferred-tools.test.ts`
- `../../../../../../tmp/packages/ai/test/empty.test.ts`
- `../../../../../../tmp/packages/ai/test/env-api-keys.test.ts`
- `../../../../../../tmp/packages/ai/test/error-body.test.ts`
- `../../../../../../tmp/packages/ai/test/event-stream.test.ts`
- `../../../../../../tmp/packages/ai/test/faux-provider.test.ts`
- `../../../../../../tmp/packages/ai/test/fetch-option.test.ts`
- `../../../../../../tmp/packages/ai/test/generate-models-strict.test.ts`
- `../../../../../../tmp/packages/ai/test/github-copilot-anthropic.test.ts`
- `../../../../../../tmp/packages/ai/test/github-copilot-oauth.test.ts`
- `../../../../../../tmp/packages/ai/test/google-raw-stop-reason.test.ts`
- `../../../../../../tmp/packages/ai/test/google-shared-convert-tools.test.ts`
- `../../../../../../tmp/packages/ai/test/google-shared-gemini3-unsigned-tool-call.test.ts`
- `../../../../../../tmp/packages/ai/test/google-shared-image-tool-result-routing.test.ts`
- `../../../../../../tmp/packages/ai/test/google-shared-retry.test.ts`
- `../../../../../../tmp/packages/ai/test/google-shared-signed-empty-blocks.test.ts`
- `../../../../../../tmp/packages/ai/test/google-thinking-disable.test.ts`
- `../../../../../../tmp/packages/ai/test/google-thinking-level-map.test.ts`
- `../../../../../../tmp/packages/ai/test/google-thinking-signature.test.ts`
- `../../../../../../tmp/packages/ai/test/google-vertex-api-key-resolution.test.ts`
- `../../../../../../tmp/packages/ai/test/image-model-data.test.ts`
- `../../../../../../tmp/packages/ai/test/image-tool-result.test.ts`
- `../../../../../../tmp/packages/ai/test/images-models.test.ts`
- `../../../../../../tmp/packages/ai/test/images.test.ts`
- `../../../../../../tmp/packages/ai/test/interleaved-thinking.test.ts`
- `../../../../../../tmp/packages/ai/test/kimi-coding-oauth.test.ts`
- `../../../../../../tmp/packages/ai/test/lax-message-content.test.ts`
- `../../../../../../tmp/packages/ai/test/lazy-module-load.test.ts`
- `../../../../../../tmp/packages/ai/test/mistral-http-transport.test.ts`
- `../../../../../../tmp/packages/ai/test/mistral-raw-stop-reason.test.ts`
- `../../../../../../tmp/packages/ai/test/mistral-reasoning-mode.test.ts`
- `../../../../../../tmp/packages/ai/test/mistral-tool-schema.test.ts`
- `../../../../../../tmp/packages/ai/test/model-catalog-types.test.ts`
- `../../../../../../tmp/packages/ai/test/model-data-validation.test.ts`
- `../../../../../../tmp/packages/ai/test/models-runtime.test.ts`
- `../../../../../../tmp/packages/ai/test/node-http-proxy.test.ts`
- `../../../../../../tmp/packages/ai/test/oauth-auth.test.ts`
- `../../../../../../tmp/packages/ai/test/oauth-device-code.test.ts`
- `../../../../../../tmp/packages/ai/test/oauth.ts`
- `../../../../../../tmp/packages/ai/test/openai-codex-oauth.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-codex-stream.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-cache-control-format.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-empty-tools.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-prompt-cache.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-raw-stop-reason.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-reasoning-details.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-response-model.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-retry.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-thinking-as-text.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-thinking-token-budget.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-tool-choice.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-tool-result-images.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-completions-vllm-priority.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-compat.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-empty-tool-result.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-foreign-toolcall-id.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-message-id.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-namespace.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-partial-json-cleanup.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-terminal-event.test.ts`
- `../../../../../../tmp/packages/ai/test/openai-responses-tool-result-images.test.ts`
- `../../../../../../tmp/packages/ai/test/openrouter-cache-control-models.test.ts`
- `../../../../../../tmp/packages/ai/test/openrouter-images.test.ts`
- `../../../../../../tmp/packages/ai/test/openrouter-oauth.test.ts`
- `../../../../../../tmp/packages/ai/test/openrouter-reasoning-options.test.ts`
- `../../../../../../tmp/packages/ai/test/overflow.test.ts`
- `../../../../../../tmp/packages/ai/test/pre-generation-error.test.ts`
- `../../../../../../tmp/packages/ai/test/provider-error-body-passthrough.test.ts`
- `../../../../../../tmp/packages/ai/test/provider-error-body-regression.test.ts`
- `../../../../../../tmp/packages/ai/test/provider-retry.test.ts`
- `../../../../../../tmp/packages/ai/test/providers.test.ts`
- `../../../../../../tmp/packages/ai/test/reasoning-options.test.ts`
- `../../../../../../tmp/packages/ai/test/responseid.test.ts`
- `../../../../../../tmp/packages/ai/test/retry.test.ts`
- `../../../../../../tmp/packages/ai/test/sampling-options.test.ts`
- `../../../../../../tmp/packages/ai/test/scratch.ts`
- `../../../../../../tmp/packages/ai/test/stream.test.ts`
- `../../../../../../tmp/packages/ai/test/supports-xhigh.test.ts`
- `../../../../../../tmp/packages/ai/test/text.test.ts`
- `../../../../../../tmp/packages/ai/test/tokens.test.ts`
- `../../../../../../tmp/packages/ai/test/tool-call-id-normalization.test.ts`
- `../../../../../../tmp/packages/ai/test/tool-call-without-result.test.ts`
- `../../../../../../tmp/packages/ai/test/total-tokens.test.ts`
- `../../../../../../tmp/packages/ai/test/transform-messages-copilot-openai-to-anthropic.test.ts`
- `../../../../../../tmp/packages/ai/test/unicode-surrogate.test.ts`
- `../../../../../../tmp/packages/ai/test/uuid.test.ts`
- `../../../../../../tmp/packages/ai/test/validation.test.ts`
- `../../../../../../tmp/packages/ai/test/xai-oauth.test.ts`
- `../../../../../../tmp/packages/ai/test/xai-responses.test.ts`
- `../../../../../../tmp/packages/ai/test/xhigh.test.ts`
- `../../../../../../tmp/packages/ai/test/zai-coding-plan-models.test.ts`
- `../../../../../../tmp/packages/ai/test/zen.test.ts`

</details>

### `agent`（7）

<details><summary>展开文件列表</summary>

- `../../../../../../tmp/packages/agent/test/agent-loop.test.ts`
- `../../../../../../tmp/packages/agent/test/agent.test.ts`
- `../../../../../../tmp/packages/agent/test/e2e.test.ts`
- `../../../../../../tmp/packages/agent/test/proxy.test.ts`
- `../../../../../../tmp/packages/agent/test/utils/calculate.ts`
- `../../../../../../tmp/packages/agent/test/utils/get-current-time.ts`
- `../../../../../../tmp/packages/agent/test/utils/wait-for-tick.ts`

</details>

### `tui`（49）

<details><summary>展开文件列表</summary>

- `../../../../../../tmp/packages/tui/test/alt-screen-large-transcript-bench.ts`
- `../../../../../../tmp/packages/tui/test/autocomplete.test.ts`
- `../../../../../../tmp/packages/tui/test/bug-regression-isimageline-startswith-bug.test.ts`
- `../../../../../../tmp/packages/tui/test/chat-simple.ts`
- `../../../../../../tmp/packages/tui/test/editor-history-keybindings.test.ts`
- `../../../../../../tmp/packages/tui/test/editor.test.ts`
- `../../../../../../tmp/packages/tui/test/fixtures/clipboard-reader.cjs`
- `../../../../../../tmp/packages/tui/test/fixtures/clipboard-worker-test.c`
- `../../../../../../tmp/packages/tui/test/fixtures/clipboard-worker-test.cjs`
- `../../../../../../tmp/packages/tui/test/fixtures/clipboard-x11-test.c`
- `../../../../../../tmp/packages/tui/test/fuzzy.test.ts`
- `../../../../../../tmp/packages/tui/test/image-test.ts`
- `../../../../../../tmp/packages/tui/test/input.test.ts`
- `../../../../../../tmp/packages/tui/test/key-tester.ts`
- `../../../../../../tmp/packages/tui/test/keybindings.test.ts`
- `../../../../../../tmp/packages/tui/test/keys.test.ts`
- `../../../../../../tmp/packages/tui/test/latex.test.ts`
- `../../../../../../tmp/packages/tui/test/layout.test.ts`
- `../../../../../../tmp/packages/tui/test/markdown.test.ts`
- `../../../../../../tmp/packages/tui/test/mouse-components.test.ts`
- `../../../../../../tmp/packages/tui/test/native-clipboard-linux.test.ts`
- `../../../../../../tmp/packages/tui/test/native-module-path.test.ts`
- `../../../../../../tmp/packages/tui/test/native-platform.test.ts`
- `../../../../../../tmp/packages/tui/test/overlay-non-capturing.test.ts`
- `../../../../../../tmp/packages/tui/test/overlay-options.test.ts`
- `../../../../../../tmp/packages/tui/test/overlay-short-content.test.ts`
- `../../../../../../tmp/packages/tui/test/regression-overlay-cjk-boundary.test.ts`
- `../../../../../../tmp/packages/tui/test/regression-regional-indicator-width.test.ts`
- `../../../../../../tmp/packages/tui/test/regression-sigwinch-kill-eacces.test.ts`
- `../../../../../../tmp/packages/tui/test/render-churn-bench.ts`
- `../../../../../../tmp/packages/tui/test/select-list.test.ts`
- `../../../../../../tmp/packages/tui/test/settings-list.test.ts`
- `../../../../../../tmp/packages/tui/test/stdin-buffer.test.ts`
- `../../../../../../tmp/packages/tui/test/tab-width.test.ts`
- `../../../../../../tmp/packages/tui/test/terminal-colors.test.ts`
- `../../../../../../tmp/packages/tui/test/terminal-image.test.ts`
- `../../../../../../tmp/packages/tui/test/terminal.test.ts`
- `../../../../../../tmp/packages/tui/test/test-themes.ts`
- `../../../../../../tmp/packages/tui/test/truncate-to-width.test.ts`
- `../../../../../../tmp/packages/tui/test/truncated-text.test.ts`
- `../../../../../../tmp/packages/tui/test/tui-alt-screen.test.ts`
- `../../../../../../tmp/packages/tui/test/tui-cell-size-input.test.ts`
- `../../../../../../tmp/packages/tui/test/tui-overlay-style-leak.test.ts`
- `../../../../../../tmp/packages/tui/test/tui-render.test.ts`
- `../../../../../../tmp/packages/tui/test/tui-shrink.test.ts`
- `../../../../../../tmp/packages/tui/test/viewport-overwrite-repro.ts`
- `../../../../../../tmp/packages/tui/test/virtual-terminal.ts`
- `../../../../../../tmp/packages/tui/test/word-navigation.test.ts`
- `../../../../../../tmp/packages/tui/test/wrap-ansi.test.ts`

</details>

### `coding-agent`（208）

<details><summary>展开文件列表</summary>

- `../../../../../../tmp/packages/coding-agent/test/agent-session-auto-compaction-queue.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-branching.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-compaction.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-concurrent.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-dynamic-provider.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-dynamic-tools.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-retry.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-runtime-events.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-stats.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/agent-session-tree-navigation.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/ansi-utils.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/args.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/assistant-message.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/auth-check.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/auth-storage.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/bash-close-hang-windows.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/bash-execution-width.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/block-images.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/branch-summarization.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/branch-summary-extensions.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/builtin-tool-strict-mode.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/cache-stats.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/changelog.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/chat-viewport.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/clipboard-command.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/clipboard-image-bmp-conversion.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/clipboard-image-native-errors.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/clipboard-image.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/clipboard.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/compaction-extensions-example.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/compaction-extensions.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/compaction-serialization.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/compaction-summary-reasoning.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/compaction.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/config-value-migration.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/config.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/credential-print.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/custom-editor-history-keybindings.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/custom-message.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/default-tools-setting.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/edit-tool-legacy-input.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/edit-tool-no-full-redraw.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/experimental.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/export-html-skill-block.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/export-html-whitespace.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/export-html-xss.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/extensions-discovery.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/extensions-input-event.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/extensions-runner.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/external-editor.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/file-mutation-queue.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/first-time-setup-fork.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/first-time-setup.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/assistant-message-with-thinking-code.json`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/before-compaction.jsonl`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/empty-agent/.gitkeep`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/empty-cwd/.gitkeep`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/fake-external-editor.mjs`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/large-session.jsonl`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills-collision/first/calendar/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills-collision/second/calendar/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/consecutive-hyphens/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/disable-model-invocation/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/invalid-name-chars/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/invalid-yaml/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/long-name/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/missing-description/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/multiline-description/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/name-mismatch/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/nested/child-skill/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/no-frontmatter/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/root-skill-preferred/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/root-skill-preferred/nested-child/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/unknown-field/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/fixtures/skills/valid-skill/SKILL.md`
- `../../../../../../tmp/packages/coding-agent/test/footer-data-provider.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/footer-width.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/format-resume-command.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/frontmatter.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/git-merge-and-resolve-extension.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/git-ssh-url.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/git-update.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/http-dispatcher.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/image-process.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/image-processing.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/image-resize-callers.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/initial-message.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/input-transform-streaming-example.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-anthropic-warning.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-assistant-diagnostics.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-clone-command.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-compaction.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-import-command.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-startup-input.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-status.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-suspend.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-mode-tree-navigation.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/interactive-tui.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/keybindings-migration.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/keybindings.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/llama-extension.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/management-http.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/config.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/display.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/extension.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/extractor.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/harness.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/online.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/prompt.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/retriever.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/span.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/store.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/memory/test-helpers.ts`
- `../../../../../../tmp/packages/coding-agent/test/mermaid.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-catalog-refresh.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-registry.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-resolver.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-runtime-auth-options.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-runtime-credential-sync.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-runtime-modify-models-compat.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-runtime-test-utils.ts`
- `../../../../../../tmp/packages/coding-agent/test/model-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/models-store.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/oauth-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/package-command-paths.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/package-distribution.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/package-manager-ssh.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/package-manager.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/path-utils.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/paths.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/pi-user-agent.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/plan-mode-extension.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/plan-mode-utils.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/powershell-tool.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/print-mode.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/prompt-templates.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/remote-catalog-provider.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/resolve-config-value.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/resource-loader.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/restore-sandbox-env.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc-client-clear-queue.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc-client-clone.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc-client-process-exit.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc-example.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc-jsonl.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc-prompt-response-semantics.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/rpc.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/runtime-credentials.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/scoped-models-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/sdk-codex-cache-probe-tool-loop.ts`
- `../../../../../../tmp/packages/coding-agent/test/sdk-openrouter-attribution.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/sdk-session-manager.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/sdk-skills.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/sdk-stream-options.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-cwd.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-file-invalid.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-id-readonly.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-info-modified-timestamp.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/build-context.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/custom-session-id.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/file-operations.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/load-entries.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/migration.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/save-entry.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-manager/tree-traversal.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-selector-path-delete.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-selector-rename.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-selector-search.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/session-share.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/settings-diagnostics.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/settings-manager-bug.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/settings-manager.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/settings-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/skills.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/startup-session-name.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/status-indicator.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/stdout-cleanliness.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/streaming-render-debug.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/README.md`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-bash-persistence.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-compaction.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-model-extension.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-prompt.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-queue.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-retry-events.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-runtime.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/agent-session-tool-result-images.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/harness.ts`
- `../../../../../../tmp/packages/coding-agent/test/suite/lax-message-content.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/syntax-highlight.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/system-prompt.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/test-harness.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/test-harness.ts`
- `../../../../../../tmp/packages/coding-agent/test/test-network-env.ts`
- `../../../../../../tmp/packages/coding-agent/test/thinking-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/tool-execution-component.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/tool-result-images.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/tool-system-prompt-contributions.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/tools-manager.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/tools.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/tree-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/trigger-compact-extension.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/truncate-to-width.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/trust-manager.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/trust-selector.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/user-message.test.ts`
- `../../../../../../tmp/packages/coding-agent/test/utilities.ts`
- `../../../../../../tmp/packages/coding-agent/test/version-check.test.ts`

</details>

### `evals`（5）

<details><summary>展开文件列表</summary>

- `../../../../../../tmp/packages/evals/test/docs-catalog.test.ts`
- `../../../../../../tmp/packages/evals/test/pi-harness.test.ts`
- `../../../../../../tmp/packages/evals/test/vitest-evals/artifacts.test.ts`
- `../../../../../../tmp/packages/evals/test/vitest-evals/harness-table.test.ts`
- `../../../../../../tmp/packages/evals/test/vitest-evals/summary.test.ts`

</details>

## 10. 覆盖缺口

无。全部非生成源文件都已分配教学文档。

尚未深读的模块统一标为 `已登记`，在对应批次生成文档时升级为 `已分析`。

