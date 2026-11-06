# 03 流式响应协议

> 课程状态：验收通过
> 覆盖模块：`@pipi/llm` 流式协议、增量 JSON 解析、延迟初始化
> 课程文件：03-streaming-protocol.md
> 本课产出：一套与 provider 无关的流式事件协议，让上层能实时显示文本、思考、工具参数，并统一处理错误与中止。

---

## 1. 构建目标

实现 `AssistantMessageEventStream`：

- 生产者可以随时 `push(event)`，消费者可以 `for await` 增量读取
- 流结束时，消费者可以 `await stream.result()` 拿到完整的 `AssistantMessage`
- 请求失败、解析失败、用户中止都通过事件表达，不抛异常
- 支持"先返回流、后完成异步初始化"（认证、懒加载模块）

---

## 2. A：概念与功能讲解

### 2.1 普通模型调用的限制

最直接的模型调用是一次请求、一次完整响应：

```ts
const message = await client.chat(messages);
```

调用方发出请求后等待，直到模型生成完毕才拿到完整消息。这种方式实现简单，但在编码 Agent 的场景里会暴露四个限制。

**首字延迟。** 用户提交任务后，模型可能先思考数秒，再生成数百个 token。等待期间界面没有任何反馈，用户无法判断请求是否还在进行。

**工具参数不可见。** 模型调用工具时，参数是一段 JSON。以 `edit` 工具为例，模型可能生成数百个字符的 `oldText` 和 `newText`。完整响应返回前，调用方不知道模型准备修改哪个文件，也无法提前展示变更预览。

**无法中止。** 请求发出后，调用方只能等待它自然结束。用户改变主意或发现方向错误时，没有安全的取消点。

**长输出容易超时。** 很多网关、代理和移动网络对“长时间没有数据”的连接设有超时。模型生成长文本时，连接可能在中途被切断。

流式响应把一次回复拆成一系列按时间到达的事件。文本、思考、工具参数在生成过程中逐步可见，调用方也能在任意时刻中止。这四个限制共同构成了引入流式协议的直接动机。

### 2.2 流式响应的定义与组成

流式响应是一个**有序事件序列**，并在序列结束时给出完整结果。它由三部分组成：

| 组成 | 职责 |
|---|---|
| 生产者 | 把 provider 的流式响应翻译成统一事件 |
| 事件序列 | 表达文本、思考、工具调用的增量变化 |
| 消费者 | 渲染增量、收集最终消息、决定是否继续 |

`@pipi/llm` 的统一接口层（下称统一层）负责把不同 provider 的调用差异藏在适配器后面。它提供两个入口：`streamSimple()` 返回事件流，`result()` 返回最终消息。

```ts
const stream = models.streamSimple(model, context);

for await (const event of stream) {
	// 消费增量
}

const message = await stream.result();
```

`stream` 是一个 异步可迭代对象（`AsyncIterable`）。JavaScript 中，成为`AsyncIterable`需要实现 `[Symbol.asyncIterator]()`。实现后可以使用 `for await...of` 循环。例如：

``` java
const myAsyncIterable = {
 async *[Symbol.asyncIterator]() {
   yield "hello";
   yield "async";
   yield "iteration!";
 },
};
(async () => {
 for await (const x of myAsyncIterable) {
   console.log(x); // 输出: "hello", "async", "iteration!"
 }
})();
```

pi 的 `EventStream` 是一个实现了 `[Symbol.asyncIterator]()` 的类，因此可以直接用于 `for await...of`。


### 2.3 一次流式调用的完整过程

一次流式调用从创建流对象开始，到 `done` 或 `error` 结束。过程如下：

```text
调用方
  │ streamSimple(model, context)
  ▼
创建 AssistantMessageEventStream（同步返回）
  │
  ├─ 异步初始化：解析认证、加载适配器、建立请求
  │
  ├─ start
  ├─ thinking_start → thinking_delta* → thinking_end
  ├─ text_start → text_delta* → text_end
  ├─ toolcall_start → toolcall_delta* → toolcall_end
  │
  └─ done（或 error）
  │
  ▼
result() 返回完整 AssistantMessage
```

关键点是**同步返回、异步工作**。调用方立即拿到流对象（同步），真正的认证、网络请求和解析等操作在后台进行（异步）。这样调用方可以马上开始消费，不必等待初始化完成。异步的结果通过流对象返回。

```java
function startJob() {
    const stream = new EventStream(); // 创建事件流容器

    // 这是一个立即执行的异步函数 (IIFE)
    void (async () => {
        await loadAuth();  // 遇到 await，异步函数被阻塞，主线程回到startJob
        const data = await fetch(...);    
        stream.push(data);                
        stream.end();
    })();

    return stream; // 返回事件流容器
}
```

调用方：
```java
const stream = startJob(); // 立刻拿到事件流容器
console.log("已返回");     // 这行立刻执行

for await (const event of stream) {
    console.log(event);    // 遍历事件流
}
```


### 2.4 事件的结构与顺序

事件流中获得的事件按内容块分组。一个内容块从 `*_start` 开始，经过若干 `*_delta`，以 `*_end` 结束。不同内容块可以按模型生成的顺序交错出现，但同一个块内部的事件必须连续。


| 事件 | 作用 |
|---|---|
| `start` | 流开始，携带空的 `partial` |
| `text_start` / `text_delta` / `text_end` | 文本块的生命周期 |
| `thinking_start` / `thinking_delta` / `thinking_end` | 思考块的生命周期 |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | 工具调用的生命周期 |
| `done` | 正常结束，携带完整消息和结束原因 |
| `error` | 异常结束，携带错误消息和原因 |

必须满足以下条件：

1. `start` 最多出现一次，且在任何块事件之前
2. 每个内容块先 `*_start`，再若干 `*_delta`，最后 `*_end`
3. `done` 与 `error` 互斥，且是最后一个事件
4. `done.reason` 只能是 `stop`、`length`、`toolUse`
5. `error.reason` 只能是 `aborted`、`error`
6. `contentIndex` 指向 `AssistantMessage.content` 数组中的位置，从 0 开始

`contentIndex` 让消费者知道当前增量属于哪个内容块。文本块、思考块和工具调用块可以同时存在于一条消息中，单靠事件顺序不足以定位，所以需要显式索引。

### 2.5 事件对象与 partial

事件对象由四部分组成：

| 字段 | 含义 | 出现范围 |
|---|---|---|
| `type` | 事件类型，用于区分事件种类 | 所有事件 |
| `contentIndex` | 该事件对应的内容块在 `partial.content` 中的下标 | 除 `start`、`done`、`error` 外 |
| 本次负载 | `delta`、`content` 或 `toolCall` | 按事件类型而定 |
| `partial` | 到此刻为止的完整消息 | 除 `done`、`error` 外 |

`delta` 是本次增量，`partial` 是累计状态。对同一个文本块，`partial.content[i].text` 等于此前所有 `text_delta` 的 `delta` 依次拼接，`text_end.content` 是它的最终值。协议同时给出两者：增量渲染直接用 `delta` 追加，不必重算整块；整体重绘直接读 `partial`，不必自己维护拼接状态。

`partial` 由 provider 适配器创建并持续修改。

流开始时，适配器先构造一条空消息（`packages/ai/src/api/openai-responses.ts:125`）：

```ts
const output: AssistantMessage = {
	role: "assistant",
	content: [],
	api: model.api as Api,
	provider: model.provider,
	model: model.id,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "pending",
	timestamp: Date.now(),
};
```

`"pending"` 是占位值，表示流尚未结束、结束原因未定。`StopReason` 包含 `"pending"` 正是为了这个阶段。

解析响应时，适配器先在 `output.content` 中追加一个块，再把整个对象作为 `partial` 推入事件（`packages/ai/src/api/openai-responses-shared.ts:476`）：

```ts
const block: TextContent = { type: "text", text: "" };
output.content.push(block);
const slot = { type: "text", block, contentIndex: output.content.length - 1 } satisfies ResponsesOutputSlot;
outputSlots.set(outputIndex, slot);
stream.push({ type: "text_start", contentIndex: slot.contentIndex, partial: output });
```

后续增量直接修改这个块，再推送 `text_delta`（`openai-responses-shared.ts:636`）：

```ts
slot.block.text += event.delta;
stream.push({ type: "text_delta", contentIndex: slot.contentIndex, delta: event.delta, partial: output });
```

`EventStream.push()` 不做拷贝（`packages/ai/src/utils/event-stream.ts:43`）。它把事件对象直接交给等待中的消费者，或放入队列；消费者拿到的 `event.partial` 与生产者的 `output` 是同一个引用。

事件推进时，`content` 的内容按如下方式增长：

```ts
start:        content = []
text_start:   content = [{ type: "text", text: "" }]
text_delta:   content = [{ type: "text", text: "流" }]
text_delta:   content = [{ type: "text", text: "流式" }]
text_end:     content = [{ type: "text", text: "流式" }]
```

每次事件到来时，生产者在原对象上追加内容，消费者看到的是“到目前为止的完整消息”。

共享引用带来两个直接后果。消费者不需要自己拼接文本，读 `event.partial` 就能得到当前完整状态，也避免了每到达一个 token 就复制整条消息。消费者也不能把 `event.partial` 存进数组当作历史快照，因为之后读取到的都是同一个对象的最新状态；需要保留历史时必须主动深拷贝。

并非所有事件都带 `partial`：

| 事件 | 携带字段 |
|---|---|
| `start`、各 `*_start` / `*_delta` / `*_end` | `partial` |
| `done` | `message`（最终消息） |
| `error` | `error`（失败的完整消息） |

`done` 和 `error` 终止流，携带的就是最终结果，再附一个 `partial` 会造成重复。

测试用的 faux provider 写成 `partial: { ...partial }`（`packages/ai/src/providers/faux.ts:354`），这是浅拷贝：外层对象是新的，`content` 数组仍与原对象共享。生产环境的适配器都直接传同一个对象。


### 2.6 工具参数 JSON 的解析策略

工具参数在事件里是对象，在 provider 的响应里是 JSON 文本，并按片段到达。解析策略要同时解决两个问题：任意时刻的文本都可能不合法，而界面又需要在生成过程中显示参数。

**三层数据**

| 层 | 保存在哪 | 形态 | 是否可信 |
|---|---|---|---|
| 原始文本 | 适配器内部的临时缓冲区 | 字符串 | 未解析 |
| 解析结果 | `partial.content[i].arguments` | 对象，可能缺字段 | 只能展示 |
| 最终参数 | `toolcall_end.toolCall.arguments` | 对象 | 仍需 schema 校验 |


三个阶段对应三种形态：

| 阶段 | 字段 | 形态 | 内容 |
|---|---|---|---|
| `toolcall_start` | `partial.content[i].arguments` | 对象 | 通常为 `{}`，少数 provider 会带入初始值 |
| `toolcall_delta` | `delta` | 字符串 | 本次到达的 JSON 文本片段 |
| `toolcall_delta` | `partial.content[i].arguments` | 对象 | 当前解析结果，可能只有部分字段 |
| `toolcall_end` | `toolCall.arguments` | 对象 | 最终解析结果 |

一次典型的 `edit` 调用：

```text
toolcall_start
  name = "edit"
  partial.content[0].arguments = {}

toolcall_delta   delta = '{"path":"src/a.ts","old'
  partial.content[0].arguments = { path: "src/a.ts" }

toolcall_delta   delta = 'Text":"foo","newText":"bar"}'
  partial.content[0].arguments = { path: "src/a.ts", oldText: "foo", newText: "bar" }

toolcall_end
  toolCall.arguments = { path: "src/a.ts", oldText: "foo", newText: "bar" }
```

`toolcall_delta` 状态的 `arguments` 是provider的适配器处理后的结果。比如第一个 `delta` 之后 `path` 的值已经完整，因此出现在解析结果里；`oldText` 的键名还没结束，不会被保留。

**适配器处理**

适配器收到 `input_json_delta` 后立即追加并重解析（`packages/ai/src/api/anthropic-messages.ts:694`）：

```ts
block.partialJson += event.delta.partial_json;
block.arguments = parseStreamingJson(block.partialJson); // 闭合括号，补全内容等操作
stream.push({ type: "toolcall_delta", contentIndex: index, delta: event.delta.partial_json, partial: output });
```

**容错解析**

增量 JSON 在任意时刻都可能不合法：括号未闭合、字符串未结束、转义截断、字符串里出现原始控制字符。`parseStreamingJson` 用三步处理：

1. 严格解析：完整合法的 JSON 走最快路径
2. 修复后部分解析：修掉字符串内部的转义问题，再补全未闭合的结构
3. 全部失败返回 `{}`

```typescript
export function parseStreamingJson<T = Record<string, unknown>>(text: string | undefined): T {
	if (text === undefined || text.trim() === "") {
		return {} as T;
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		// 文本可能尚未闭合，继续尝试容错解析。
	}

	try {
		const partial = parsePartial(repairJson(text)) as unknown;
		return (partial ?? {}) as T;
	} catch {
		// 完全无法解析，返回空对象。
	}

	return {} as T;
}
```

修复和部分解析合成一步，是因为修复只会把字符串内部的非法内容变成合法转义，不会破坏结构；未闭合的括号交由部分解析器补全。

永不抛异常，流式中间态的解析失败是常态，不能中断整个流。


**结束时再解析一次**

`content_block_stop` 时适配器用完整缓冲区重新解析，写入 `arguments`，删除缓冲区，再推 `toolcall_end`（`anthropic-messages.ts:731`）：

```ts
block.arguments = parseStreamingJson(block.partialJson);
delete (block as { partialJson?: string }).partialJson;
stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
```

再解析一次是为了让结束事件与缓冲区保持一致；删除缓冲区则避免持久化时重复保存原始文本。

**最终不等于可信**

`toolcall_end` 的输出被 `length` 截断时，事件仍会发出，`arguments` 可能是部分结果或空对象。schema 校验属于工具执行层，流层不承担。

消费方需要遵守三条规则：

1. `toolcall_delta` 阶段只用 `partial.arguments` 展示进度，不执行工具。
2. 执行工具只读 `toolcall_end.toolCall.arguments`。
3. 执行前必须做 schema 校验，不能因为流正常结束就认为参数可信。


### 2.7 错误与中止

流式协议不通过抛异常表达失败，而是把失败编码成消息状态：

| 场景 | 事件序列 | `stopReason` |
|---|---|---|
| 认证失败、模块加载失败 | 只有 `error` | `error` |
| 请求发出后网络中断 | `start` → `error` | `error` |
| 用户中止 | `start` → `error` | `aborted` |
| 达到输出上限 | `start` → ... → `done(length)` | `length` |
| 正常结束 | `start` → ... → `done(stop)` | `stop` |

`error` 事件携带完整的 `AssistantMessage`，其中 `errorMessage` 是脱敏后的可读文本。这样设计有三个原因：

1. 界面需要展示已经生成的部分内容
2. 会话需要决定是否保存这次失败的尝试
3. 重试逻辑需要根据错误类型判断是否可重试

`result()` 在成功和失败时都会 resolve。成功时返回 `done.message`，失败时返回 `error.error`。调用方不需要区分“正常返回”和“异常抛出”两条控制流，只需要检查 `stopReason`。

| `stopReason` | 含义 | 调用方动作 |
|---|---|---|
| `stop` | 正常结束 | 没有工具调用就结束回合 |
| `toolUse` | 模型要求调用工具 | 执行工具，结果回填，继续下一轮 |
| `length` | 达到输出上限，内容被截断 | 有工具调用时全部判失败，不执行 |
| `error` | 请求或流错误 | 结束循环，可能触发重试 |
| `aborted` | 用户中止 | 结束循环，不重试 |
| `pending` | 流尚未结束 | 只存在于中间态，最终消息中不出现 |

原项目的 `deferred` 响应未在 pipi 实现，见 `BUILD_PLAN.md` 决策表。

Agent 循环对失败状态的处理（`packages/agent/src/agent-loop.ts:109`）：

```ts
if (message.stopReason === "error" || message.stopReason === "aborted") {
	await emit({ type: "turn_end", message, toolResults: [] });
	await emit({ type: "agent_end", messages: newMessages });
	return newMessages;
}
```

`error` 与 `aborted` 都终止循环，区别在会话层的重试策略：前者可能重试，后者不会。

`length` 的处理更严格（`agent-loop.ts:121`）：

```ts
const executedToolBatch =
	message.stopReason === "length"
		? await failToolCallsFromTruncatedMessage(toolCalls, emit)
		: await executeToolCalls(currentContext, message, config, signal, emit);
```

被截断的消息里仍可能有 `toolCall` 块，参数是半截 JSON 的解析结果。直接执行会拿不完整的 `path` 或 `oldText` 去改文件。因此 `length` 下的工具调用全部标记为失败，由模型在下一轮看到失败原因后重新生成。

`result()` 不 reject 消除了“正常返回”与“异常抛出”的分叉，代价是每个消费层都必须显式处理这些状态。漏掉 `error` 会把失败当成功继续下一轮；漏掉 `aborted` 会在用户取消后仍执行工具；漏掉 `length` 会用截断的参数执行工具。

### 2.8 延迟初始化

`Models.streamSimple()` 在返回流之前需要完成一些异步工作：

- 解析认证信息，可能刷新 OAuth token
- 加载对应的 API 适配器
- ……

但调用方期望立即拿到流对象。`lazyStream` 解决这个矛盾：先同步创建一个外层流并返回，再在后台执行初始化，把初始化结果转发到外层流。


```ts
function lazyStream(model, setup): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();
	setup()  // 执行逻辑
		.then((inner) => forwardStream(outer, inner))
		.catch((error) => {
			outer.push({ type: "error", reason: "error", error: createSetupErrorMessage(model, error) });
			outer.end();
		});
	return outer;
}
```

1. 创造一个管道 outer
2. 执行setup
3. setup执行同步的requireProvider
4. setup执行异步的applyAuth。遇到await，不等待，setup返回一个promise，applyAuth异步运行
5. 在setup()处挂起一个promise，setup并没有执行完
6. return outer，外部直接拿到管道
7. await applyAuth结束，setup执行provider.streamSimple，返回provider的管道，也就是inner
8. 执行then，forwardStream把两个管道连起来


> 直接调用 async 函数会立即启动函数执行，但不会等待它完成。如果 async 函数里面有 await，就会返回一个 promise，转而运行主函数，async 函数暂停。
> 使用 await 调用则会等待 async 函数直到完成。如果 async 函数里面有 await，主函数会等 async 函数结束返回再继续。
>

### 2.9 背压、顺序与内存

`EventStream` 内部维护两个 FIFO 队列：

- 事件队列：生产者已经推送、消费者尚未取走的事件
- 等待队列：消费者正在等待、生产者尚未推送的 resolver

规则如下：

- 有等待者时，事件直接交付，不进入队列
- 没有等待者时，事件进入队列
- `end()` 唤醒所有等待者并标记结束
- 流结束后，新的 `push()` 被忽略

这套实现保证事件顺序，但没有真正的背压。生产速度快于消费速度时，事件会在内存中堆积；消费速度快于生产速度时，消费者挂起等待。

对 LLM 流来说，事件速率远低于内存上限，因此不做背压是可接受的简化。

### 2.10 与整体系统的关系

流式协议位于类型层和上层消费者之间：

- 上游依赖消息、内容块、工具调用等类型
- 下游包括 API 适配器（生产者）、Agent 循环（消费者）、会话持久化、JSON/RPC 模式和交互界面

适配器负责把 provider 的 SSE 或 WebSocket 数据翻译成统一事件；Agent 循环把 `message_update` 转换成自己的事件；会话层把最终消息落盘；界面层用增量事件渲染。

这一层的协议一旦改变，所有生产者和消费者都要跟着改。因此它属于系统的基础设施，而不是某个界面的内部实现。

### 2.11 小结

本课的核心结论：

1. 流式响应解决首字延迟、工具参数不可见、无法中止和长连接超时四个问题。
2. 统一层同时提供事件流和最终结果两个接口。
3. 事件必须满足固定的顺序和不变量，`contentIndex` 用于定位内容块。
4. `partial` 是共享的可变消息，消费者不能保存历史引用。
5. 工具参数在每个片段到达时解析，解析器容错且不抛异常，最终值仍需 schema 校验。
6. 错误和中止编码成消息状态，`result()` 始终 resolve，调用方按 `stopReason` 分派。
7. `lazyStream` 让异步初始化不破坏同步返回的接口。
8. 事件流保证顺序，但没有背压，只支持单消费者。

---

## 3. 讨论与确认记录

> 学习本课程时，问题、解释、讨论结论以及对 B 阶段的影响记录在此；已确认决策见 `BUILD_PLAN.md` 决策表。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-03 | 反馈 | A 阶段标题为设问式，像问答笔记 | 全课改为教材式陈述，标题用陈述句 |
| 2026-11-03 | 讨论 | “统一层”与 `AsyncIterable` 未定义就使用 | 2.2 补充术语与异步迭代协议 |
| 2026-11-03 | 讨论 | 内容块之间没有固定先后，只保证块内顺序 | 事件校验只检查块内不变量与 `contentIndex` |
| 2026-11-03 | 讨论 | `partial` 由适配器创建并原地修改，`push` 不拷贝 | 实现需保证事件对象不被复制 |
| 2026-11-03 | 讨论 | 工具参数在每个 delta 到达时重解析，中间值只用于展示 | 适配器推送前需写回 `arguments` |
| 2026-11-03 | 讨论 | `stopReason` 是调用方分派依据，`length` 下不执行工具 | 循环层需处理 `length` 与工具调用的组合 |
| 2026-11-03 | 讨论 | `lazyStream` 与 `startJob` 同构，差别在错误转成事件 | `lazyStream` 需覆盖 setup 的同步抛错 |
| 2026-11-03 | 讨论 | `EventStream` 的两个 FIFO 队列是真实实现，内部用双数组摊还 | 实现需避免 `Array.shift` |
| 2026-11-03 | 讨论 | SSE 属于传输层，与本课协议分层 | SSE 解析归入课程 04、05；本次不写入 A |
| 2026-11-03 | B 确认 | 十项实现方案逐条确认 | 见 `BUILD_PLAN.md` 决策表 |
| 2026-11-03 | B 确认 | 用户确认课程 03 B | T-03-1 至 T-03-5 写入 `BUILD_PLAN.md` |

---

## 4. B：具体实现规划

### 4.1 原项目实现

| 文件 | 作用 | 行数 |
| --- | --- | --- |
| `packages/ai/src/utils/event-stream.ts` | 通用事件流 + 助手消息流 | 110 |
| `packages/ai/src/types.ts` | `AssistantMessageEvent` 联合类型 | 506–538 |
| `packages/ai/src/api/lazy.ts` | 延迟初始化与错误转发 | 98 |
| `packages/ai/src/utils/json-parse.ts` | 流式 JSON 解析与修复 | 124 |
| `packages/ai/src/api/openai-completions.ts` | 事件生产示例 | 311–724 |

原项目的实现顺序（在 `openai-completions.ts` 中）：

1. 同步创建 `AssistantMessageEventStream`
2. 立即返回流
3. 在 async IIFE 中：建 client → 发请求 → `push(start)`
4. `for await (chunk of openaiStream)`：累积文本/思考/工具参数，push 对应事件
5. 结束时 `push(done)` + `end()`
6. `catch`：设置 `stopReason`、`errorMessage`，`push(error)` + `end()`

### 4.2 新项目实现建议

```text
packages/llm/src/
├── types.ts                # 新增 AssistantMessageEvent 联合类型
├── utils/
│   ├── event-stream.ts     # FifoQueue + EventStream + AssistantMessageEventStream
│   └── json-parse.ts       # repairJson + parseJsonWithRepair + parseStreamingJson
├── api/
│   └── lazy.ts             # 只放 lazyStream；lazyApi 后置 04
└── index.ts                # 新增运行时导出
```

新增依赖：`partial-json@0.1.7`。

### 4.3 `EventStream` 实现要点

```ts
class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;        // 完成判定 + 交付/入队
  end(result?: R): void;       // 标记完成 + 唤醒等待者
  result(): Promise<R>;        // 最终结果
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

实现顺序：

1. 先写 `FifoQueue`（两个数组实现队列，避免 `shift()` 的 O(n)）
2. 写 `EventStream` 的 `push` / `end` / 迭代器
3. 写 `AssistantMessageEventStream` 的完成判定与结果提取
4. 写 `lazyStream`

边界条件：

| 条件 | 期望 |
| --- | --- |
| `push` 在 `end` 之后 | 忽略 |
| `end` 调用两次 | 第二次无副作用 |
| `end()` 不传 result，且此前没有 `done`/`error` 事件 | `result()` 一直 pending（调用方需避免） |
| 消费者在 `end` 后才开始迭代 | 先把队列取完，再结束 |
| 多个消费者 | 不支持；事件会被分摊，不建议 |

### 4.4 `AssistantMessageEvent` 定义

02 只定义了消息与内容块，没有事件类型。本课在 `src/types.ts` 新增 `AssistantMessageEvent`，重点是区分块事件与完成事件：

```ts
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

`AssistantMessageEventStream` 的完成判定：

```ts
(event) => event.type === "done" || event.type === "error"
```

结果提取：

```ts
(event) => event.type === "done" ? event.message : event.error
```

### 4.5 `parseStreamingJson` 实现要点

三步，与原项目的四级顺序不同：

1. `JSON.parse`：完整合法输入走最快路径
2. `parsePartial(repairJson(text))`：先修复字符串内部转义，再补全未闭合结构
3. 全部失败 → 返回 `{}`

原项目在第二级先尝试原文部分解析，再尝试修复后解析。原文解析遇到“已截断且含原始控制字符”的文本会返回空对象而不抛错，直接短路后面的修复尝试，使更有信息量的结果无法产生。合并成一步后行为稳定，也少一次无效解析。

`repairJson` 需要处理：

- 字符串内的原始控制字符（`\n`、`\t`、`\u0000`）
- 非法转义（`\x` → `\\x`）
- 末尾孤立的 `\`
- `\u` 后不足四位的截断

这一层不追求“解析出正确语义”，只追求“不崩、尽量可用”。

### 4.6 测试清单

| 测试 | 验证 |
| --- | --- |
| 先 push 后消费 | 事件不丢失，顺序不变 |
| 边生产边消费 | 消费者能及时拿到事件 |
| 消费者在 `end` 后开始迭代 | 先取完队列，再结束 |
| `done` 后 `result()` | resolve 为完整消息 |
| `error` 后 `result()` | resolve 为错误消息，不 reject |
| 手工 push `aborted` 事件 | `result()` 返回 `stopReason: "aborted"` 的消息 |
| `end()` 唤醒等待者 | 迭代正常结束 |
| `end()` 两次 | 第二次无副作用 |
| 完成后 `push` | 被忽略 |
| 事件顺序 | 直接断言：`start` 在首位，块内 `*_start` / `*_delta` / `*_end` 连续，终态在末位 |
| 初始化成功 | `lazyStream` 转发内层事件，`result()` 与内层一致 |
| 初始化失败 | `lazyStream` 只产生一个 `error` 事件 |
| 流式 JSON | 不完整、非法转义、纯文本都返回对象 |
| `partial` 引用 | 消费过程中看到的是最新累积值 |

### 4.7 与原项目的取舍

| 特性 | 建议 | 说明 |
| --- | --- | --- |
| `thinking_*` 事件 | 保留 | 推理模型需要，不做后置 |
| `toolcall_delta` | 保留 | 工具参数流式是核心体验 |
| `deferred` | 舍弃 | 原项目只有基础设施与 faux 测试，pipi 不实现 |
| `partial-json` | 引入 `0.1.7` | 前缀补全的边界多，自研成本高 |
| `FifoQueue` 双数组 | 保留 | 两个数组加一次反转，摊还 O(1) |
| 无背压 | 保留 | 对 LLM 流足够；课程中注明限制 |
| `lazyApi` 动态导入 | 后置到 04 | 没有适配器就没有调用点 |

### 4.8 实现顺序与验收

| 任务 | 内容 | 文件 | 验收 |
| --- | --- | --- | --- |
| T-03-1 | 新增 `AssistantMessageEvent` 并导出 | `src/types.ts`、`src/index.ts` | 类型编译通过，12 个成员齐全 |
| T-03-2 | 实现 `repairJson`、`parseJsonWithRepair`、`parseStreamingJson` | `src/utils/json-parse.ts` | 四种残缺形态都返回对象，不抛异常 |
| T-03-3 | 实现 `FifoQueue`、`EventStream`、`AssistantMessageEventStream` | `src/utils/event-stream.ts` | 顺序、结束、结果提取、完成后 push 忽略 |
| T-03-4 | 实现 `lazyStream` | `src/api/lazy.ts` | 成功时转发事件并传递结果，失败时只产生一个 `error` 事件 |
| T-03-5 | 补齐导出、changelog 与全量验证 | `src/index.ts`、`CHANGELOG.md` | `npm run build`、`npm test`、`tsc --noEmit`、`biome check .` 通过 |

依赖顺序：T-03-1 → T-03-2 → T-03-3 → T-03-4 → T-03-5。T-03-2 与 T-03-3 之间没有耦合，可以交换，按表中顺序执行便于逐项验证。
> 本课相关决策见 `BUILD_PLAN.md` 决策表。

### 4.9 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 完整事件协议 | 文本+思考+工具 | 推荐 |
| 只做文本 | 最简单 | 不推荐：工具参数无法流式 |
| 用 `AsyncGenerator` | 少写一个类 | 不推荐：拿不到 `result()`，错误时机差 |
| 有背压 | 更通用 | 可选；LLM 场景不需要 |
| 错误抛异常 | 简单 | 不推荐：UI 会丢部分内容 |
