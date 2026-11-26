# Changelog

## [Unreleased]

### Breaking Changes

- bash 注入的环境变量从 `PI_*` 改名为 `PIPI_*`：`PIPI_SESSION_ID`、`PIPI_SESSION_FILE`、`PIPI_PROVIDER`、`PIPI_MODEL`、`PIPI_REASONING_LEVEL`；二进制下载的离线开关改为 `PIPI_OFFLINE`。
- 扩展清单字段从 `pi.extensions` 改为 `pipi.extensions`。
- 资源作用域 `user` 改名为 `agent`，`ResourceEntries` 的 `user` 字段同步改为 `agent`。

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
- 新增会话存储 `SessionManager`：JSONL 追加写入、延迟落盘、条目树与会话恢复。
- 新增会话上下文重建：路径上溯、压缩裁剪、模型与思考级别重放，以及 `convertToLlm` 消息转换。
- 新增会话分支：`branch`、`resetLeaf`、`createBranchedSession`。
- 新增会话发现与恢复：`findMostRecentSession`、`listSessions`、`openMostRecentSession`。
- 新增 `exportSessionToJsonl`：把当前分支导出成独立会话文件。
- 新增会话名称解析：写入时清洗换行与首尾空白，读取取最后一条 `session_info`，空名称视为清除。
- 新增系统提示拼装 `buildSystemPrompt`：工具列表、指南、追加片段、项目规则与技能索引。
- 新增 `utils/paths.ts`：`resolvePath`、`canonicalizePath`、`isUnderPath`，支持 `~` 与 Unicode 空格。
- 新增 `ResourceSettings` 契约，以及 `SourceInfo` / `PathMetadata` 与完整诊断类型。
- 新增 `ResourceResolver`：解析 settings 条目与默认目录，展开目录、应用 ignore 与启用模式，按 project > user > package 排序去重。
- 新增项目规则加载 `loadProjectContextFiles`：候选优先级、向上继承、去重、BOM 处理与 worktree 遮盖。
- 新增技能加载 `loadSkills`：`SKILL.md`、根目录 `.md`、名称回退父目录名、warning 后继续加载、同名冲突诊断。
- 新增命令模板 `loadPromptTemplates`、`parseCommandArgs`、`substituteArgs`、`expandPromptTemplate`。
- 新增 `ResourceLoader`：构造为空、`reload()` 装载、`extendResources()` 增量追加，含 `loadExtensions` 接缝、override、来源标记与 `SYSTEM.md` / `APPEND_SYSTEM.md` 发现。
- 新增 `minimatch@10.2.5`，用于资源启用模式匹配。

### Changed

- 提示与资源加载相关选项的 `cwd` 字段改名为 `projectDir`，与 `agentDir` 对齐。
- 资源装载模块从 `prompt/` 移到 `resources/`；`prompt/` 只保留系统提示拼装。
- `ResourceLoader` 改为构造时不装载，由 `reload()` 读取磁盘；默认目录解析移到 `ResourceResolver`。
- 技能与模板按 resolver 给出的路径装载，loader 不再自己扫描默认目录。
- 项目级资源优先于用户级，重名时项目资源胜出。
- 技能索引格式化从 `prompt/system-prompt.ts` 移回 `resources/skills.ts`。
- 图像处理模块移到 `src/utils/images/`；配置根改为 `~/.pipi/agent`。
- 系统提示暂不写 pi 文档路径段（D-079），等文档体系建立后补回。

### Fixed

- `+path` / `-path` 精确匹配现在覆盖 `SKILL.md` 的父目录，与原项目一致。
- resolver 对缺失的 settings 条目改为静默跳过；只有 loader 的 `additional*` 路径会报 error。
- 系统提示与项目规则读取失败时恢复 `console.error` warning。

### Removed
