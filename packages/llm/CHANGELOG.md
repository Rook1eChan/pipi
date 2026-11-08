# Changelog

## [Unreleased]

### Breaking Changes

- 移除 deferred 响应相关类型与 `stopReason: "deferred"`；当前没有真实 provider 使用该能力。

### Added

- 初始化 `@pipi/llm` 包骨架：构建、测试与公共导出占位。
- 新增统一类型：消息、内容块、工具、模型、用量、请求选项。
- 引入 `typebox` 依赖，用于工具参数 schema。
- 增加类型构造、JSON 序列化与用量不变量测试。
- 实现 `EventStream` 与 `AssistantMessageEventStream`：事件顺序、结束与最终结果提取。
- 实现流式 JSON 解析：`repairJson`、`parseJsonWithRepair`、`parseStreamingJson`。
- 实现 `lazyStream`：同步返回外层流，初始化失败转为 `error` 事件。
- 公共入口导出事件流、JSON 解析与延迟初始化 API。
- 新增 `Provider` / `Models` 注册表与 `createProvider`：静态模型、动态覆盖、按 API 分派。
- 新增 API key 认证解析与 `applyAuth`。
- 新增模型目录压平与 OpenAI、Anthropic、DeepSeek 最小目录。
- 新增 `ModelsStore` 与动态刷新合并。
- 新增 faux provider，以及注册表、认证、刷新测试。
- 新增 context 用量估算：`estimateContextTokens`、`estimateMessageTokens`、`getUsageTokens`。
- 新增 `simple-options`：`buildBaseOptions`、`clampMaxTokensToContext` 与思考预算计算。
- 新增 OpenAI Chat Completions 消息与工具转换：`convertMessages`、`convertTools`、`resolveCompat`。

### Changed

### Fixed

### Removed
