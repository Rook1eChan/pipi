# Changelog

## [Unreleased]

### Breaking Changes

### Added

- 初始化 `@pipi/harness` 包骨架，声明对 `@pipi/llm`、`@pipi/agent`、`@pipi/tui` 的依赖。
- 新增工具输出截断：`truncateKeepHead`、`truncateKeepTail`、`truncateLine`，行数与字节数双上限，按 UTF-8 边界裁剪。
- 新增 `OutputAccumulator`：流式累积输出、只保留尾部、超限时把完整内容写入临时文件。
- 新增 `read` 工具：文本分段读取、截断与续读提示、图片读取；配套路径解析与 `ToolDefinition` 包装。
- 新增图像管线：MIME 识别、EXIF 方向修正、按尺寸与体积压缩（photon WASM）。
- 新增 `write`：整文件写入、父目录创建、同文件写入队列。
- 新增 `edit`：精确与空白模糊匹配、BOM/CRLF 保留、diff 与 unified patch、旧参数兼容。
- 新增 `ls`：目录列举、排序、条目与字节上限。
- 新增 `bash` / `powershell`：进程树中止、超时、流式输出与进度事件、`PI_*` 环境变量。
- 新增 `grep` / `find`：ripgrep / fd 调用、结果与长行限制、缺失时下载二进制。
- 新增工具注册表：`createCodingTools`、`createReadOnlyTools`、`createAllTools`、`createTool`。

### Changed

### Fixed

### Removed
