# 03 流式响应协议

> 课程状态：待学习
> 前置课程：02
> 覆盖模块：pi-ai 流式协议、增量 JSON 解析、延迟初始化
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

## 2. 前置知识与依赖

- 02 的 `AssistantMessage`、`TextContent`、`ThinkingContent`、`ToolCall`
- 了解 `AsyncIterable` / `AsyncIterator`
- 了解 SSE（Server-Sent Events）的基本形态

---

## 3. A 阶段——概念与功能讲解（High-level）

### 3.1 为什么不能等完整回复

最朴素的调用是：

```ts
const message = await client.chat(messages);
```

问题：

1. **首字延迟**：用户要等十几秒才看到任何输出
2. **工具参数无法提前解析**：模型生成 2000 个字符的 JSON 参数时，用户看不到任何进展
3. **无法中止**：请求发出后只能等它结束
4. **长输出容易超时**：很多网关对"无数据"的连接有超时限制

流式协议把"一次回复"拆成"一系列事件"，让 UI 可以在 token 到达时立即渲染。

### 3.2 为什么是"事件流 + 最终结果"双接口

只用 `AsyncIterable` 的问题：

- 消费完事件后，还要自己拼接出完整消息
- 非流式调用方（比如压缩摘要）只想 `await` 一个结果，不想写循环

只用 `Promise<AssistantMessage>` 的问题：

- 丢失增量信息
- 无法在生成过程中取消

Pi 的方案是两者都有：

```ts
const stream = models.streamSimple(model, context);

// 消费增量
for await (const event of stream) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}

// 拿最终结果
const message = await stream.result();
```

`result()` 的 Promise 在流终止时 resolve：`done` 事件给 `message`，`error` 事件给 `error` 消息。因此**无论成功失败，`result()` 都不会 reject**。这与"错误编码进流"的设计一致。

### 3.3 事件语法

```text
成功：
  start
    ├─ text_start → text_delta* → text_end
    ├─ thinking_start → thinking_delta* → thinking_end
    └─ toolcall_start → toolcall_delta* → toolcall_end
  done

失败（生成开始前）：
  error

失败（生成开始后）：
  start → ... → error
```

规则：

1. `start` 最多一次，且必须在任何 `*_start` / `*_delta` / `done` 之前
2. 每个内容块先 `*_start`，再若干 `*_delta`，最后 `*_end`
3. `done` 与 `error` 互斥，且是最后一个事件
4. `done.reason` 只能是 `stop | length | toolUse | deferred`
5. `error.reason` 只能是 `aborted | error`
6. `contentIndex` 指向 `message.content` 数组中的位置，从 0 开始

### 3.4 `partial` 是什么

每个事件都带一个 `partial: AssistantMessage`。它不是快照，而是**同一个可变对象的引用**：

```ts
start:          content = []
text_start:     content = [{ type:"text", text:"" }]
text_delta:     content = [{ type:"text", text:"你" }]        // 同一个数组/对象被修改
text_delta:     content = [{ type:"text", text:"你好" }]
text_end:       content = [{ type:"text", text:"你好" }]
```

这样设计的原因：

- 避免每个 token 都复制整条消息，降低 GC 压力
- `partial` 始终是"到目前为止的完整消息"，UI 可以直接渲染

代价：

- 消费者**不能保存历史事件的 `partial` 引用**，否则看到的都是最终状态
- 需要历史时必须自己深拷贝

这是一个典型的"性能换使用约束"的设计，必须在课程和测试中明确。

### 3.5 工具参数为什么要流式

模型生成工具调用时，参数是 JSON 字符串：

```text
toolcall_start  { name: "edit" }
toolcall_delta  '{"path":"src/a.ts","old'
toolcall_delta  'Text":"foo","newText":"bar"}'
toolcall_end    { arguments: { path: "src/a.ts", oldText: "foo", newText: "bar" } }
```

用途：

1. UI 可以边生成边显示"正在准备 edit 工具"
2. 某些 provider 支持提前执行只读工具（原项目没有这样做，但协议允许）
3. 用户可以在参数生成完之前取消

代价：增量 JSON 可能不完整、有非法转义、控制字符。因此需要 `parseStreamingJson()`：

```ts
parseStreamingJson('{"a":1')        // { a: 1 }
parseStreamingJson('{"a":"x\\')    // 修复后解析
parseStreamingJson('not json')      // {}
```

设计原则：**永远返回一个对象，永不抛异常**。流式中间态的解析失败是常态，不是错误。

### 3.6 错误与中止如何编码

| 场景 | 事件 | `AssistantMessage.stopReason` |
| --- | --- | --- |
| 认证失败、模块加载失败 | 只有 `error` | `error` |
| 请求发出后网络中断 | `start` → `error` | `error` |
| 用户中止 | `start` → `error` | `aborted` |
| 达到输出上限 | `start` → ... → `done(reason: "length")` | `length` |
| 正常结束 | `start` → ... → `done(reason: "stop")` | `stop` |

为什么不在 `error` 事件里只放一个 `Error` 对象：

- UI 需要展示"已经生成的部分内容"
- 会话需要决定是否保存这次失败的尝试
- 重试逻辑需要判断是否可重试（比如 429 vs 400）

所以 `error` 事件携带完整的 `AssistantMessage`，其中 `errorMessage` 是脱敏后的可读文本。

### 3.7 为什么需要 `lazyStream`

`Models.streamSimple()` 要做异步工作：

- 解析认证（可能刷新 OAuth token）
- 懒加载 API 模块
- 读取动态模型目录

但调用方期望**同步拿到流对象**，然后开始消费。`lazyStream` 解决这个矛盾：

```ts
function lazyStream(model, setup): AssistantMessageEventStream {
  const outer = new AssistantMessageEventStream();
  setup()
    .then(inner => forwardStream(outer, inner))
    .catch(error => {
      outer.push({ type: "error", reason: "error", error: createSetupErrorMessage(model, error) });
      outer.end();
    });
  return outer;
}
```

这样：

- 认证失败不会让通过 `Models` 发起的调用抛出异常，而是流里的一个 `error` 事件
- 调用方的代码路径统一：永远是"拿流 → 消费 → 查 stopReason"

例外：直接调用 API 适配器模块导出的 `streamSimple()` 时，它会在返回流之前同步检查 API key 是否存在（`getClientApiKey`），明显配置错误会立刻抛错。通过 `Models.streamSimple()` 调用时，这次检查发生在异步初始化内部，失败会被 `lazyStream` 捕获并编码成 `error` 事件。这个细节属于 05。

### 3.8 为什么不用回调或 EventEmitter

| 方案 | 问题 |
| --- | --- |
| 回调 `onDelta(text)` | 无法表达"流结束"，错误处理分散；难以组合 |
| `EventEmitter` | 没有背压；监听器泄漏；无法 `await` |
| `AsyncGenerator` | 不能同时提供 `result()`；生成器函数体在第一次 `next()` 才执行，错误时机不直观 |
| `AsyncIterable` + 独立结果 Promise | 兼顾增量、最终结果、取消；消费者可控 |

### 3.9 背压与顺序

`EventStream` 内部用两个 FIFO 队列：

- `queue`：生产者已 push、消费者还没取的事件
- `waiting`：消费者在等、生产者还没 push 的 resolver

规则：

- 有等待者 → 直接交付，不排队
- 无等待者 → 入队
- `end()` → 唤醒所有等待者并标记 `done`
- 已完成后 `push()` 被忽略

这意味着：

- 生产快、消费慢：事件在内存里堆积（没有真正的背压）
- 生产慢、消费快：消费者挂起等待

对 LLM 流来说，事件速率远低于内存上限，所以不做背压是可接受的简化。但如果把 `EventStream` 用于大文件传输，就需要重新设计。

---

## 4. 讨论与确认记录

> 尚无讨论。学习本课程时，问题、解释、结论、已确认决策以及对 B 阶段的影响记录在此。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| - | - | 尚无记录 | - |

---

## 5. B 阶段——具体实现规划（Low-level）

### 5.1 原项目实现

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

### 5.2 新项目文件清单

```text
packages/llm/src/
├── utils/
│   ├── event-stream.ts     # EventStream + AssistantMessageEventStream
│   └── json-parse.ts       # repairJson + parseJsonWithRepair + parseStreamingJson
├── api/
│   └── lazy.ts             # lazyStream + lazyApi
└── types.ts                # AssistantMessageEvent 联合类型（02 已定义）
```

### 5.3 `EventStream` 实现要点

```ts
class EventStream<T, R = T> implements AsyncIterable<T> {
  push(event: T): void;        // 完成判定 + 交付/入队
  end(result?: R): void;       // 标记完成 + 唤醒等待者
  result(): Promise<R>;        // 最终结果
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

实现顺序：

1. 先写 `FifoQueue`（两个栈实现队列，避免 `shift()` 的 O(n)）
2. 写 `EventStream` 的 `push` / `end` / 迭代器
3. 写 `AssistantMessageEventStream` 的完成判定与结果提取
4. 写 `lazyStream`

边界条件：

| 条件 | 期望 |
| --- | --- |
| `push` 在 `end` 之后 | 忽略 |
| `end` 调用两次 | 第二次无副作用 |
| `end()` 不传 result | `result()` 永远 pending（调用方需避免） |
| 消费者在 `end` 后才开始迭代 | 先把队列取完，再结束 |
| 多个消费者 | 不支持；事件会被分摊，不建议 |

### 5.4 `AssistantMessageEvent` 定义

按 02 的联合类型实现，重点是区分完成事件：

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
  | { type: "done"; reason: "stop" | "length" | "toolUse" | "deferred"; message: AssistantMessage }
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

### 5.5 `parseStreamingJson` 实现要点

三层回退：

1. 直接 `JSON.parse`（快路径）
2. `repairJson` 后解析（修复控制字符、非法转义）
3. `partial-json` 解析（补齐未闭合的括号/引号）
4. 都失败 → 返回 `{}`

`repairJson` 需要处理：

- 字符串内的原始控制字符（`\n`、`\t`、`\u0000`）
- 非法转义（`\x` → `\\x`）
- 末尾孤立的 `\`

这一层不追求"解析出正确语义"，只追求"不崩、尽量可用"。

### 5.6 测试清单

| 测试 | 验证 |
| --- | --- |
| 先 push 后消费 | 事件不丢失，顺序不变 |
| 边生产边消费 | 消费者能及时拿到事件 |
| `done` 后 `result()` | resolve 为完整消息 |
| `error` 后 `result()` | resolve 为错误消息，不 reject |
| `end()` 唤醒等待者 | 迭代正常结束 |
| 完成后 `push` | 被忽略 |
| 事件顺序 | `start` 在前，`*_start` 在 `*_delta` 前，终态最后 |
| 中止 | `signal.abort()` → `stopReason: "aborted"` → `error` 事件 |
| 初始化失败 | `lazyStream` 只产生一个 `error` 事件 |
| 流式 JSON | 不完整、非法转义、纯文本都返回对象 |
| `partial` 引用 | 消费过程中看到的是最新累积值（用测试固定这个语义） |

### 5.7 与原项目的取舍

| 特性 | 建议 | 说明 |
| --- | --- | --- |
| `thinking_*` 事件 | 保留 | 推理模型需要；不做可后置 |
| `toolcall_delta` | 保留 | 工具参数流式是核心体验 |
| `deferred` | 可后置 | 只有部分 provider 支持 |
| `FifoQueue` 双栈 | 保留 | 实现简单，性能足够 |
| 无背压 | 保留 | 对 LLM 流足够；课程中注明限制 |
| `lazyApi` 动态导入 | 可后置 | 首个适配器可以直接静态导入 |

### 5.8 待确认决策

- 是否在第一版就支持思考事件（取决于首个模型是否推理模型）
- 是否需要 `lazyStream`（建议保留，认证失败路径更干净）
- 是否要实现 `fetchDeferred`（课程 05）

---

## 6. 原源码对应关系

| 主题 | 文件 | 行号 |
| --- | --- | --- |
| FIFO 队列 | `packages/ai/src/utils/event-stream.ts` | 3–23 |
| `EventStream` | 同上 | 26–89 |
| `push` | 同上 | 43–58 |
| `end` | 同上 | 60–70 |
| 异步迭代器 | 同上 | 72–84 |
| `AssistantMessageEventStream` | 同上 | 91–105 |
| 事件联合类型 | `packages/ai/src/types.ts` | 506–538 |
| 延迟流 | `packages/ai/src/api/lazy.ts` | 46–61 |
| 懒加载 API | 同上 | 73–98 |
| JSON 修复 | `packages/ai/src/utils/json-parse.ts` | 32–95 |
| 流式解析 | 同上 | 104–124 |
| 事件生产示例 | `packages/ai/src/api/openai-completions.ts` | 311–724 |
| 工具调用累积 | 同上 | 423–547 |
| 错误终止 | 同上 | 697–720 |

---

## 7. 与整体系统的关系

- 依赖：02 的消息与内容块类型
- 支撑：
  - 05 适配器（生产者）
  - 09 Agent 循环（消费者，把 `message_update` 转成 `AgentEvent`）
  - 18 会话（把最终消息落盘）
  - 20 JSON/RPC 模式（事件直接序列化）
  - 24 交互模式（增量渲染）
- 如果这一层设计错了，后面每一层都要跟着改，因此它是"地基中的地基"

---

## 8. 复现选项与待确认决策

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 完整事件协议 | 文本+思考+工具 | 推荐 |
| 只做文本 | 最简单 | 不推荐：工具参数无法流式 |
| 用 `AsyncGenerator` | 少写一个类 | 不推荐：拿不到 `result()`，错误时机差 |
| 有背压 | 更通用 | 可选；LLM 场景不需要 |
| 错误抛异常 | 简单 | 不推荐：UI 会丢部分内容 |

---

## 9. 学习检查点

1. 为什么 `result()` 在 `error` 时也 resolve，而不是 reject？
2. `partial` 是同一个可变对象，这对消费者提出了什么约束？如果 UI 直接保存了历史事件会怎样？
3. 工具参数流式解析为什么"永远不能抛异常"？
4. `start` 之前失败与 `start` 之后失败，事件序列有什么区别？调用方需要分别处理吗？
5. `EventStream` 没有背压，什么场景下会出问题？为什么 LLM 流可以接受？
