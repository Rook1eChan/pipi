# 12 内置工具

> 课程状态：验收通过
> 覆盖模块：`coding-agent/src/core/tools/*`、`core/bash-executor.ts`、`utils/tools-manager.ts`
> 课程文件：12-builtin-tools.md
> 本课产出：模型具备读写文件、搜索代码、执行命令的实际能力。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| 工具定义 `ToolDefinition` | 产品层的工具描述：schema、执行函数、提示片段、渲染器。 |
| 运行时工具 `AgentTool` | 循环使用的形态，由 `wrapToolDefinition` 从定义转换而来。 |
| prompt snippet | 一句话工具简介，拼进系统提示，告诉模型“有这个东西”。 |
| prompt guideline | 使用规则，例如“用 read 而不是 cat”。 |
| 截断 truncation | 输出超过行数或字节上限时只保留一部分，并给出续读方式。 |
| 并发写入队列 | 同一文件的写操作串行执行，避免互相覆盖。 |

---

## 1. 构建目标

课程 09–11 解决了“循环怎么转、工具怎么被执行、参数怎么被校验”。但循环里一个工具都没有，模型仍然只能说话。

本课补上八个工具：

```text
read   读文件（含图片）
write  整文件写入
edit   精确文本替换
bash   执行 shell 命令
grep   按内容搜索
find   按文件名搜索
ls     列目录
powershell  Windows 版 bash
```

目标是让 Agent 具备真实的动手能力，同时把“动手”的风险控制在可接受范围：输出不撑爆上下文、同一文件不会被两个写操作交错、命令可以中止、路径不会跑出工作目录。

---

## 2. A：概念与功能讲解

### 2.1 主线：一个工具由四部分组成

```text
schema     参数契约，决定模型能给什么
execute    真正干活，拿经过校验的参数
提示文本   让模型知道何时该用它
渲染器     让用户看见它在干什么（终端界面，后续课程）
```

参数校验、循环调度已在前面的课程完成，本课关注后两部分中的执行与自我保护。

### 2.2 三种工具集合

`tools/index.ts` 定义了八个名字，并按使用场景分组：

```ts
export type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";

export function createCodingTools(cwd, options): Tool[]     // read, bash, edit, write
export function createReadOnlyTools(cwd, options): Tool[]   // read, grep, find, ls
```

| 集合 | 包含 | 用途 |
|---|---|---|
| coding | read、bash、edit、write | 正常编码会话，能改文件 |
| read-only | read、grep、find、ls | 只读探索，例如审查或问答模式 |
| all | 全部八个 | 需要按名字动态启用的场景 |

每个工具都是 `createXxxTool(cwd, options)`，`cwd` 是解析相对路径的基准。

### 2.3 定义层与运行时层

同一份逻辑存在两种形态：

```ts
export function createReadTool(cwd, options): AgentTool<typeof readSchema> {
	return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
```

`ToolDefinition` 多带了渲染器、`promptSnippet`、`promptGuidelines`、`prepareArguments` 这些产品层字段；`wrapToolDefinition` 把它们转成循环能用的 `AgentTool`，同时保留提示信息。这样做的原因：渲染与提示属于界面和上下文构造，不应该污染 Agent 核心里“执行”这一层的接口。

### 2.4 schema 就是给模型的说明书

schema 不只是校验用的，`description` 同时是模型判断“怎么填”的唯一依据：

```ts
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

工具还会声明 `constrainedSampling: { type: "json_schema", strict: "prefer" }`，请求 provider 尽量按 schema 约束输出。这是“减少参数错误”的第一道手段，与课程 11 的运行时校验互补。

### 2.5 read：分段读取与可续读的截断

`read` 支持 `offset`、`limit`，并默认把结果截到 2000 行或 50KB：

```ts
const truncation = truncateKeepHead(selectedContent);
if (truncation.truncated) {
	const nextOffset = endLineDisplay + 1;
	outputText = truncation.content;
	outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
}
```

截断不是简单砍掉，而是告诉模型下一步怎么读。这样模型可以自己续读，不需要人去解释“文件太大”。

第一行就超过字节上限时，返回的是替代命令而不是半行内容：

```text
[Line 1 is 60.0KB, exceeds 50.0KB limit. Use bash: sed -n '1p' a.ts | head -c 51200]
```

图片文件走另一条分支：识别 MIME、压缩到 2000×2000 以内、以 `image` 内容块回传；模型不支持图片时附一句说明。

`execute` 用 `new Promise` 包住异步逻辑，原因写在注释里：

```ts
// 1.async 函数本身就要返回promise
// 2.如果直接写逻辑，并用signal控制中断，那么有一种场景：读文件时用户按下esc，必须文件读完才能检查signal.abort，造成等待；
// 使用promise后，用户按下esc，触发reject，外层的await直接不等了，读文件还在继续，但外层已经不等待继续执行了，节约时间
```

即：中止要立刻生效，不等底层 I/O 自然结束。

### 2.6 write 与 edit：写文件的两条路

`write` 负责整文件覆盖，会自动创建父目录：

```ts
await ops.mkdir(dir);
throwIfAborted();
await ops.writeFile(absolutePath, content);
```

`edit` 负责精确替换，流程比 write 复杂得多：

```ts
const { bom, text: content } = splitBom(rawContent);
const originalEnding = detectLineEnding(content);
const normalizedContent = normalizeToLF(content);
const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);
const finalContent = bom + restoreLineEndings(newContent, originalEnding);
await ops.writeFile(absolutePath, finalContent);
```

四个细节各自解决一类真实问题：

| 处理 | 问题 |
|---|---|
| 剥离 BOM | 模型不会在 `oldText` 里写不可见字符 |
| 记录并还原行尾 | Windows 的 CRLF 不能被改成 LF |
| 统一转 LF 后匹配 | 否则同一份代码在不同行尾下匹配失败 |
| 模糊匹配 | 模型抄的缩进或空白常有偏差 |

写成功后返回 diff 与 unified patch，供界面展示和用户审阅。

### 2.7 同一文件的写操作要排队

`write` 与 `edit` 都包在 `withFileMutationQueue` 里：

```ts
const fileMutationQueues = new Map<string, Promise<void>>();

export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	// 以 realpath 为键：符号链接指向同一文件时也要排队
	const key = await getMutationQueueKey(filePath);
	const currentQueue = fileMutationQueues.get(key) ?? Promise.resolve();
	...
}
```

模型可能在同一轮并行发起两个针对同一文件的修改。没有队列时，两边各自读到旧内容、各自写回，后写的覆盖前写的。队列保证同文件串行，不同文件仍然并行，不牺牲吞吐。

### 2.8 grep / find / ls：搜索靠外部二进制

`grep` 与 `find` 不自己遍历目录，而是调用 ripgrep 与 fd：

```ts
const args: string[] = ["--json", "--line-number", "--color=never", "--hidden"];
if (ignoreCase) args.push("--ignore-case");
if (literal) args.push("--fixed-strings");
args.push("--", pattern, searchPath);
```

好处是自动遵守 `.gitignore`、跳过二进制文件、速度快，并且减少自己实现的边界情况。

二进制不存在时的处理在 `utils/tools-manager.ts`：先找系统 PATH，找不到再去 GitHub 下载到工具目录，离线模式（`PI_OFFLINE`）下跳过并给出警告。这一步是网络行为，属于本课需要单独决策的地方。

输出侧的限制：

| 工具 | 默认上限 |
|---|---|
| grep | 100 条匹配 |
| find | 1000 个结果 |
| ls | 500 个条目 |
| grep 单行 | 500 字符 |

达到上限时记录 `matchLimitReached` 这类字段，并在文本里提示“还有更多”。

### 2.9 bash：最重要的工具，也最危险

```ts
const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
	cwd,
	detached: process.platform !== "win32",   // 独立进程组，便于整树杀死
	env: env ?? getShellEnv(),
	stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
});
```

关键机制：

| 机制 | 作用 |
|---|---|
| `detached` + `killProcessTree` | 中止或超时时杀掉整个进程树，不留后台子进程 |
| `timeout` 参数 | 秒为单位，上限约 24 天，超时按错误结果返回 |
| `OutputAccumulator` | 边执行边累积输出，内存有上限，超出时写临时文件 |
| `onUpdate` 节流 | 流式汇报进度，按 `BASH_UPDATE_THROTTLE_MS` 限频 |
| 退出码 | 非 0 时把输出与 `Command exited with code N` 一起作为错误抛出 |

输出策略与 read 相反，保留尾部：

```text
[Showing lines 8000-10000 of 10000. Full output: /tmp/pi-bash-xxxx.log]
```

命令报错、被中止、超时，最终都变成 `isError: true` 的工具结果回填给模型，由模型决定下一步，循环本身不中断。

### 2.10 安全边界在哪里

内置工具没有任何沙箱，也没有逐次审批。边界由这些手段构成：

| 手段 | 限制了什么 |
|---|---|
| `cwd` 基准 | 相对路径落在工作目录，但绝对路径仍可访问其他位置 |
| 4 字符截断与上限 | 输出不会撑爆上下文 |
| 超时与中止 | 命令不会无限挂起 |
| 写入队列 | 不会互相覆盖 |
| schema 校验 | 参数形状错误在执行前被拦下 |

换句话说：**这些工具默认信任模型，安全性依赖运行环境**（容器、权限、项目信任）。真正的隔离不在工具层。路径解析与执行约束已在本课实现；审批与沙箱不在本项目范围（原计划的工具治理课已取消，见 D-068）。

### 2.11 与整体系统的关系

```text
@pipi/agent          循环、校验、事件
      ↑ AgentTool
@pipi/harness        八个工具 + 截断 + 队列 + 路径解析
      ↑ ToolDefinition
@pipi/tui            渲染器把工具执行展示成界面（后续课程）
```

工具属于 harness 层：它依赖 llm 的类型与 agent 的接口，不依赖界面。

### 2.12 小结

| 结论 | 说明 |
|---|---|
| 八个工具覆盖读写、搜索、命令 | 按 coding / read-only / all 三种集合装配 |
| 定义层与运行层分离 | 提示与渲染留在产品层，Agent 只拿执行能力 |
| 截断必须可续读 | 模型能自己继续，不需要人介入 |
| 写操作按文件排队 | 同文件串行、不同文件并行 |
| 搜索依赖 rg / fd | 省去自研遍历，但要处理二进制缺失 |
| bash 只有运行环境级别的隔离 | 工具层不做沙箱 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-23 | 范围 | 课程 11 验收后开始课程 12 | A 先讲工具职责与执行模型 |
| 2026-11-24 | 确认 | 六项决策全部落定：八个工具全做、图片按原项目、rg/fd 跟随上游、edit 跟随原项目、截断与队列本课做、`PI_*` 本课做 | B 范围扩大，任务拆为 13 项 |
| 2026-11-24 | 确认 | 任务按“一个工具一次完整交付”拆分，基础能力随首个使用它的工具一起做（D-061） | 4.3 改为 10 项 |
| 2026-11-24 | 实现 | 八个工具全部落地；工具与支撑模块分层（D-066）；编辑模糊匹配与下载器简化（D-064、D-067） | 4.2 增补实现说明 |
| 2026-11-24 | 验收 | 用户验收 T-12-1 至 T-12-10 | 课程 12 完成 |

---

## 4. B：具体实现规划

> B 已实现并验收（2026-11-24）。决策见 `BUILD_PLAN.md` D-054 至 D-067；任务 T-12-1 至 T-12-10。

实现位置：`packages/harness/src/tools/`（八个工具与注册表）、`tools/support/`（路径、截断、队列、diff、shell、下载器）、`images/`（图像管线）。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `core/tools/index.ts` | 224 | 工具注册、三种集合、定义与运行时互转 |
| `core/tools/read.ts` | 205 | 分段读取、截断续读、图片分支 |
| `core/tools/write.ts` | 97 | 整文件写入、父目录创建 |
| `core/tools/edit.ts` | 220 | 参数兼容、BOM/行尾处理、精确替换、diff |
| `core/tools/bash.ts` | 400 | 命令执行、进程树、超时、流式输出、环境变量 |
| `core/tools/powershell.ts` | 67 | 复用 bash 实现，仅换 shell 配置 |
| `core/tools/grep.ts` | 323 | ripgrep 调用、上下文行、限制与截断 |
| `core/tools/find.ts` | 318 | fd 调用、结果路径相对化 |
| `core/tools/ls.ts` | 175 | 目录列举与排序 |
| `core/bash-executor.ts` | 156 | 非工具路径的命令执行（交互模式直接跑命令） |
| `utils/tools-manager.ts` | 400 | rg / fd 的查找、下载与安装 |

截断、输出累积、写入队列、路径解析、diff 生成原本计划放在工具治理课，现已并入本课（D-057）。

### 4.2 已确认范围

| 模块 | 结论 | 依据 |
| --- | --- | --- |
| 八个工具 | 全部实现，含 `powershell` | D-054 |
| `read` 图片分支 | 按原项目：MIME、EXIF、缩放，依赖 `@silvia-odwyer/photon-node` 0.3.4 | D-055 |
| `edit` | 按原项目：模糊匹配、diff、unified patch | D-056 |
| `grep` / `find` | 按原项目：系统优先，缺失时自动下载 rg / fd | D-056 |
| 截断、输出累积、写入队列 | 本课实现 | D-057 |
| `PI_*` 环境变量 | 本课实现，默认开启 | D-058 |
| 渲染器 | 后置到 TUI 课程 | D-054 |

工具落位：`packages/harness/src/tools/`，与 `@pipi/agent` 的 `AgentTool` 对接。

### 4.3 任务拆分

按“一个工具一次完整交付”拆分：每个任务包含该工具用到的路径、基础设施、实现、测试与导出（D-061）。

| 任务 | 内容 | 依赖 |
| --- | --- | --- |
| T-12-1 | 基础：截断与输出累积 | — |
| T-12-2 | `read`（路径解析、图像管线、分段读取） | T-12-1 |
| T-12-3 | `write` 与写入队列 | T-12-2 |
| T-12-4 | `edit` 与 `edit-diff` | T-12-3 |
| T-12-5 | `ls` | T-12-2 |
| T-12-6 | `bash` 与 `PI_*` 环境变量 | T-12-1、T-12-2 |
| T-12-7 | `powershell` | T-12-6 |
| T-12-8 | `grep` 与 rg 获取 | T-12-1、T-12-2 |
| T-12-9 | `find` 与 fd 获取 | T-12-2、T-12-8 |
| T-12-10 | 工具注册、装配、测试与 changelog | T-12-2..9 |

### 4.4 复现选项

已确认选 A：完整复现八个工具与配套基础设施。

| 选项 | 范围 |
| --- | --- |
| A（已确认） | 八个工具全部复现，含 powershell、图片分支、自动下载、完整 edit |
| B（不采用） | 七个工具，powershell 与图片分支后置 |
| C（不采用） | 只做 read / write / edit / bash |

### 4.5 已确认结论

已写入 `BUILD_PLAN.md` 决策表，此处只列结论。

| 事项 | 结论 |
| --- | --- |
| 工具范围 | 八个，含 powershell（D-054） |
| `read` 图片分支 | 按原项目实现（D-055） |
| rg / fd 缺失 | 系统优先，缺失时下载（D-056） |
| `edit` 模糊匹配 | 完整复现（D-056） |
| 截断与队列 | 本课实现（D-057） |
| `PI_*` 环境变量 | 本课实现（D-058） |

原先分配给工具治理课的截断、输出累积、写入队列、diff、路径解析已并入本课；该课取消（D-068）。
