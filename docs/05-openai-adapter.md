# 05 第一个 API adapter（OpenAI 兼容）

> 课程状态：验收通过
> 覆盖模块：`@pipi/llm` 的 OpenAI Chat Completions adapter、请求构造、streaming 解析、usage 与错误映射
> 课程文件：05-openai-adapter.md
> 本课产出：把统一 `Context` 转成 OpenAI Chat Completions 请求，消费 SSE，产出统一 event stream。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| adapter | 把统一请求翻译成某家 API 格式、再把响应翻译回统一 event 的模块。 |
| SSE | Server-Sent Events，HTTP streaming 响应格式，每条消息以 `data:` 开头。 |
| chunk | streaming 响应中的一小段 JSON，例如一个文本增量或一个工具参数片段。 |
| delta | chunk 里“相比上一段新增的内容”。 |
| `finish_reason` | provider 给出的结束原因，例如 `stop`、`length`、`tool_calls`。 |
| `tool_calls` | OpenAI 的 tool call 数组，包含 id、name 和 JSON 参数字符串。 |
| compat | 兼容开关。同一 API 家族的不同端点行为有差异，用这些开关描述。 |
| `reasoning_content` | 部分推理模型返回的思考内容字段。 |
| usage | token usage，通常出现在最后一个 chunk。 |

---

## 1. 构建目标

课程 04 已经能把请求分发给“某个 API 实现”。本课实现第一个真实实现：

```text
统一 Context
  → OpenAI Chat Completions 请求
  → SSE 流
  → 统一 AssistantMessageEvent
```

完成后，`@pipi/llm` 可以真正调用 OpenAI 兼容端点，并把增量文本、思考、tool call、usage 和错误交给上层。

覆盖范围：

- OpenAI 官方端点
- DeepSeek 等 OpenAI 兼容端点
- 文本、图片、tool call、思考内容
- streaming 解析、错误映射、重试、中止

暂不覆盖：

- Anthropic、Google、Mistral 等其它协议
- 订阅型 OAuth
- 语法约束工具、OpenRouter/Vercel 路由等高级兼容项

---

## 2. A：概念与功能讲解

### 2.1 本课主线

一次 adapter 调用可以拆成四段：

```text
1. 组装请求   统一 Context → OpenAI messages / tools / params
2. 发送请求   HTTP POST，要求 stream: true
3. 解析响应   SSE chunk → 文本/思考/tool call 增量
4. 收尾       映射 stopReason、usage、错误，发出 done/error
```

adapter 只负责这四段。认证、模型查找、session 保存都在其它层。

### 2.2 adapter 在系统中的位置

```text
Agent / harness
  │ StreamFn
  ▼
Models
  │ 选择 provider、解析认证
  ▼
Provider
  │ 按 model.api 选择实现
  ▼
openai-completions adapter
  │ HTTP + SSE
  ▼
OpenAI 兼容端点
```

`Models` 把已经准备好的 `apiKey`、`headers`、`baseUrl`、`env` 交给 provider；provider 再交给 adapter。adapter 不读环境变量，也不查 credential。

### 2.3 adapter 的输入

```ts
stream(model, context, options)
```

| 输入 | 内容 |
|---|---|
| `model` | `id`、`baseUrl`、`api`、`compat`、`cost`、`contextWindow`、`maxTokens` |
| `context` | `systemPrompt`、`messages`、`tools` |
| `options` | `apiKey`、`headers`、`signal`、`temperature`、`maxTokens`、`reasoning`、`sessionId`、`fetch` |

adapter 需要理解 `model.compat`，因为同一个 `openai-completions` 协议在不同端点上有关键差异。

### 2.4 请求构造

请求体大致是：

```json
{
  "model": "deepseek-v4-flash",
  "messages": [...],
  "tools": [...],
  "stream": true,
  "stream_options": { "include_usage": true },
  "max_tokens": 4096,
  "temperature": 0.2
}
```

构造过程分四步。

**第一步：系统提示**

```text
model.reasoning && compat.supportsDeveloperRole
  → role: "developer"
否则
  → role: "system"
```

openai 的推理模型可以将system换为developer

**第二步：消息转换**

统一消息 转换为 OpenAI 消息：

- `UserMessage` 的字符串直接作为 `content`
- 图片块转成 `image_url`，内容为 `data:<mime>;base64,...`
- `AssistantMessage` 的文本拼成一个字符串
- 思考块按兼容配置转成 `reasoning_content`、`reasoning` 或普通文本
- `ToolCall` 转成 `tool_calls`
- `ToolResultMessage` 转成 `role: "tool"`，带 `tool_call_id`

转换前还会跑一次 `transformMessages`：

- 丢弃失败或中止的助手消息
- 归一化 tool call id
- 为孤立的 tool call 补一个错误结果
- 处理非视觉模型的图片降级

**第三步：工具声明**

工具转成 OpenAI function schema：

```json
{
  "type": "function",
  "function": {
    "name": "read",
    "description": "...",
    "parameters": { "type": "object", ... },
    "strict": false
  }
}
```

语法约束工具会转成 `type: "custom"`，这部分暂不复现。

**第四步：采样与思考参数**

- `max_tokens` 或 `max_completion_tokens`，由 `compat.maxTokensField` 决定
- `temperature`
- `tool_choice`
- `reasoning_effort` 或 provider 特有的 `thinking` / `reasoning` 字段
- `prompt_cache_key` / `prompt_cache_retention`
- 调用方自定义 `samplingParams`，最后合并，优先覆盖

### 2.5 streaming 响应

你（调用方）向 OpenAI 的 API 端点发起 POST 请求，并在请求体中设置了 stream: true 之后，服务器在 HTTP 响应体里返回的 Content-Type 通常是 text/event-stream，表明这是一个 SSE（Server-Sent Events）流。内容类似：

```text
data: {"choices":[{"delta":{"content":"你"}}]}
data: {"choices":[{"delta":{"content":"好"}}]}
data: [DONE]
```

adapter 逐个 chunk 读取：

```text
choices[0].delta.content           → 文本增量
choices[0].delta.reasoning_content → 思考增量
choices[0].delta.tool_calls        → tool call 增量
choices[0].finish_reason           → 结束原因
usage                              → 最后一块的 usage
```

每个增量都转成统一 event：

```text
start
text_start → text_delta* → text_end
thinking_start → thinking_delta* → thinking_end
toolcall_start → toolcall_delta* → toolcall_end
done
```

event 里的 `partial` 是“到目前为止的完整消息”，生产者原地修改它。

### 2.6 tool call 的累积

工具参数是分片到达的：

```text
chunk 1: {"index":0,"id":"call_1","function":{"name":"edit","arguments":"{\"pa"}}
chunk 2: {"index":0,"function":{"arguments":"th\":\"src/a.ts\","}}
chunk 3: {"index":0,"function":{"arguments":"\"oldText\":\"foo\"}"}}
```

adapter 需要：

1. 按 `index` 或 `id` 找到同一个 tool call 块
2. 累积 `arguments` 字符串
3. 每次累积后用部分 JSON 解析，更新 `block.arguments`
4. 流结束时发出完整的 `toolcall_end`

tool call 块的 `id` 和 `name` 可能只在第一块出现，后续块只带 `index`，所以需要映射表。

### 2.7 思考内容

推理模型的思考字段不统一：

- `reasoning_content`：DeepSeek、llama.cpp
- `reasoning`：部分兼容端点
- `reasoning_text`：少量实现
- `reasoning_details`：OpenRouter 的结构化回放数据

adapter 按顺序找第一个非空字段，避免同一条思考被重复写入。

思考内容还要保留签名：

- `thinkingSignature` 保存 provider 的回放数据
- 跨轮请求时按 `compat.requiresThinkingAsText` 决定转成文本还是保留字段

### 2.8 usage、费用与 stopReason

usage 来自最后一个 chunk：

```text
prompt_tokens
completion_tokens
prompt_tokens_details.cached_tokens
completion_tokens_details.reasoning_tokens
```

换算规则：

```text
input       = prompt_tokens - cacheRead - cacheWrite
output      = completion_tokens          // 已包含 reasoning
cacheRead   = cached_tokens
cacheWrite  = cache_write_tokens
totalTokens = input + output + cacheRead + cacheWrite
```

费用由 `calculateCost(model, usage)` 按模型价格计算。

`finish_reason` 映射：

| provider 值 | 统一 stopReason |
|---|---|
| `stop` / `end` | `stop` |
| `length` | `length` |
| `function_call` / `tool_calls` | `toolUse` |
| `content_filter` | `error` |
| `network_error` | `error` |
| 其它 | `error` |

没有 `finish_reason` 时，有些端点需要根据是否出现 tool call 推断 `toolUse` 或 `stop`。

### 2.9 同一 API 家族的兼容差异

`openai-completions` 是一类协议，不是一家实现。常见差异：

- 是否支持 `store`
- 是否使用 `developer` 角色
- 是否支持 `reasoning_effort`
- 最大 token 字段叫 `max_tokens` 还是 `max_completion_tokens`
- 工具结果是否要求 `name`
- 思考字段叫什么
- 是否支持 prompt cache
- 是否支持 `strict` 工具

原项目用两层处理：

```text
detectCompat(model)   按 provider 名和 baseUrl 推断默认值
getCompat(model)      用 model.compat 覆盖推断值
```

这样 model catalog 只需要写差异项，通用默认值由代码推断。

### 2.10 错误、重试与中止

请求阶段使用重试：

```text
retryProviderRequest()
  → 只重试可重试错误（429、5xx、网络错误）
  → 遵守服务端 Retry-After
  → 尊重 AbortSignal
```

streaming 阶段把错误编码进 event：

```text
请求前失败  → 只有 error event
生成后失败  → start → error event
用户中止    → stopReason = "aborted"
```

adapter 内部会清理临时字段（`partialArgs`、`customInput`、`streamIndex`），确保最终消息可以安全序列化。

### 2.11 与整体系统的关系

adapter 位于 `@pipi/llm` 的协议层：

- 向上：`Models` 通过 provider 调用它
- 向下：OpenAI SDK 或 HTTP 客户端
- 向左：课程 02 的类型、课程 03 的 event stream
- 向右：课程 06 的其它协议 adapter

课程 05 完成后，LLM 层可以真实调用模型。等 Agent 循环与工具层完成后，“模型回复 → tool call → 结果回填”的完整链路才会跑通。

### 2.12 小结

1. adapter 负责请求构造、SSE 解析、统一 event 映射。
2. 消息、工具、思考字段都需要按 OpenAI 格式转换。
3. 工具参数是分片 JSON，需要累积与部分解析。
4. usage 和 finish_reason 要归一化成统一语义。
5. 兼容差异集中在 `compat`，不要散落在业务代码里。
6. 错误、重试、中止都通过 stream event 表达。

---

## 3. 讨论与确认记录

> 学习本课程时，问题、解释、讨论结论以及对 B 阶段的影响记录在此；已确认决策见 `BUILD_PLAN.md` 决策表。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-08 | 决策 | 传输方式在原生 `fetch` + SSE 与 `openai` SDK 之间选择，两者差约 130 行，选定原生 `fetch` | 4.2 采用自建 SSE 读取；4.3 增加分帧与错误体解析 |
| 2026-11-08 | 决策 | 范围确定为 OpenAI 与 DeepSeek 两个 provider，共用一个 adapter | 4.2 的工厂列表固定为两个 |
| 2026-11-08 | 讨论 | 语法约束用于解码期限制输出文法，只有部分端点支持，实现成本高 | 工具只做 `function` + `strict`，grammar 后置 |
| 2026-11-08 | 讨论 | `reasoning_details` 是 OpenRouter 私有回放字段，当前 provider 范围用不到 | 思考只支持 `reasoning_content` 与 `reasoning` |
| 2026-11-08 | 决策 | maxTokens 收窄与请求钩子按原项目实现 | 4.2 增加 `estimateContextTokens`、`onPayload`、`onResponse` |

---

## 4. B：具体实现规划

### 4.1 原项目实现

| 文件 | 职责 | 关键位置 |
| --- | --- | --- |
| `packages/ai/src/api/openai-completions.ts` | 请求构造、SSE 解析、event 生产 | `stream` 311、`streamSimple` 726、`createClient` 747、`buildParams` 792、`convertMessages` 1156、`convertTools` 1448、`parseChunkUsage` 1485、`mapStopReason` 1528、`detectCompat` 1559 |
| `packages/ai/src/api/simple-options.ts` | 统一选项到完整选项的转换、token 预算 | `buildBaseOptions` 21、`clampMaxTokensToContext` 15、`adjustMaxTokensForThinking` 78 |
| `packages/ai/src/api/openai-completions.lazy.ts` | 动态加载 adapter | 全文 |
| `packages/ai/src/utils/retry.ts` | 请求重试 | `retryProviderRequest` 163 |
| `packages/ai/src/providers/openai.ts` | OpenAI provider 工厂 | 全文 |
| `packages/ai/src/providers/deepseek.ts` | DeepSeek provider 工厂 | 全文 |

原项目的实现顺序：

```text
1. getClientApiKey：确认 apiKey
2. getCompat：解析兼容配置
3. buildParams：转换 messages/tools，组装请求
4. onPayload：允许调用方改写请求体
5. retryProviderRequest：发请求并重试
6. onResponse：通知响应头
7. push(start)
8. for await chunk：累积文本/思考/tool call
9. finishBlock：收尾每个内容块
10. 映射 finish_reason / usage
11. push(done) 或 push(error)
```

### 4.2 新项目实现方案

新增：

```text
packages/llm/src/
├── api/
│   ├── openai-completions.ts
│   ├── openai-completions.lazy.ts
│   └── simple-options.ts
├── utils/
│   ├── estimate.ts
│   └── retry.ts
└── providers/
    ├── openai.ts
    └── deepseek.ts
```

实现边界：

1. **使用原生 `fetch` + SSE 解析**
   请求体、SSE 帧、错误体都由自己处理。代价是需要自己实现分帧、空闲超时、重试和错误解析。

2. **先实现 OpenAI 与 DeepSeek 两种兼容形态**
   OpenAI 使用 `max_completion_tokens`、`developer` 角色、`reasoning_effort`；DeepSeek 使用 `max_tokens`、`thinking` 字段。两者共享同一个 adapter，通过 `compat` 分支。

3. **tool call 支持 function 工具**
   先实现 `function` 工具与 `strict` 子集。语法约束工具、`custom` 工具后置。

4. **思考内容支持 `reasoning_content` 与 `reasoning`**
   覆盖 DeepSeek 与常见兼容端点。`reasoning_details` 的结构化回放后置。

5. **重试只做核心策略**
   429、5xx、网络错误重试；遵守 `Retry-After`；其它错误直接失败。

6. **provider 工厂用 `lazyApi`**
   课程 04 已有 `createProvider`，本课补上 `lazyApi` 包装：
   `openAICompletionsApi = lazyApi(() => import("./openai-completions.ts"))`。

建议的数据流：

```text
Models.streamSimple()
  → Provider.streamSimple()
  → openai-completions.stream()
  → buildRequest()
  → fetch / SSE
  → AssistantMessageEventStream
```

### 4.3 实现顺序

| 任务 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- |
| T-05-1 | `simple-options.ts`：`buildBaseOptions`、token 预算、思考预算 | 04 | 选项合并与 maxTokens 收窄正确 |
| T-05-2 | `convertMessages` / `convertTools`：系统提示、用户/助手/工具结果、图片、工具 schema | T-05-1 | 构造出的请求体符合 OpenAI 格式 |
| T-05-3 | `stream`：发请求、SSE 解析、文本与思考 event | T-05-2 | 能 streaming 产出 `text_*` / `thinking_*` |
| T-05-4 | tool call 累积、usage、stopReason、done/error | T-05-3 | 工具参数分片能还原；usage 与 stopReason 正确 |
| T-05-5 | 重试、错误归一化、中止、`lazyApi` | T-05-4 | 429/5xx 重试；中止产生 aborted；错误进入流 |
| T-05-6 | OpenAI/DeepSeek provider 工厂、导出、测试、changelog | T-05-5 | `build`、`test`、`tsc`、`biome` 通过 |

### 4.4 测试

| 测试 | 验证 |
| --- | --- |
| 请求构造 | 系统提示、用户文本/图片、助手文本/思考、工具结果、工具 schema |
| 文本流 | 多个 `content` chunk 拼成完整文本，event 顺序正确 |
| 思考流 | `reasoning_content` / `reasoning` 只取第一个非空字段 |
| tool call | 分片参数累积、部分 JSON 解析、`toolcall_end` 完整 |
| usage | cached/reasoning/totalTokens 与费用计算 |
| stopReason | `stop`、`length`、`tool_calls`、`content_filter` |
| 重试 | 429/5xx 重试；不可重试错误直接失败 |
| 中止 | `AbortSignal` 触发后 `stopReason = "aborted"` |
| provider 工厂 | OpenAI/DeepSeek 能注册、查找、streaming 返回 |

测试使用注入的 `fetch` 或本地假 SSE，不访问真实 API。

### 4.5 复现选项

| 选项 | 说明 | 结论 |
| --- | --- | --- |
| 原生 `fetch` + SSE | 自己解析 HTTP 与 SSE，学习价值高 | 采用 |
| 使用 `openai` SDK | 与原项目一致，少写协议细节 | 不采用 |
| 只做文本 | 不支持工具与思考 | 不采用：Agent 需要工具 |
| 只做 OpenAI | 不兼容 DeepSeek | 不采用：provider 范围含 DeepSeek |
| 引入完整 compat 矩阵 | 支持所有兼容端点 | 后置：先做 OpenAI/DeepSeek 子集 |
