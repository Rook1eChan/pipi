# 09 Agent 循环与事件协议

> 课程状态：验收通过
> 覆盖模块：`@pipi/agent` 的循环控制与事件协议
> 课程文件：09-agent-loop.md
> 本课产出：模型调用、工具执行与事件推送被组织成一个可中断的循环。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| turn（轮） | 一条助手回复加上它触发的全部工具调用与结果。 |
| streamFn | 把模型与上下文变成流式事件的函数；类型在本课定义，调用方传入。 |
| steer | Agent 运行中插入的新指令，在当前轮结束后、下一次模型调用前注入。 |
| followUp | Agent 本该结束时才消费的追加消息，会开启新一轮。 |
| terminate | 工具结果中的标记；一批工具全部标记它时才提前停止。 |
| `AgentMessage` | 内部消息类型，比 LLM 消息更宽，允许自定义角色。 |

---

## 1. 构建目标

把课程 05 的模型调用封装成可连续工作的 Agent：

```text
模型回复 → 工具调用 → 工具结果回填 → 再调模型 → ... → 结束
```

本课只做循环本身，不做状态管理与消息队列（课程 10），也不做工具的具体实现（课程 11、12）。

---

## 2. A：概念与功能讲解

### 2.1 主线：两层循环

`my-pi/packages/agent/src/agent-loop.ts:36` 的 `runAgentLoop` 是整个模块的核心。它保留两套循环：

```ts
while (true) {
	let moreTurnsNeeded = true;

	while (moreTurnsNeeded || pendingMessages.length > 0) {
		// 1. 取 steer 消息并注入
		// 2. 调模型，消费流式事件，得到 AssistantMessage
		// 3. 提取 toolCall；有则执行工具并回填 ToolResultMessage
		// 4. emit turn_end；检查 shouldStopAfterTurn
	}

	// 内层结束：取 followUp 消息；有则继续外层循环
}
```

职责划分：

| 循环 | 解决的问题 |
| --- | --- |
| 内层 | 工具调用产生的连续回合，直到模型不再要求工具 |
| 外层 | Agent 已经空闲时，处理排队等待的追加指令 |

两个队列的区别是语义层面的：`steer` 用来改变正在进行的任务方向，`followUp` 是等任务完成后才处理的新指令。

### 2.2 事件协议

`my-pi/packages/agent/src/types.ts:422` 定义 `AgentEvent`，共四类：

```ts
export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

事件层次与循环层次对应：

```text
agent_start
  turn_start
    message_start / message_update / message_end       模型流式回复
    tool_execution_start / update / end                每个工具
    message_start / message_end                        每条工具结果
  turn_end
agent_end
```

`emit` 是 `AgentEventSink`，签名 `(event) => void | Promise<void>`，因此 UI 可以异步处理事件。所有事件都由循环串行 `await`，保证顺序稳定。

### 2.3 流式回复如何变成一条消息

`streamAssistantResponse`（`agent-loop.ts:168`）消费课程 05 的事件流，维护 `partialMessage`：

```ts
for await (const event of response) {
	switch (event.type) {
		case "start":
			partialMessage = event.partial;
			context.messages.push(partialMessage);
			await emit({ type: "message_start", message: { ...partialMessage } });
			break;
		case "text_delta": // 以及 thinking / toolcall 的各种 delta
			partialMessage = event.partial;
			context.messages[context.messages.length - 1] = partialMessage;
			await emit({ type: "message_update", ... });
			break;
		case "done":
		case "error":
			context.messages[context.messages.length - 1] = await response.result();
			await emit({ type: "message_end", message: finalMessage });
			return finalMessage;
	}
}
```

这里有两个设计点：

1. **partial 直接在消息历史里原地替换**。UI 看到的是同一个位置不断更新的对象，而不是每条 delta 追加一条消息。
2. **最终结果从 `response.result()` 取**。流式 delta 可能不完整，尤其是工具参数；用最终结果替换 partial 保证消息历史可用。

调用模型之前还有三步准备（`agent-loop.ts:170` 起）：

```text
transformContext(messages)  可选，裁剪上下文
convertToLlm(messages)      必填，AgentMessage → Message
组装 Context + 解析 apiKey
```

`convertToLlm` 是必填钩子，因为内部消息可能包含自定义角色，LLM 不认识。

### 2.4 工具调用批次

`executeToolCalls`（`agent-loop.ts:327`）决定执行方式：

```ts
const hasSequentialToolCall = toolCalls.some(
	(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
);
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
	return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

规则：**全局配置或任何一个工具声明 sequential，整批串行；否则并行**。

并行实现并非直接 `Promise.all` 所有执行，而是先把每个工具做预检（`prepareToolCall`），再并发执行。这样"工具不存在"、"参数校验失败"、"beforeToolCall 拦截"在并发开始前就已经确定，结果顺序与助手消息中的工具调用顺序一致。

`prepareToolCall`（`agent-loop.ts:533`）的顺序：

```text
找工具 → prepareArguments → validateToolArguments → beforeToolCall → 返回 prepared
```

任一步失败都返回 `kind: "immediate"` 的错误结果，不进入执行阶段。`afterToolCall` 在执行后调用，可覆盖 `content`、`details`、`isError`、`usage`、`terminate`。

另一个边界：`stopReason === "length"` 时，工具参数可能被截断。循环不会执行这些调用，而是为每一条生成错误结果（`failToolCallsFromTruncatedMessage`），提示模型重新发起完整调用。

### 2.5 钩子位置

`AgentLoopConfig`（`types.ts:147`）把扩展点集中在一次运行的几个时刻：

| 钩子 | 时机 | 作用 |
| --- | --- | --- |
| `transformContext` | 调模型前 | 裁剪或注入上下文 |
| `getApiKey` | 每次调模型 | 动态解析 key，支持过期刷新 |
| `shouldStopAfterTurn` | `turn_end` 之后 | 请求优雅停止 |
| `prepareNextTurn` | 下一轮开始前 | 替换 context / model / thinking 状态 |
| `getSteeringMessages` | 每轮注入前 | 取中途插队消息 |
| `getFollowUpMessages` | 内层循环结束 | 取排队追加消息 |
| `beforeToolCall` | 参数校验后、执行前 | 拦截工具 |
| `afterToolCall` | 执行后、事件发出前 | 改写工具结果 |

约定：这些钩子不能抛异常，失败要返回安全兜底值，否则会破坏事件序列。

### 2.6 终止条件

循环在以下条件退出：

| 条件 | 处理 |
| --- | --- |
| 模型 `stopReason` 是 `error` 或 `aborted` | `turn_end` 后直接 `agent_end` |
| 无工具调用、无 steer / followUp | 内层退出，外层 break |
| `shouldStopAfterTurn` 返回 true | `agent_end` |
| 一批工具全部 `result.terminate === true` | `moreTurnsNeeded = false` |

注意 `terminate` 是批次级语义：`shouldTerminateToolBatch` 要求整批都标记才生效，避免一个工具的判断影响其他工具。

### 2.7 与整体系统的关系

```text
课程 05  AssistantMessageEventStream
课程 09  StreamFn（本课定义）
   ↓
课程 09  runAgentLoop + AgentEvent          ← 本课
   ↓
课程 10  Agent 状态机与消息队列（订阅事件、管理 idle/running）
   ↓
课程 11  AgentTool 执行语义与参数校验
```

本课输出的是一次性的函数：`runAgentLoop(prompts, context, config, emit, signal, streamFn)`。它不保存状态、不订阅事件、不管理会话；这些都是上层课程的事。

### 2.8 小结

| 结论 | 说明 |
| --- | --- |
| 两层循环 | 内层处理工具回合，外层处理 followUp |
| 事件有层次 | agent / turn / message / tool_execution 四组 |
| partial 原地替换 | 消息历史里始终一条助手消息，逐步更新 |
| 最终结果用 `result()` | 防止流式工具参数不完整 |
| 批次执行 | 一处要求串行，整批串行 |
| 钩子集中在配置里 | 扩展不改循环主体 |
| 函数无状态 | 状态与队列由课程 10 提供 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-18 | 流程 | 用户要求 A 缩短，只讲清概念与架构并配合代码；重心放在 A、B 之后的实现 | 本课 A 采用短讲解 + 源码片段 |
| 2026-11-18 | 状态 | 用户验收课程 07；课程 08 跳过，不实现图像生成 | 09 直接开始，08 不进入 B |
| 2026-11-20 | 状态 | 用户验收 T-09-1 至 T-09-5 | 课程 09 完成 |

---

## 4. B：具体实现规划

> B 已确认并实现（2026-11-18）；T-09-1 至 T-09-5 于 2026-11-20 验收。决策见 `BUILD_PLAN.md` D-047、D-048。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `agent/src/agent-loop.ts` | 725 | `runAgentLoop`；`streamAssistantResponse`；`executeToolCalls` 的串行/并行分支；`prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall`；`failToolCallsFromTruncatedMessage` |
| `agent/src/types.ts` | 437 | `AgentEvent`、`AgentLoopConfig`、工具与结果类型、`AgentMessage` 声明合并 |
| `agent/src/stream-fn.ts` | 20 | 全局默认 `streamFn` 槽位；`getDefaultStreamFn` 未配置时抛错 |

原项目还有 `agent/src/agent.ts`（617 行）与 `proxy.ts`（402 行），属于课程 10 的状态机，不在本课范围。

`stream-fn.ts` 是历史兼容层：旧版第三方扩展构造 `Agent` 时不传 `streamFn`，宿主在 `sdk.ts` 里调用 `setDefaultStreamFn(streamSimple)` 兜底。本课不复现，见 D-047。

### 4.2 新项目实现

#### 4.2.1 类型

在 `packages/agent/src/types.ts` 定义，从 `@pipi/llm` 复用消息、内容块、`Usage`、`Context`、`Model`、`SimpleStreamOptions`、`AssistantMessageEvent`、`AssistantMessageEventStream`：

| 类型 | 要点 |
| --- | --- |
| `StreamFn` | `(model, context, options?) => AssistantMessageEventStream \| Promise<...>`；调用方必传 |
| `ToolExecutionMode` | `"sequential" \| "parallel"` |
| `AgentToolCall` | 等于 `ToolCall` |
| `AgentToolResult<T>` | `content`、`details`、`usage?`、`addedToolNames?`、`terminate?` |
| `AgentTool<TParams, TDetails>` | 继承 `Tool`，增加 `label`、`prepareArguments?`、`execute`、`replay?`、`executionMode?` |
| `AgentContext` | `systemPrompt`、`messages`、`tools?` |
| `AgentMessage` | `Message` 与 `CustomAgentMessages` 的联合，支持声明合并 |
| `AgentEvent` | A 节列出的四组事件 |
| `AgentLoopConfig` | 继承 `SimpleStreamOptions`，含 `model`、`convertToLlm` 与全部钩子 |

工具参数校验不在本课：`@pipi/llm` 没有 `validateToolArguments`，课程 11 再补。`prepareArguments` 仍按工具可选钩子执行。

#### 4.2.2 循环主体

`packages/agent/src/agent-loop.ts` 导出：

```ts
export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]>
```

步骤与 A 节一致：前奏事件 → steer 注入 → 调模型 → 工具批次 → `turn_end` → `shouldStopAfterTurn` → `prepareNextTurn` → followUp → `agent_end`。

`streamFn` 本身抛错时构造一条 `stopReason: "error"` 的助手消息，保持“失败也进消息历史”的约定。

#### 4.2.3 流式消费

`streamAssistantResponse` 消费事件：`start` 时把 partial 入历史并发 `message_start`；中间 delta 原地替换并发 `message_update`；`done` / `error` 时用 `response.result()` 的最终消息替换，并发 `message_end`。

调模型前的顺序：`transformContext` → `convertToLlm` → 组装 `Context` → `getApiKey` → `streamFn`。

#### 4.2.4 工具批次

| 函数 | 职责 |
| --- | --- |
| `executeToolCalls` | 决定串行或并行：全局配置或任一工具声明 `sequential` 则整批串行 |
| `prepareToolCall` | 查工具 → `prepareArguments` → `beforeToolCall`；失败返回 immediate 错误结果 |
| `executePreparedToolCall` | 调 `tool.execute`，收集 `onUpdate` 事件，异常转错误结果 |
| `finalizeExecutedToolCall` | `afterToolCall` 逐字段覆盖结果 |
| `createToolResultMessage` | 生成 `ToolResultMessage`，补齐 `timestamp` |
| `failToolCallsFromTruncatedMessage` | `stopReason === "length"` 时不执行任何调用，逐条生成错误结果 |

并行分支：先顺序预检，再并发执行；`tool_execution_end` 按完成顺序发出，`ToolResultMessage` 按助手消息中的原顺序发出。

`terminate` 是批次级规则：只有整批结果都标记 `terminate: true` 才停止后续轮次。

#### 4.2.5 不实现

- `stream-fn.ts` 与全局默认槽位（D-047）
- 工具参数校验（课程 11）
- `Agent` 状态机、消息队列与 `proxy`（课程 10）
- 会话持久化与压缩（课程 14、16）

### 4.3 任务拆分

| 任务 ID | 目标与范围 | 文件/模块 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| T-09-1 | 定义 `StreamFn`、`AgentEvent`、`AgentLoopConfig`、工具与上下文类型 | `packages/agent/src/types.ts` | T-07-4 | `tsc --noEmit` 通过，类型从包入口导出 |
| T-09-2 | `runAgentLoop` 循环主体、事件顺序、steer/followUp、终止条件 | `packages/agent/src/agent-loop.ts` | T-09-1 | 事件顺序测试通过 |
| T-09-3 | `streamAssistantResponse`：partial 替换、最终结果、错误信息 | `packages/agent/src/agent-loop.ts` | T-09-2 | 流式消息测试通过 |
| T-09-4 | 工具批次：串行/并行、预检、钩子、length 截断、terminate | `packages/agent/src/agent-loop.ts` | T-09-3 | 工具执行测试通过 |
| T-09-5 | 导出、测试与 changelog | `packages/agent/src/index.ts`、`packages/agent/test/*`、`packages/agent/CHANGELOG.md` | T-09-1..4 | `build`、`test`、`check` 通过 |

### 4.4 测试与验收

测试用脚本化的 `streamFn`：直接向 `AssistantMessageEventStream` push `start` / `done`，按顺序返回多条助手消息，不需要真实网络。

| 用例 | 断言 |
| --- | --- |
| 纯文本回复 | 事件顺序；返回消息包含 prompt 与 assistant |
| 工具调用闭环 | 工具执行 → 结果回填 → 下一轮模型回复 → `agent_end` |
| 串行与并行 | `executionMode` 生效；并行时结果消息保持原始顺序 |
| `beforeToolCall` 拦截 | 不执行工具，产生错误结果 |
| `afterToolCall` 覆盖 | 字段逐项替换 |
| `length` 截断 | 不执行工具，全部为错误结果 |
| `terminate` | 整批终止时不再调模型 |
| 中止 | `aborted` 后不执行工具 |
| steer / followUp | 注入时机正确 |
| `streamFn` 抛错 | 转成 `error` 助手消息 |

验收标准：`npm run build -w @pipi/agent`、`npm test -w @pipi/agent`、`npm run check` 全部通过，changelog 有 Added 条目。

### 4.5 复现选项

| 选项 | 状态 |
| --- | --- |
| 完整复现循环、事件、批次与钩子，`AgentMessage` 支持自定义角色 | 已确认（D-048） |
| 先做单工具串行循环 | 未采用 |
| 只做事件类型 | 未采用 |

### 4.6 待确认决策

无。D-019（OAuth 后置，课程 07 复审）已多次提醒，仍未决定。
