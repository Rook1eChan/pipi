# D02 核心类型层

> 状态：文档已生成 / 步骤 A 未学 / 步骤 B 未学
> 前置：D01
> 产出：跨 provider、跨层复用的统一类型定义，是流协议、Agent 循环、会话持久化、压缩的共同语言。

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

## 2. 前置知识与依赖

- D01 的包结构与 TypeScript 配置
- 了解 JSON Schema / TypeBox 的基本概念
- 了解 LLM API 中 messages、tools、usage 的常见形状

---

## 3. 步骤 A——概念与功能讲解

### 3.1 为什么需要统一类型

假设没有统一类型，每个 provider 适配器都返回自己的结构：

```ts
// OpenAI 风格
{ choices: [{ message: { content, tool_calls }, finish_reason }] }

// Anthropic 风格
{ content: [{ type: "text", text }, { type: "tool_use", id, name, input }], stop_reason }
```

那么上层会遇到三个问题：

1. **Agent 循环要给每个 provider 写一遍**：判断有没有工具调用、提取文本、累加 usage
2. **会话无法跨模型恢复**：昨天用 Claude 存的记录，今天换 GPT 就读不懂
3. **UI 无法统一渲染**：每个 provider 的流事件形状不同

统一类型的作用是定义一个**最小公共语义**：不管底层 API 怎么变，上层只看到 `Message`、`Tool`、`Usage`、`Model`。

### 3.2 三层消息模型

Pi 里有两个"消息"概念，必须区分：

| 概念 | 定义位置 | 能包含什么 | 谁使用 |
| --- | --- | --- | --- |
| `Message` | `pi-ai` | 只有 `user` / `assistant` / `toolResult` | LLM API、适配器 |
| `AgentMessage` | `pi-agent-core` | `Message` + 应用自定义消息（通过 declaration merging） | Agent 循环、会话、UI |

为什么需要 `AgentMessage`：

- 会话里要记录"压缩摘要""分支摘要""bash 执行记录"这类**不发给模型**的内容
- 扩展可能想插入自己的消息类型
- 但模型只认识三种角色

于是 Agent 循环在每次调模型前做一次转换：

```text
AgentMessage[] ──transformContext()──► AgentMessage[] ──convertToLlm()──► Message[] ──► LLM
```

这一步是 D09 的内容，但类型的边界在这里就要定好：**`convertToLlm` 必须能把任意 `AgentMessage` 映射成合法 `Message`，或安全地丢弃。**

### 3.3 内容块（Content Block）

一条消息的内容不是纯字符串，而是块数组：

| 块 | 字段 | 用途 |
| --- | --- | --- |
| `TextContent` | `text`、可选 `textSignature` | 普通文本；签名用于某些 provider 的多轮元数据 |
| `ThinkingContent` | `thinking`、`thinkingSignature`、`redacted` | 推理内容；签名/加密载荷用于回放 |
| `ImageContent` | `data`(base64)、`mimeType` | 图片输入或工具结果中的图片 |
| `ToolCall` | `id`、`name`、`arguments`、`thoughtSignature`、`namespace` | 模型请求调用工具 |

为什么要用块数组而不是字符串：

1. 一条助手消息可以同时包含"思考 + 文本 + 多个工具调用"
2. 流式输出需要按块定位（`contentIndex`）
3. 不同块的生命周期不同（文本可以增量，工具参数是 JSON 片段）

### 3.4 助手消息的元数据

`AssistantMessage` 不只是内容，还携带"这次回复是怎么产生的"：

| 字段 | 作用 | 为什么必须保留 |
| --- | --- | --- |
| `api` / `provider` / `model` | 来源标识 | 跨模型回放时判断是否需要转换 |
| `responseModel` / `responseId` | 上游实际模型与响应 ID | 路由、调试、计费 |
| `usage` | token 与费用 | 压缩判断、统计、成本显示 |
| `stopReason` | 结束原因 | 决定循环是否继续、是否报错 |
| `errorMessage` | 错误详情 | UI 展示与重试判断 |
| `timestamp` | 毫秒时间戳 | 会话排序、UI 分组 |
| `diagnostics` | 脱敏诊断 | 排查 provider 异常 |

这些字段看起来多，但少一个就会在某个下游功能里缺失：

- 没有 `provider/api/model`：跨 provider 交接时无法判断"这条 thinking 能不能回放"
- 没有 `usage`：压缩无法判断何时触发
- 没有 `stopReason`：循环不知道是否还有工具调用

### 3.5 `stopReason` 的语义

```ts
type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
```

| 值 | 含义 | 循环行为 |
| --- | --- | --- |
| `pending` | 流尚未结束 | 不应出现在最终消息里 |
| `stop` | 模型正常结束 | 结束本轮 |
| `length` | 达到输出上限 | 结束本轮，通常提示用户 |
| `toolUse` | 模型请求调用工具 | 执行工具并继续 |
| `error` | 请求或解析失败 | 结束，错误已编码在消息里 |
| `aborted` | 用户中止 | 结束，保留部分内容 |
| `deferred` | provider 返回异步句柄 | 后续通过 `fetchDeferred` 取回 |

关键设计：**错误不是异常，而是消息的一种状态**。这让 UI 在收到错误时仍然拥有完整的事件序列和部分内容。

### 3.6 `Usage` 与费用

```ts
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input; output; cacheRead; cacheWrite; total };
}
```

为什么字段这么多：

- `cacheRead` / `cacheWrite`：提示缓存命中与写入，价格通常不同
- `cacheWrite1h`：Anthropic 的 1 小时缓存写入，单独计价
- `reasoning`：推理 token，是 `output` 的子集（不重复计入总数）
- `cost`：按模型价格换算后的金额，UI 与统计直接使用

设计约束：

- `reasoning` 必须是 `output` 的子集，不能重复累加
- 不同 provider 没有报告的字段保持 `undefined`，不要伪造 0
- 费用由模型价格与 usage 计算，不能让 provider 直接给

### 3.7 工具定义

```ts
interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
  constrainedSampling?: false | ConstrainedSamplingConfig;
}
```

三个要点：

1. **参数用 TypeBox schema**，不是手写 JSON Schema。这样既能生成 provider 需要的 schema，又能在本地做类型推导与校验
2. **`name` 必须稳定**：模型按名字调用，改名会破坏历史会话
3. **`constrainedSampling`** 是可选优化：让支持 grammar 的 provider 约束输出格式；不支持时退回普通函数调用

### 3.8 模型描述

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

为什么模型是"数据"而不是"类"：

- 模型目录可以从 JSON 生成
- 自定义 provider 只需要提供数据
- 测试可以构造任意模型，不需要网络

`compat` 是原项目的一个现实妥协：OpenAI 兼容端点之间存在大量差异（是否支持 `developer` 角色、`reasoning_effort`、`max_completion_tokens`、工具结果是否要 `name`）。这些差异不能污染统一类型，所以放进按 API 区分的可选配置。

### 3.9 `Context`

```ts
interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}
```

这是"一次 LLM 请求的全部输入"。它刻意保持最小：

- 不包含 provider 配置（在 `Model` 与 `options` 里）
- 不包含会话树（在 `coding-agent` 里）
- 不包含 UI 状态

### 3.10 跨 provider 的归一化

统一类型只解决"形状"，不解决"语义差异"。原项目用 `transformMessages()` 处理：

- 非视觉模型收到图片 → 替换为文本占位符
- 跨模型回放 thinking → 同模型保留签名，跨模型转成普通文本或丢弃
- 跨 provider 的工具调用 ID → 归一化为合法字符集
- 孤立的工具调用 → 补一个空的错误结果，满足 API 对"每个 call 必须有 result"的要求
- 失败/中止的助手消息 → 不回放，避免污染上下文

这些规则属于 D06，但类型设计必须支持它们（例如 `thinkingSignature`、`redacted`、`toolCall.id` 可变）。

---

## 4. 步骤 B——具体实现规划

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
packages/ai/src/
├── types.ts          # 所有公共类型
├── index.ts          # 导出 types 与 Type
└── utils/
    └── validation.ts # 工具参数校验（D11 使用）
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

1. 基础别名：`Api`、`ProviderId`、`StopReason`、`ThinkingLevel`
2. 内容块：`TextContent`、`ThinkingContent`、`ImageContent`、`ToolCall`
3. 消息：`UserMessage`、`AssistantMessage`、`ToolResultMessage`、`Message`
4. 用量：`Usage`
5. 工具：`Tool`
6. 模型：`Model`、`ModelCost`、`ModelCostTier`
7. 请求：`Context`、`StreamOptions`、`SimpleStreamOptions`
8. 事件：`AssistantMessageEvent`（D03 详述）

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
| `ImagesModel` / `AssistantImages` | 可后置到 D08 | 与文本 Agent 独立 |

### 4.7 测试

| 测试 | 内容 |
| --- | --- |
| 类型构造 | 构造一条包含文本、思考、工具调用的助手消息，能被 JSON 序列化/反序列化 |
| usage 计算 | 给定 provider usage，计算 `totalTokens` 与 `cost` |
| 参数校验 | 合法参数通过；缺字段、类型错误、可选字段为 null 的行为符合预期 |
| 不变量 | `reasoning <= output`、工具结果能匹配调用 |
| 跨 provider | 用 `transformMessages` 处理图片、thinking、孤立工具调用 |

### 4.8 待确认

- 是否保留 `deferred` 相关类型（Q-003）
- `compat` 字段先支持哪些（取决于第一个适配器选 OpenAI Completions 还是 Responses）
- 是否从一开始就支持图像（Q-006）

---

## 5. 原源码对应关系

| 主题 | 文件 | 行号 |
| --- | --- | --- |
| API / Provider 标识 | `packages/ai/src/types.ts` | 13–61 |
| 内容块 | 同上 | 327–357 |
| `Usage` | 同上 | 359–380 |
| `StopReason` | 同上 | 382 |
| 消息 | 同上 | 398–446 |
| `Tool` | 同上 | 493–498 |
| `Context` | 同上 | 500–504 |
| 流事件 | 同上 | 522–538 |
| `StreamOptions` | 同上 | 158–202 |
| `Model` | 同上 | 809–836 |
| 兼容配置 | 同上 | 544–702 |
| 参数校验 | `packages/ai/src/utils/validation.ts` | 302–350 |
| 跨 provider 归一化 | `packages/ai/src/api/transform-messages.ts` | 64–223 |
| Agent 消息与工具 | `packages/agent/src/types.ts` | 294–437 |

---

## 6. 与整体系统的关系

- 依赖：D01 的包结构
- 支撑：D03 流协议、D04 注册表、D09 循环、D11 工具执行、D14 会话持久化、D16 压缩
- 后续修改类型的成本很高，因此这一篇的检查点必须认真回答

---

## 7. 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 单文件 | 与原文一致 | 推荐 |
| 按主题拆分 | 更清晰 | 可选，注意循环引用 |
| 精简 usage | 只保留 input/output | 不推荐：压缩与统计会缺数据 |
| 省略签名 | 简化实现 | 可选，但跨轮 thinking 会失效 |
| 省略 `compat` | 简化模型类型 | 不推荐：第一个适配器就会遇到 |

---

## 8. 学习检查点

1. 为什么 `Message` 和 `AgentMessage` 要分开？如果合并，会话里的压缩摘要该怎么存？
2. `reasoning` 为什么必须定义为 `output` 的子集？如果把它加进 `totalTokens` 会怎样？
3. 工具参数为什么要用 TypeBox 而不是普通 JSON Schema？
4. `stopReason` 为 `error` 时，为什么不让循环直接抛异常？
5. 跨 provider 回放时，哪些字段必须丢弃或转换？为什么 thinking 不能无条件保留？
