# Changelog

## [Unreleased]

### Breaking Changes

### Added

- 初始化 `@pipi/llm` 包骨架：构建、测试与公共导出占位。
- 新增统一类型：消息、内容块、工具、模型、用量、请求选项。
- 引入 `typebox` 依赖，用于工具参数 schema。
- 增加类型构造、JSON 序列化与用量不变量测试。
- 实现 `EventStream` 与 `AssistantMessageEventStream`：事件顺序、结束与最终结果提取。
- 实现流式 JSON 解析：`repairJson`、`parseJsonWithRepair`、`parseStreamingJson`。
- 实现 `lazyStream`：同步返回外层流，初始化失败转为 `error` 事件。
- 公共入口导出事件流、JSON 解析与延迟初始化 API。

### Changed

### Fixed

### Removed
