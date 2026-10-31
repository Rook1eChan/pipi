# 02 LLM 数据契约：一次请求与一次工具回合

> 课程状态：A 学习中
> 覆盖模块：`@pipi/llm` 的公共类型与数据契约
> 课程文件：02-core-types.md
> 本课产出：定义 `@pipi/llm` 的公共数据契约，支撑一次请求、一次工具回合与跨 provider 回放。

---

## 1. 构建目标

定义一组类型，让下面这些完全不同的东西可以互相替换、组合、序列化：

- OpenAI 的 `chat.completion.chunk`
- Anthropic 的 `content_block_delta`
- 本地 llama.cpp 的 OpenAI 兼容响应
- Agent 内部的自定义消息（通知、压缩摘要、分支摘要）
- 落盘后的 JSONL 会话记录

这一篇只定义"数据长什么样"和"不变量是什么"，不实现任何网络请求。

---

## 2. A：概念与功能讲解

### 2.1 主线：一次请求从哪开始，到哪结束

这一课讲 `packages/llm/src/types.ts`，也就是 `@pipi/llm` 的公共数据契约。它要回答的不是“有哪些类型”，而是：

> 一次模型调用从构造输入到拿回结果，需要哪些数据？这些数据为什么必须长这样？

用一个具体任务贯穿全课：

```text
用户：读取 src/a.ts，然后总结它的作用
```

完整的请求生命周期：

```text
1. 构造 Context
   systemPrompt + 历史消息 + 可用工具（read）

2. 选择 Model
   告诉运行时用哪个模型、它支持什么、价格多少

3. 发起调用
   适配器把 Context + Model 翻译成 provider 的请求

4. 得到 AssistantMessage
   content = [thinking, text, toolCall(read, {path: "src/a.ts"})]
   stopReason = "toolUse"

5. 执行工具
   读取文件，得到 ToolResultMessage
   toolCallId 必须对应第 4 步的工具调用

6. 把工具结果放回 Context
   再次调用模型，得到最终总结

7. 记录这次调用的账本
   Usage：token 与费用；StopReason：为什么结束
```

后面每一节都对应这条线上的一个时刻。每个类型只回答三个问题：

1. 它在生命周期的哪一步出现？
2. 没有它，哪个下游功能会坏？
3. 它必须守住什么不变量？

这一课**不**实现网络请求、流式解析、工具执行或会话持久化。那些分别是课程 03、05、11、14。

---

### 2.2 请求容器：`Context`

一次调用需要三样东西：

```ts
interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}
```

对应上面的例子：

```ts
const context: Context = {
	systemPrompt: "You are a coding agent. Read files before answering.",
	messages: [
		{
			role: "user",
			content: "读取 src/a.ts，然后总结它的作用",
			timestamp: Date.now(),
		},
	],
	tools: [readTool],
};
```

为什么只有这三个字段：

- `systemPrompt`：本次调用的全局指令
- `messages`：用户、助手、工具结果组成的历史
- `tools`：本次允许模型调用的工具

刻意**不**放进来：

| 不放什么 | 放在哪里 |
|---|---|
| provider 的 API key、baseUrl | `Model` 与请求 options |
| 会话树、分支、压缩摘要 | `coding-agent` 的会话层 |
| UI 状态、主题、滚动位置 | `tui` / 交互层 |
| 重试策略 | 请求层（课程 06） |

`Context` 是“一次请求的输入快照”。它不关心这次请求属于哪个会话、第几轮。

**不变量**

- `messages` 按时间顺序排列
- `tools` 的名字在本次请求内唯一且稳定
- `systemPrompt` 为空时，适配器不能凭空补一个

---

### 2.3 用户输入：`UserMessage`

用户消息的内容有两种写法：

```ts
interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}
```

纯文字可以直接用字符串：

```ts
{ role: "user", content: "读取 src/a.ts", timestamp: Date.now() }
```

需要图片或混合内容时用块数组：

```ts
{
	role: "user",
	content: [
		{ type: "text", text: "这张图里的错误是什么？" },
		{ type: "image", data: "<base64>", mimeType: "image/png" },
	],
	timestamp: Date.now(),
}
```

为什么允许两种写法：

- 字符串是常见情况，写起来简单
- 块数组是多模态与结构化内容的统一表示
- 适配器在发送前会把字符串规范成文本块

`ImageContent` 用 base64 而不是 URL：

- 多数 provider 要求内联字节
- URL 可能过期、需要鉴权、或根本不可访问
- 由调用方负责读取和编码，适配器不猜

**不变量**

- `timestamp` 是毫秒
- 图片必须带正确的 `mimeType`
- 用户消息不包含 `ThinkingContent` 或 `ToolCall`

---

### 2.4 工具声明：`Tool`

工具告诉模型“你能做什么”，但不负责执行：

```ts
interface Tool<TParameters extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: TParameters;
	constrainedSampling?: false | ConstrainedSamplingConfig;
}
```

例子：

```ts
const readTool: Tool = {
	name: "read",
	description: "Read a text file from the workspace.",
	parameters: Type.Object({
		path: Type.String({ description: "File path relative to the workspace root" }),
	}),
};
```

三个字段各有职责：

| 字段 | 给谁看 | 作用 |
|---|---|---|
| `name` | 模型与运行时 | 模型按名字发起调用；必须稳定 |
| `description` | 模型 | 决定模型什么时候用它 |
| `parameters` | 模型与校验器 | 参数 schema；模型据此生成 JSON，运行时据此校验 |

为什么用 TypeBox 而不是普通 JSON Schema：

- 同一份定义既能生成 provider 需要的 JSON Schema，又能做本地类型推导
- 运行时可以用编译后的校验器检查模型输出
- 参数错误可以在本地拦下，并把错误信息回填给模型

`constrainedSampling` 是可选优化：让支持 grammar 的 provider 约束输出格式；不支持时退回普通函数调用。

**不变量**

- `name` 一旦发布不能随意改，否则历史会话里的工具调用会对不上
- `parameters` 必须是对象 schema，不能是裸字符串
- 工具声明不包含执行逻辑；执行在课程 11、12

---

### 2.5 模型描述：`Model`

`Model` 是数据，不是类：

```ts
interface Model<TApi extends Api> {
	id: string;
	name: string;
	api: TApi;
	provider: ProviderId;
	baseUrl: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: ThinkingLevelMap;
	samplingParams?: Record<string, unknown>;
	headers?: Record<string, string>;
	compat?: ...;
}
```

例子：

```ts
const model: Model<"openai-completions"> = {
	id: "gpt-4.1",
	name: "GPT-4.1",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 32_768,
};
```

为什么是数据：

- 模型目录可以从 JSON 生成
- 自定义 provider 只需要提供一条记录
- 测试可以构造任意模型，不需要网络

关键字段的用途：

| 字段 | 用途 |
|---|---|
| `api` | 选择哪个适配器（`openai-completions`、`anthropic-messages`…） |
| `provider` | 认证、路由、显示 |
| `contextWindow` | 压缩阈值（课程 16） |
| `maxTokens` | 输出上限 |
| `cost` | 把 `Usage` 换算成金额 |
| `input` | 是否支持图片；不支持时降级 |
| `compat` | 同一 API 家族内的端点差异 |

`compat` 是现实妥协：OpenAI 兼容端点之间在 `developer` 角色、`reasoning_effort`、`max_completion_tokens` 等字段上并不一致。这些差异不能污染统一类型，所以放在按 API 区分的可选配置里，由适配器读取。

**不变量**

- `id` 在同一个 provider 内唯一
- `api` 必须能映射到一个适配器
- `contextWindow` 与 `maxTokens` 必须是正数

---

### 2.6 模型响应：`AssistantMessage`

模型返回的是一条助手消息：

```ts
interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: ProviderId;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	timestamp: number;
	responseId?: string;
	errorMessage?: string;
	diagnostics?: AssistantMessageDiagnostic[];
}
```

对应例子：

```ts
{
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "需要先读取文件" },
		{ type: "text", text: "我先看一下这个文件。" },
		{
			type: "toolCall",
			id: "call_1",
			name: "read",
			arguments: { path: "src/a.ts" },
		},
	],
	api: "openai-completions",
	provider: "openai",
	model: "gpt-4.1",
	usage: { input: 120, output: 45, cacheRead: 0, cacheWrite: 0, totalTokens: 165, cost: {...} },
	stopReason: "toolUse",
	timestamp: Date.now(),
}
```

为什么 `content` 是数组：

- 一条回复可以同时有思考、文本和多个工具调用
- 顺序有意义：模型先生成什么，就按什么顺序放
- 流式输出需要按块定位（`contentIndex`，课程 03）

三种块的角色：

| 块 | 谁产生 | 用途 |
|---|---|---|
| `TextContent` | 助手 | 给用户看的文本 |
| `ThinkingContent` | 助手 | 推理内容，部分 provider 可回放 |
| `ToolCall` | 助手 | 请求执行工具，包含 `id`、`name`、`arguments` |

为什么 `ThinkingContent` 和 `ToolCall` 只出现在助手消息：

- 用户不会“思考”
- 工具不会“请求调用工具”
- 角色语义决定了块集合

`contentIndex` 不属于持久化消息。它只在流式事件里出现，指向 `content` 数组的位置。

**不变量**

- `stopReason` 为 `pending` 只出现在流式中间态
- `error` / `aborted` 必须带 `errorMessage`
- `toolCall.id` 在一条消息内唯一
- `usage.reasoning` 必须是 `output` 的子集

---

### 2.7 工具结果：`ToolResultMessage`

工具执行完，结果作为一条独立消息回到上下文：

```ts
interface ToolResultMessage<TDetails = any> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	usage?: Usage;
	addedToolNames?: string[];
	isError: boolean;
	timestamp: number;
}
```

与 2.6 的工具调用配对：

```ts
{
	role: "toolResult",
	toolCallId: "call_1",
	toolName: "read",
	content: [{ type: "text", text: "export function add(a, b) { return a + b; }" }],
	isError: false,
	timestamp: Date.now(),
}
```

关键点：

- `toolCallId` 必须等于某个 `ToolCall.id`
- `toolName` 用于显示与调试
- `content` 可以是文本或图片：工具可能返回截图、图表
- `isError` 表示工具执行失败，不是模型失败
- `details` 给 UI 用（例如 diff、退出码），不一定要发给模型
- `usage` 是工具自身的消耗，不进入主对话的 token 账本

如果结果找不到对应的调用，或者调用没有结果，部分 provider 会直接拒绝请求。`transformMessages`（课程 06）会补一个“无结果”的错误结果兜底。

**不变量**

- 每个 `ToolCall` 最终必须有一个 `ToolResultMessage`
- `toolCallId` 不能凭空编造
- 工具错误用 `isError: true`，不要把错误文本伪装成正常结果

---

### 2.8 调用账本：`Usage` 与 `StopReason`

一次调用结束，消息要回答两个问题：花了多少？为什么结束？

```ts
interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	reasoning?: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}
```

计算口径：

```text
totalTokens = input + output + cacheRead + cacheWrite
```

注意：

- `input` 是**扣除缓存读写之后**的输入 token，否则会重复计数
- `reasoning` 是 `output` 的子集，不能再加进 `totalTokens`
- `cost` 由 `Model.cost` 与 usage 计算，不能让 provider 直接给
- provider 没报告的字段保持 `undefined`，不要伪造 0

`StopReason` 决定循环下一步做什么：

| 值 | 含义 | 循环行为 |
|---|---|---|
| `pending` | 流尚未结束 | 只出现在中间态 |
| `stop` | 正常结束 | 结束本轮 |
| `length` | 达到输出上限 | 结束本轮，通常提示用户 |
| `toolUse` | 请求调用工具 | 执行工具并继续 |
| `error` | 请求或解析失败 | 结束，错误已编码在消息里 |
| `aborted` | 用户中止 | 结束，保留部分内容 |
| `deferred` | provider 返回异步句柄 | 后续取回 |

为什么错误不抛异常：

- UI 需要展示已经生成的部分内容
- 会话需要决定是否保存这次失败的尝试
- 重试逻辑需要根据错误类型判断是否可重试

所以错误是消息的一种状态，不是控制流异常。

**不变量**

- 最终消息的 `stopReason` 不能是 `pending`
- `error` / `aborted` 必须有 `errorMessage`（`aborted` 可为空）
- `totalTokens` 必须与四个分项一致

---

### 2.9 跨 provider：同一套类型如何映射

统一类型只解决“形状”，不解决“语义差异”。适配器负责映射：

| 统一类型 | OpenAI | Anthropic | Google |
|---|---|---|---|
| `TextContent` | `content` | `text` block | `text` part |
| `ThinkingContent` | `reasoning_content` / `reasoning` | `thinking` block | `thought` part |
| `ToolCall` | `tool_calls[]` | `tool_use` block | `functionCall` |
| `ToolResultMessage` | `role: "tool"` | `tool_result` block | `functionResponse` |
| `Usage` | `prompt_tokens` / `completion_tokens` | `input_tokens` / `output_tokens` | `promptTokenCount` / `candidatesTokenCount` |

跨模型回放时还要处理：

- 非视觉模型收到图片 → 替换为文本占位符
- 同模型回放 thinking → 保留签名；跨模型 → 转成普通文本或丢弃
- 跨 provider 的工具调用 ID → 归一化为合法字符集
- 孤立的工具调用 → 补一个错误结果
- `error` / `aborted` 的助手消息 → 不回放，避免污染上下文

这些规则在课程 06 的 `transformMessages` 里实现。本课只需要知道：**类型必须为这些转换留出字段**，比如 `thinkingSignature`、`redacted`、`toolCall.id`。

无法统一的部分：

- provider 特有的签名与加密载荷
- 端点兼容开关（`compat`）
- 某些 provider 特有的请求参数

它们不应该进入统一类型的主体，只能放在可选字段或适配器内部。

---

### 2.10 与上层边界：`AgentMessage` 与 `convertToLlm`

`Message` 是给模型看的；`AgentMessage` 是给应用看的：

| 概念 | 定义位置 | 能包含什么 | 谁使用 |
|---|---|---|---|
| `Message` | `@pipi/llm` | `user` / `assistant` / `toolResult` | 适配器、模型 API |
| `AgentMessage` | `@pipi/agent` | `Message` + 应用自定义消息 | Agent 循环、会话、UI |

为什么需要 `AgentMessage`：

- 会话要记录“压缩摘要”“分支摘要”“bash 执行记录”这类不发给模型的内容
- 扩展可能插入自己的消息类型
- 但模型只认识三种角色

转换发生在每次调模型前：

```text
AgentMessage[] ──transformContext()──► AgentMessage[] ──convertToLlm()──► Message[] ──► LLM
```

`convertToLlm` 的契约：

- 必须把每条 `AgentMessage` 映射成合法的 `UserMessage` / `AssistantMessage` / `ToolResultMessage`，或者安全丢弃
- 不能抛异常；抛异常会中断循环且没有正常事件序列
- 纯 UI 消息、压缩摘要、分支摘要通常被过滤掉

本课只定边界：会话层的类型不放进 `@pipi/llm`，循环层的转换在课程 09 实现。

---

### 2.11 这一层不做什么，以及必须守住的不变量

`@pipi/llm` 的类型层**不负责**：

- 发 HTTP 请求（课程 05、06）
- 解析 SSE 流（课程 03、05）
- 执行工具（课程 11、12）
- 持久化会话（课程 14）
- 压缩上下文（课程 16）
- 渲染 UI（课程 22–24）

它只负责“数据长什么样”和“跨层共识”。

必须守住的不变量：

| 不变量 | 违反后的后果 |
|---|---|
| `totalTokens = input + output + cacheRead + cacheWrite` | 成本统计与压缩阈值错误 |
| `reasoning ⊆ output` | 重复计数 |
| `toolResult.toolCallId` 对应某个 `ToolCall.id` | provider 拒绝请求 |
| `timestamp` 为毫秒 | 会话排序错乱 |
| `stopReason !== "pending"` 于最终消息 | 循环不知道是否继续 |
| `error` / `aborted` 带 `errorMessage` | UI 无法解释失败 |
| 工具名稳定 | 历史会话的工具调用无法回放 |

带着这条主线进入 B 阶段：先定义 `Context`，再定义输入、工具、模型、输出、结果、账本，最后处理跨 provider 与上层边界。B 阶段会给出文件划分、类型顺序、测试和不变量清单。

---

### 2.12 与整体系统的关系

- 依赖：01 的包结构
- 支撑：03 流协议、04 注册表、09 循环、11 工具执行、14 会话持久化、16 压缩
- 后续修改类型的成本很高，因此 A 阶段要重点理解这些不变量。

---

## 3. 讨论与确认记录

> 学习本课程时，问题、解释、结论、已确认决策以及对 B 阶段的影响记录在此。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-10-31 | 反馈 | 用户指出 A 阶段像类型词典，结构散 | 按请求生命周期重写为 2.1–2.11 |
| 2026-10-31 | 讨论 | 课程主线改为“一次请求 + 一次工具回合” | B 4.3 的类型顺序同步调整 |

---

## 4. B：具体实现规划

### 4.1 原项目实现

| 文件 | 内容 | 行数 |
| --- | --- | --- |
| `packages/ai/src/types.ts` | 全部核心类型：消息、内容块、usage、tool、model、事件、兼容配置 | 843 |
| `packages/ai/src/utils/validation.ts` | TypeBox 校验与参数强制转换 | 350 |
| `packages/ai/src/api/transform-messages.ts` | 跨 provider 归一化 | 223 |
| `packages/agent/src/types.ts` | `AgentMessage`、`AgentTool`、`AgentEvent`、循环配置 | 437 |

原项目把所有类型放在一个 `types.ts`，原因是：

- 类型之间互相引用密集（`AssistantMessage` 引用 `Usage`、`ToolCall`；`Model` 引用 `compat`）
- 拆文件会产生大量循环导入
- 类型只在编译期存在，单文件不影响运行时体积

### 4.2 新项目建议结构

建议先保持单文件，等稳定后再拆：

```text
packages/llm/src/
├── types.ts          # 所有公共类型
├── index.ts          # 导出 types 与 Type
└── utils/
    └── validation.ts # 工具参数校验（11 使用）
```

如果后续觉得太大，可以按主题拆分并由 `types.ts` 统一 re-export：

```text
types/
├── content.ts
├── message.ts
├── model.ts
├── tool.ts
├── usage.ts
├── events.ts
└── index.ts
```

### 4.3 需要定义的类型（建议顺序）

1. 请求容器：`Context`、`StreamOptions`、`SimpleStreamOptions`
2. 输入：`UserMessage`、`TextContent`、`ImageContent`
3. 工具声明：`Tool`
4. 模型：`Model`、`ModelCost`、`ModelCostTier`
5. 输出：`AssistantMessage`、`ThinkingContent`、`ToolCall`
6. 结果：`ToolResultMessage`、`Usage`、`StopReason`
7. 基础别名：`Api`、`ProviderId`、`ThinkingLevel`
8. 事件：`AssistantMessageEvent`（03 详述）

### 4.4 关键不变量

实现时必须用测试固定这些规则：

| 不变量 | 说明 |
| --- | --- |
| `totalTokens === input + output + cacheRead + cacheWrite` | 原项目的计算口径；注意 `input` 已扣除缓存读写，否则会重复计数 |
| `reasoning <= output` | 推理 token 是输出子集 |
| `toolResult.toolCallId` 必须对应一条 `assistant` 消息中的 `toolCall.id` | 否则 API 会拒绝；由 `transformMessages` 兜底 |
| `timestamp` 为毫秒 | 会话排序依赖 |
| `stopReason === "pending"` 只出现在流式中间态 | 最终消息必须是终态 |
| `error` / `aborted` 消息必须带 `errorMessage`（`aborted` 可为空） | UI 需要展示原因 |

### 4.5 工具参数校验

`validateToolArguments()` 的职责：

1. 深拷贝参数，避免修改模型返回的原对象
2. 删除"可选字段的 null"（模型经常把可选字段填成 `null`）
3. 用 `Value.Convert` 做基础类型转换（字符串数字 → 数字等）
4. 用编译后的 TypeBox validator 校验
5. 失败时生成带路径的错误信息，交给 Agent 作为工具错误结果返回给模型

为什么不让模型"自己保证格式"：模型输出不可信，必须本地校验；错误信息回填给模型后，它通常能自我修正。

### 4.6 与原项目的取舍

| 原项目字段 | 建议 | 理由 |
| --- | --- | --- |
| `TextSignatureV1` / `thinkingSignature` | 保留 | 多轮回放需要；可以简化解析 |
| `DeferredHandle` / `deferred` | 可后置 | 只有部分 provider 支持异步响应 |
| `namespace` | 可后置 | 只有 OpenAI Responses 的动态工具使用 |
| `cacheWrite1h` | 保留 | Anthropic 计费准确 |
| `ModelCostTier` | 可后置 | 只有少数模型有阶梯计价 |
| `compat` 全量字段 | 先保留子集 | 只保留首个适配器需要的字段 |
| `ImagesModel` / `AssistantImages` | 可后置到 08 | 与文本 Agent 独立 |

### 4.7 测试

| 测试 | 内容 |
| --- | --- |
| 类型构造 | 构造一条包含文本、思考、工具调用的助手消息，能被 JSON 序列化/反序列化 |
| usage 计算 | 给定 provider usage，计算 `totalTokens` 与 `cost` |
| 参数校验 | 合法参数通过；缺字段、类型错误、可选字段为 null 的行为符合预期 |
| 不变量 | `reasoning <= output`、工具结果能匹配调用 |
| 跨 provider | 用 `transformMessages` 处理图片、thinking、孤立工具调用 |

### 4.8 待确认决策

- 是否保留 `deferred` 相关类型（课程 05）
- `compat` 字段先支持哪些（取决于第一个适配器选 OpenAI Completions 还是 Responses）
- 是否从一开始就支持图像（课程 08）

---

### 4.9 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 单文件 | 与原文一致 | 推荐 |
| 按主题拆分 | 更清晰 | 可选，注意循环引用 |
| 精简 usage | 只保留 input/output | 不推荐：压缩与统计会缺数据 |
| 省略签名 | 简化实现 | 可选，但跨轮 thinking 会失效 |
| 省略 `compat` | 简化模型类型 | 不推荐：第一个适配器就会遇到 |
