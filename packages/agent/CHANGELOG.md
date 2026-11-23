# Changelog

## [Unreleased]

### Breaking Changes

### Added

- 初始化 `@pipi/agent` 包骨架，声明对 `@pipi/llm` 的依赖。
- 新增 `StreamFn` 与 `AgentLoopConfig`、`AgentEvent`、`AgentTool`、`AgentMessage` 等循环类型。
- 实现 `runAgentLoop`：双层循环、事件协议、流式消息消费、串行/并行工具批次与全部钩子。
- 新增 `AgentState` 类型与 `PendingMessageQueue`：`all` / `single` 两种排空模式，默认一次一条。
- 新增 `Agent`：运行生命周期、并发守卫、`steer` / `followUp` 队列、中止与 `waitForIdle`。
- 新增 `Agent.subscribe` 与完整事件归约：流式消息、工具调用集合、错误信息与消息历史。
- `Agent` 接入工具钩子、`shouldStopAfterTurn`、`prepareNextTurn` 与请求级选项；循环外异常补齐错误消息和事件序列。
- 工具调用在 `prepareArguments` 之后、`beforeToolCall` 之前按工具 schema 校验参数；失败转成 `isError` 工具结果。

### Changed

- `AgentState.isStreaming` 重命名为 `isRunning`，名称覆盖模型调用与工具执行。

### Fixed

### Removed
