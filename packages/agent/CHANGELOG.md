# Changelog

## [Unreleased]

### Breaking Changes

### Added

- 初始化 `@pipi/agent` 包骨架，声明对 `@pipi/llm` 的依赖。
- 新增 `StreamFn` 与 `AgentLoopConfig`、`AgentEvent`、`AgentTool`、`AgentMessage` 等循环类型。
- 实现 `runAgentLoop`：双层循环、事件协议、流式消息消费、串行/并行工具批次与全部钩子。

### Changed

### Fixed

### Removed
