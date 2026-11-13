# 06 多 API 家族与请求基础设施

> 课程状态：待学习
> 覆盖模块：`@pipi/llm` 的 Anthropic adapter、跨协议消息归一化，以及其它 API 家族的结构差异
> 课程文件：06-api-families.md
> 本课产出：理解多协议差异，实现 `transformMessages` 与 Anthropic adapter，并复用 05 的请求基础设施。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| API family（API 家族） | 一组请求与响应格式相同的端点，例如 Anthropic Messages、OpenAI Chat Completions。 |
| content block | 消息内容的基本单元：文本、图片、思考、tool call。 |
| `tool_use` / `tool_result` | Anthropic 对 tool call 与其结果的命名。 |
| `system` | Anthropic 把 system prompt 放在请求顶层，而不是消息数组里。 |
| streaming event type | 流式协议里带名字的事件，例如 `content_block_delta`。 |
| `input_json_delta` | Anthropic 流式返回工具参数的增量片段。 |
| thinking signature | 思考块附带的签名，用于跨轮原样回放。 |
| `transformMessages` | 把统一消息转换成目标协议可接受的形式，并修复跨协议遗留问题。 |
| 孤儿 tool call | assistant 发起了工具调用，但历史里缺少对应的 tool result。 |

---

## 1. 构建目标

课程 05 实现了一个 adapter：`openai-completions`。它只能和 Chat Completions 协议通信。

本课解决三个问题：

1. 不同协议的请求结构差在哪里
2. 不同协议的流式事件差在哪里
3. 跨协议的历史消息如何统一

完成后：

- `@pipi/llm` 可以调用 Anthropic
- 消息在切换 provider 时不会因为格式问题失败
- 05 的重试、错误归一化、超时可以被所有 adapter 复用

范围：

| API 家族 | 本课处理方式 |
| --- | --- |
| `openai-completions` | 已完成 |
| `anthropic-messages` | 实现 |
| `openai-responses` | 了解，后置 |
| `google-generative-ai` | 了解，后置 |
| `mistral-conversations` | 了解，后置 |

---

## 2. A：概念与功能讲解

### 2.1 本课主线

协议差异可以分成三层：

```text
请求结构    消息怎么放、system 放哪里、工具怎么声明
流式事件    服务端按什么粒度推送、事件叫什么
回放规则    历史消息如何再次发给模型
```

每一层都要统一：

```text
统一类型  →  协议请求   （每层翻译）
协议响应  →  统一 event （每层翻译）
```

`transformMessages` 处理第三层，因为回放规则不只属于某个 adapter。

### 2.2 差异从哪里来

各家的 API 都是独立演化的，常见差异有：

| 维度 | OpenAI Completions | Anthropic Messages |
| --- | --- | --- |
| system prompt | `messages` 里 `role: "system"` | 请求顶层 `system` 字段 |
| 消息内容 | 字符串或 content part 数组 | content block 数组 |
| tool call | assistant 的 `tool_calls` | assistant 的 `tool_use` block |
| tool result | `role: "tool"` 消息 | user 消息里的 `tool_result` block |
| 工具声明 | `tools[].function` | `tools[].input_schema` |
| 思考 | `reasoning_effort` | `thinking.budget_tokens` |
| 结束原因 | `finish_reason` | `stop_reason` |

同一个概念在不同协议里位置不同，adapter 的职责就是把它们对齐。

### 2.3 Anthropic Messages 协议

**请求骨架**

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 8192,
  "system": [{ "type": "text", "text": "你是一个编码助手" }],
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "读取 src/a.ts" }] }
  ],
  "tools": [
    { "name": "read", "description": "read a file", "input_schema": { "type": "object", "properties": {} } }
  ],
  "stream": true
}
```

与 Chat Completions 的关键区别：

| 项 | Anthropic | Chat Completions |
| --- | --- | --- |
| system | 顶层 `system`，可以是字符串或 block 数组 | 消息数组中的 system/developer |
| `max_tokens` | 必填 | 可选 |
| 工具 schema 字段 | `input_schema` | `parameters` |
| 工具结果 | user 消息内的 `tool_result` block | 独立的 `role: "tool"` 消息 |

**assistant 的工具调用**

```json
{
  "role": "assistant",
  "content": [
    { "type": "tool_use", "id": "toolu_1", "name": "read", "input": { "path": "src/a.ts" } }
  ]
}
```

**工具结果**

```json
{
  "role": "user",
  "content": [
    { "type": "tool_result", "tool_use_id": "toolu_1", "content": "file body" }
  ]
}
```

注意：工具结果属于 user 角色，不是独立消息。

**思考参数**

```json
{
  "thinking": { "type": "enabled", "budget_tokens": 8192 }
}
```

限制：

- 开启思考时不能设置 `temperature`
- `budget_tokens` 必须小于 `max_tokens`
- 思考块回放时要带 `signature`

### 2.4 Anthropic 流式事件

Chat Completions 每帧是一个完整 chunk；Anthropic 的流是**有名字的事件**：

```text
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{...}}

event: message_stop
data: {"type":"message_stop"}
```

事件与内容块的对应：

| 事件 | 作用 |
| --- | --- |
| `message_start` | 携带 `usage.input_tokens` 和消息 id |
| `content_block_start` | 开始一个块：文本、思考或 tool_use |
| `content_block_delta` | 块内增量 |
| `content_block_stop` | 关闭当前块 |
| `message_delta` | `stop_reason` 与累计 usage |
| `message_stop` | 流结束 |

`content_block_delta` 的 `delta.type` 决定含义：

| `delta.type` | 对应统一事件 |
| --- | --- |
| `text_delta` | `text_delta` |
| `thinking_delta` | `thinking_delta` |
| `signature_delta` | 写入 `thinkingSignature` |
| `input_json_delta` | `toolcall_delta` |

工具参数不是完整 JSON，而是 `input_json_delta` 里的片段：

```text
delta: {"type":"input_json_delta","partial_json":"{\"pa"}
delta: {"type":"input_json_delta","partial_json":"th\":\"src/a.ts\"}"}
```

adapter 需要累积 `partial_json`，与 05 的工具参数累积逻辑一致。

### 2.5 Responses API 的结构差异

`openai-responses` 是同厂商的另一套协议，与 Chat Completions 的差异：

| 项 | Chat Completions | Responses |
| --- | --- | --- |
| 输入 | `messages` | `input` items |
| system prompt | 消息 | `instructions` |
| 工具调用 | `tool_calls` | `function_call` item |
| 流式事件 | `choices[].delta` | `response.output_text.delta` 等命名事件 |
| 思考 | `reasoning_effort` | `reasoning` 配置与加密 reasoning item |

它更适合有状态、长上下文、内置工具的场景，但结构也更复杂。

### 2.6 Google Generative AI 的结构差异

Google 的请求用 `contents` + `parts`：

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "读取 src/a.ts" }] }
  ],
  "systemInstruction": { "parts": [{ "text": "你是一个编码助手" }] },
  "tools": [{ "functionDeclarations": [{ "name": "read", "parameters": {} }] }]
}
```

特点：

| 项 | 说明 |
| --- | --- |
| 角色 | `user` / `model`，没有 assistant |
| 工具调用 | `part.functionCall` |
| 工具结果 | `part.functionResponse` |
| 图片 | `inlineData`，base64 |
| 流式 | 返回 JSON 块数组，不是 SSE 的 `data:` 帧 |

它验证了一件事：统一 event 协议不能依赖某种传输格式。

### 2.7 Mistral 的结构差异

Mistral 的 `conversations` 接近 Chat Completions：

- 有 `messages`、`tools`、`stream`
- 流式仍是 SSE
- 但字段名、结束原因和工具调用细节有差异

它的存在说明“OpenAI 兼容”是程度问题，不是布尔值。`compat` 只能覆盖字段差异，无法覆盖结构差异。

### 2.8 跨协议归一化：`transformMessages`

切换 provider 时，历史消息可能来自另一个协议，需要先修正：

| 问题 | 处理 |
| --- | --- |
| 模型不支持图片 | 图片替换成占位文本，相邻图片只保留一个占位 |
| 思考块来自别的模型 | 丢弃签名，降级为普通文本；`redacted` 直接丢弃 |
| tool call id 不合法 | 按目标协议规则归一化，并同步更新 tool result 的引用 |
| 孤儿 tool call | 补一条“无结果”的 tool result |
| 失败或中止的 assistant 消息 | 整条丢弃，不参与回放 |

**为什么必须补孤儿结果**

多数协议要求每个 tool call 都有对应结果。缺一条会直接报错：

```text
assistant: tool_use(id=toolu_1)
（缺少 tool_result）
```

补一条：

```json
{ "type": "tool_result", "tool_use_id": "toolu_1", "content": "No result provided", "is_error": true }
```

**为什么要丢弃失败消息**

```text
stopReason: "aborted" 的 assistant 可能只有半个 tool call
stopReason: "error" 的 assistant 可能只有思考没有正文
```

回放这些内容会让目标协议解析失败，正确做法是从最后一个完整状态重试。

**为什么思考块要区分同模型与跨模型**

| 情况 | 处理 |
| --- | --- |
| 同一个 provider + api + model | 保留思考块与签名，便于回放 |
| 跨模型 | 转成普通文本，避免签名无效 |
| `redacted`（加密载荷） | 只有同模型才保留 |

### 2.9 工具调用与思考回放

统一类型里，工具调用与结果分开存：

```ts
AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]
ToolResultMessage: { toolCallId, toolName, content, isError }
```

到各协议再展开：

| 统一概念 | Anthropic | Chat Completions |
| --- | --- | --- |
| `ToolCall` | `tool_use` block | `tool_calls[]` |
| `ToolResultMessage` | user 消息里的 `tool_result` | `role: "tool"` 消息 |
| `thinkingSignature` | `signature` 字段 | `reasoning_content` 等字段 |

回放的关键约束：**签名只能发给产生它的模型**。跨模型时降级，否则服务端会拒绝。

### 2.10 请求基础设施的复用

05 已经实现的能力与协议无关：

| 能力 | 文件 | 复用方式 |
| --- | --- | --- |
| 重试 | `utils/retry.ts` | 每个 adapter 包住自己的请求函数 |
| 错误归一化 | `utils/error-body.ts` | 每个 adapter 把非 2xx 转成 `ProviderHttpError` |
| 超时 | `StreamOptions.timeoutMs` | 与 `signal` 合并后传给 fetch |
| 懒惰加载 | `api/lazy.ts` | 每个 adapter 一个 lazy 入口 |

课程 06 不重写这些，只在新 adapter 里调用。

### 2.11 与整体系统的关系

```text
Models
  └─ Provider（anthropic / openai / deepseek）
        └─ adapter（anthropic-messages / openai-completions）
              ├─ transformMessages   跨协议修正
              ├─ 请求转换            统一类型 → 协议格式
              ├─ streaming 解析      协议事件 → 统一 event
              └─ 请求基础设施        重试、错误、超时
```

上层（Agent、harness）仍然只看到 `Context` 和统一 event，不需要知道当前是哪个协议。

### 2.12 小结

1. 协议差异分三层：请求结构、流式事件、回放规则。
2. Anthropic 的 system、工具、思考都与 Chat Completions 不同，但可以映射到同一套类型。
3. Anthropic 的流是命名事件，工具参数通过 `input_json_delta` 分片到达。
4. `transformMessages` 解决跨协议的历史兼容问题，是 adapter 之前的公共步骤。
5. 请求基础设施与协议无关，应当复用而不是复制。
6. 统一 event 协议的价值，在于让上层不感知这些差异。

---

## 3. 讨论与确认记录

> 学习本课程时，问题、解释、讨论结论以及对 B 阶段的影响记录在此；已确认决策见 `BUILD_PLAN.md` 决策表。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| - | - | 尚无记录 | - |

---

## 4. B：具体实现规划

### 4.1 原项目实现

| 文件 | 职责 | 关键位置 |
| --- | --- | --- |
| `packages/ai/src/api/anthropic-messages.ts` | Anthropic 请求构造、SSE 解析、事件生产 | `stream` 505、`streamSimple` 849、`buildParams` 1020、`convertMessages` 1222、`convertTools` 1424、`mapStopReason` 1463 |
| `packages/ai/src/api/transform-messages.ts` | 跨协议消息归一化 | `transformMessages` 64 |
| `packages/ai/src/api/anthropic-messages.lazy.ts` | 动态加载 | 全文 |
| `packages/ai/src/providers/anthropic.ts` | provider 工厂 | 全文 |
| `packages/ai/src/api/openai-responses.ts` | Responses API 实现 | `stream` 116、`buildParams` 275 |
| `packages/ai/src/api/google-generative-ai.ts` | Google 实现 | `stream` 53、`buildParams` 359 |
| `packages/ai/src/api/mistral-conversations.ts` | Mistral 实现 | `stream` 122 |

原项目 Anthropic adapter 的执行顺序：

```text
1. assertRequestAuth：确认 apiKey
2. getAnthropicCompat：读取模型差异
3. transformMessages：归一化历史消息
4. convertMessages：内容块 → Anthropic block
5. convertTools：input_schema
6. buildParams：system、max_tokens、thinking
7. 发请求并重试
8. 解析命名事件：message_start → content_block_* → message_delta → message_stop
9. 映射 stop_reason 与 usage
10. push done
```

### 4.2 新项目实现方案

按 D-018，本课只实现 Anthropic；Responses、Google、Mistral 只保留结构说明。

新增文件：

```text
packages/llm/src/
├── api/
│   ├── anthropic-messages.ts
│   ├── anthropic-messages.lazy.ts
│   └── transform-messages.ts
└── providers/
    └── anthropic.ts
```

实现边界：

1. **先实现 `transformMessages`**
   它是两个协议共用步骤，先做可以同时服务 OpenAI 与 Anthropic。包含：图片降级、失败消息丢弃、tool call id 归一化、孤儿 tool result 补齐。

2. **Anthropic 请求转换**
   `system` 放顶层；assistant 的思考块保留签名，tool call 转 `tool_use`；tool result 合并进 user 消息的 `tool_result` block；工具声明用 `input_schema`。

3. **命名事件解析**
   复用 05 的分帧逻辑，但按 `event:` 字段分派；工具参数累积 `input_json_delta`；`signature_delta` 写入 `thinkingSignature`。

4. **思考预算**
   调用 `adjustMaxTokensForThinking`，得到 `max_tokens` 与 `budget_tokens`；开启思考时不发 `temperature`。

5. **复用请求基础设施**
   `providerRequestWithRetry`、`ProviderHttpError`、`timeoutMs` 与 05 相同。

6. **provider 工厂与 lazy**
   `anthropicProvider()` 使用 `ANTHROPIC_MODELS`、`ANTHROPIC_API_KEY`，`api` 指向 `anthropicMessagesApi()`。

数据流：

```text
Models.streamSimple()
  → Provider.streamSimple()
  → anthropic-messages.streamSimple()
  → adjustMaxTokensForThinking()
  → stream()
  → buildParams()
  → fetch / SSE
  → 统一 event
```

### 4.3 实现顺序

| 任务 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- |
| T-06-1 | `transform-messages.ts`：图片降级、失败消息丢弃、tool id 归一化、孤儿结果补齐 | 05 | 四类问题都有测试 |
| T-06-2 | Anthropic 请求转换：system、消息块、工具声明、思考参数 | T-06-1 | 请求体符合 Anthropic 格式 |
| T-06-3 | Anthropic 流解析：命名事件、文本、思考、tool call、usage、stopReason | T-06-2 | 事件顺序与内容正确 |
| T-06-4 | `streamSimple`、重试、错误归一化、超时 | T-06-3 | 思考预算与错误路径正确 |
| T-06-5 | provider 工厂、lazy 入口、导出、测试与 changelog | T-06-4 | `build`、`test`、`check` 通过 |

### 4.4 测试

| 测试 | 验证 |
| --- | --- |
| 图片降级 | 不支持图片的模型收到占位文本 |
| 失败消息 | `aborted` / `error` 的 assistant 被丢弃 |
| tool id | 特殊字符 id 被归一化，tool result 引用同步更新 |
| 孤儿结果 | 缺失结果被补成 `is_error` |
| 请求构造 | system 顶层、tool_use/tool_result、input_schema |
| 文本流 | 命名事件转成 `text_*` |
| 思考流 | `thinking_delta` 与 `signature_delta` |
| 工具流 | `input_json_delta` 累积成完整参数 |
| stopReason | `end_turn`、`max_tokens`、`tool_use`、`refusal` |
| usage | 输入、输出、缓存读写 |
| 重试与错误 | 429/5xx 重试；4xx 直接失败 |

测试使用注入的 `fetch` 和构造好的 SSE 文本，不访问真实 API。

### 4.5 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 实现 Anthropic adapter | 第二个真实协议，验证抽象是否成立 | 采用 |
| 同时实现 Responses/Google/Mistral | 覆盖全部家族 | 后置：超出 D-018 范围 |
| `transformMessages` 独立成文件 | 两个 adapter 共用 | 采用 |
| 把归一化塞进各 adapter | 少一个文件 | 不采用：会重复且容易漂移 |
| 只做请求转换，不做流式 | 实现简单 | 不采用：无法接入真实模型 |
