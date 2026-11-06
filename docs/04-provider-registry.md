# 04 Provider 注册表与模型目录

> 课程状态：验收通过
> 覆盖模块：`@pipi/llm` 的 Provider、Models 集合、模型目录、认证委托与动态刷新
> 课程文件：04-provider-registry.md
> 本课产出：运行时可以登记多个 provider，按 provider + model id 查找模型，解析认证，并把请求分发给对应实现。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| provider | 一个可调用的服务提供方，例如 OpenAI、Anthropic、DeepSeek。它拥有 id、地址、认证方式和模型清单。 |
| adapter / API 实现 | 把统一请求翻译成某家 API 具体格式的代码，例如 `openai-completions`。provider 决定用哪个 adapter。 |
| registry（注册表） | 保存 `provider id → provider` 的运行时集合，并提供查找与分发入口。 |
| model catalog（模型目录） | 某个 provider 下可用模型的清单，包含 id、上下文窗口、价格、能力等元数据。 |
| credential（凭据） | 调用 provider 所需的密钥，可以本地化。 |
| dispatch（分发） | 根据模型所属 provider 和 API，把请求交给正确的实现。 |

---

## 1. 构建目标

课程 02 定义了“一条消息长什么样”，课程 03 定义了“一次回复如何流式返回”。本课补上中间缺失的一层：

- 模型从哪里来
- 一个模型属于哪个 provider
- 请求应该交给哪个 API 实现
- 认证信息在哪里解析和注入
- 多个 provider 如何共存

完成后，上层只需要持有“模型对象”和“注册表”，就能发起请求，不需要知道 OpenAI、Anthropic 或本地服务的差异。

---

## 2. A：概念与功能讲解

### 2.1 本课主线

一个模型调用包含三类信息：

```text
模型身份      provider=deepseek, model=deepseek-v4-flash
调用行为      provider 用 openai-completions 适配器发请求
运行时条件    API key、baseUrl、headers、缓存策略
```

课程 02 的 `Model` 只描述第一类和部分第三类；它不包含“怎么发请求”。本课要解决的问题是：把“模型数据”与“调用行为”组合成一个可执行的运行时单元，并让多个这样的单元共存。

主线可以概括为：

```text
Model（数据）
  + Provider（行为与身份）
  + Models（集合与请求入口）
  + 认证解析
  = 一次可执行的模型调用
```

### 2.2 注册表要解决的问题

假设没有注册表，调用方通常要写：

```ts
if (model.provider === "openai") {
  return openaiClient.chat(model, context, { apiKey: process.env.OPENAI_API_KEY });
}
if (model.provider === "anthropic") {
  return anthropicClient.messages(model, context, { apiKey: process.env.ANTHROPIC_API_KEY });
}
```

这种写法有三个问题：

1. 每增加一个 provider，就要改调用方
2. 认证、baseUrl、headers 的处理散落在业务代码里
3. 模型清单、可用性判断、动态刷新没有统一位置

注册表把这些职责收进一个对象：

```ts
const models = createModels();
models.setProvider(deepseekProvider());

const model = models.getModel("deepseek", "deepseek-v4-flash");
const stream = models.streamSimple(model, context);
```

调用方只依赖 `Models` 接口，不依赖具体 provider。

### 2.3 Provider：一个可调用的运行时单元

`Provider` 是“某个 provider 的完整运行时描述”。它包含五组能力：

| 能力 | 作用 |
| --- | --- |
| 身份 | `id`、`name`、`baseUrl`、默认 `headers` |
| 认证 | `auth`，声明 API key 或 OAuth 方式 |
| 模型清单 | `getModels()`，同步返回当前已知模型 |
| 调用 | `stream()`、`streamSimple()`，把请求交给具体 API |
| 可选能力 | `refreshModels()`、`filterModels()`、`fetchDeferred()`、`cancelDeferred()` |

关键设计：**provider 拥有行为，模型只是数据**。

`Model` 里有 `api` 字段，例如 `openai-completions`、`anthropic-messages`。provider 根据这个字段选择实现。一个 provider 可以只支持一种 API，也可以同时支持多种 API。

```ts
interface Provider {
  id: string;
  name: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
  auth: ProviderAuth;
  getModels(): readonly Model[];
  refreshModels?(context: RefreshModelsContext): Promise<void>;
  filterModels?(models: readonly Model[], credential: Credential | undefined): readonly Model[];
  stream(model, context, options?): AssistantMessageEventStream;
  streamSimple(model, context, options?): AssistantMessageEventStream;
}
```

`stream` 接收完整选项，`streamSimple` 接收统一选项（`reasoning`、`toolChoice` 等）。前者给需要 provider 专有参数的调用方，后者给 Agent 这类只关心统一语义的调用方。

### 2.4 Models：集合与请求入口

`Models` 是 provider 的集合，也是上层唯一需要持有的对象。它的职责不是实现协议，而是：

1. 保存 provider
2. 查找模型
3. 解析认证
4. 把请求转发给正确的 provider
5. 管理动态模型刷新

```ts
interface Models {
  getProviders(): readonly Provider[];
  getProvider(id: string): Provider | undefined;
  getModels(provider?: string): readonly Model[];
  getModel(provider: string, id: string): Model | undefined;
  getAvailable(providerId?: string): Promise<readonly Model[]>;
  getAuth(providerId: string): Promise<AuthResult | undefined>;
  getAuth(model: Model): Promise<AuthResult | undefined>;
  stream(model, context, options?): AssistantMessageEventStream;
  streamSimple(model, context, options?): AssistantMessageEventStream;
  complete(model, context, options?): Promise<AssistantMessage>;
  completeSimple(model, context, options?): Promise<AssistantMessage>;
  refresh(options?): Promise<ModelsRefreshResult>;
  login(providerId, type, interaction): Promise<Credential>;
  logout(providerId): Promise<void>;
}
```

两个容易混淆的点：

- `getModels()` 是同步的，只返回“当前已知”的模型；它不发起网络请求。
- `refresh()` 是异步的，负责更新动态 provider 的模型清单。

`complete()` 与 `completeSimple()` 只是流式接口的便捷包装：内部调用 `stream()`，再 `await stream.result()`。

### 2.5 一次请求的完整路径

这一节从“外部代码如何拿到 `Models`、如何传入 `model` 和 `context`”讲起，一直追到适配器产生事件、调用方拿到最终消息。

#### 2.5.1 外部视角：先创建 Models，再查模型

调用方先创建 `Models`，再把 provider 注册进去：

```ts
import { createModels } from "@pipi/llm";
import { deepseekProvider } from "@pipi/llm/providers/deepseek";

const models = createModels();
models.setProvider(deepseekProvider());

const model = models.getModel("deepseek", "deepseek-v4-flash");  // 指定provider和model_id，精确匹配
if (!model) {
  throw new Error("模型不存在");
}
```

这段代码只做三件事：

1. `createModels()` 创建一个空的 provider 集合
2. `setProvider()` 把 provider 放进集合，按 `provider.id` 建索引
3. `getModel(provider, id)` 在集合里查模型数据

`getModel` 是同步的，不发网络请求。它返回的 `Model` 只包含模型元数据，不包含“怎么发请求”。

调用方再准备 `context`：

```ts
const context = {
  systemPrompt: "你是一个编码助手。",
  messages: [
    { role: "user", content: "读取 src/a.ts", timestamp: Date.now() },
  ],
};
```

`context` 是这次请求的全部输入：系统提示、消息历史、可选工具列表。它由上层（Agent 或产品层）组装，`Models` 不负责生成它。

#### 2.5.2 调用入口：同步拿到流

真正发请求的入口是：

```ts
const stream = models.streamSimple(model, context);
```

注意这里**没有 `await`**。`streamSimple` 立即返回一个 `AssistantMessageEventStream`，此时认证还没解析，HTTP 请求也还没发出。

内部第一步是：

```text
ModelsImpl.streamSimple()
  → lazyStream(model, setup)
  → 返回 outer 流
```

`lazyStream` 做三件事：

1. 创建一个外层流 `outer`
2. 启动异步 `setup`
3. 立即返回 `outer`

`setup` 成功时，把内层流的事件转发给 `outer`；失败时，往 `outer` 推一个 `error` 事件并结束。

这样设计的原因：认证、刷新 token、加载模块都可能耗时，不能阻塞调用方拿流。调用方的代码路径始终是“拿流 → 消费 → 看最终结果”。

#### 2.5.3 查找 provider

`setup` 的第一件事是按 `model.provider` 找 provider：

```text
requireProvider(model)
  → providers.get(model.provider)
```

找不到时抛出：

```ts
new ModelsError("provider", `Unknown provider: ${model.provider}`)
```

这个异常发生在 `lazyStream` 的 `setup` 里，所以不会抛给调用方，而是变成：

```text
error 事件 → 流结束
```

调用方在 `for await` 里会收到这个 `error` 事件，`await stream.result()` 会拿到带 `errorMessage` 的助手消息。

#### 2.5.4 解析认证

找到 provider 后，`setup` 调用：

```text
applyAuth(model, options)
  → getAuth(model, { apiKey, env, signal })
  → resolveProviderAuth(provider, credentials, authContext, overrides)
```

认证解析的顺序是：

1. 请求显式传入的 `options.apiKey`
2. 存储的凭据
   - `api_key`：直接使用
   - `oauth`：过期则在凭据存储的锁内刷新，再派生请求头
3. 完全没有存储凭据时，才回退环境变量
4. 都没有 → 返回 `undefined`

原项目支持 API key 和 OAuth。pipi 当前只保留 API key，OAuth 类型、登录和刷新不进入实现，见 `BUILD_PLAN.md` 决策表。

解析结果是：

```ts
interface AuthResult {
  auth: {
    apiKey?: string;
    headers?: Record<string, string | null>;
    baseUrl?: string;
  };
  env?: Record<string, string>;
  source?: string;
}
```

`source` 是给人看的来源标签，例如 `DEEPSEEK_API_KEY`、`stored credential`、`OAuth`。

认证缺失时抛出：

```ts
new ModelsError("auth", `Provider is not configured: ${model.provider}`)
```

同样被 `lazyStream` 转成 `error` 事件。

#### 2.5.5 合并请求参数

拿到 `AuthResult` 后，`applyAuth` 把它和调用方传入的 `options` 合并：

```text
apiKey   = options.apiKey ?? auth.apiKey
headers  = mergeHeaders(auth.headers, options.headers)
headers  = await options.transformHeaders(headers)   // 最后执行
env      = { ...auth.env, ...options.env }
model    = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model
```

合并规则：

- 请求显式值优先于认证解析值
- header 合并按名字大小写不敏感，后者覆盖前者
- `transformHeaders` 最后执行，能看到最终 header
- `env` 是逐键合并，调用方覆盖 provider 值
- 如果认证结果带 `baseUrl`，用它替换模型上的 `baseUrl`

最终得到两个对象：

```ts
requestModel   // 替换了 baseUrl 的模型
requestOptions // 带 apiKey、headers、env 的请求选项
```

#### 2.5.6 选择 API 实现

接下来调用：

```text
provider.streamSimple(requestModel, context, requestOptions)
```

provider 不直接实现协议，它把请求交给对应的 API 适配器。`createProvider` 内部维护两种形态：

- 单一 API：所有模型都走同一个实现
- API 映射：按 `model.api` 查表

```ts
const streams = singleApi ?? byApi[model.api];
```

如果 `model.api` 没有对应实现，provider 返回一个只包含 `error` 事件的流：

```ts
new ModelsError("stream", `Provider ... has no API implementation for "${model.api}"`)
```

注意这里仍然不抛异常，而是返回流。调用方的错误处理路径保持一致。

#### 2.5.7 适配器如何产生事件

API 适配器负责真正发请求。它的典型流程是：

```text
创建 AssistantMessageEventStream
→ 创建空 AssistantMessage，stopReason = "pending"
→ 发送 HTTP 请求
→ push({ type: "start", partial })
→ 解析流式响应，push text_* / thinking_* / toolcall_*
→ 结束：设置 stopReason，push({ type: "done" })，end()
→ 失败：设置 errorMessage，push({ type: "error" })，end()
```

每个事件都带 `partial`，它是“到目前为止的完整消息”。文本、思考、工具参数分别按块累积：

```text
text_start → text_delta* → text_end
thinking_start → thinking_delta* → thinking_end
toolcall_start → toolcall_delta* → toolcall_end
```

适配器还要处理 provider 差异，例如 stop reason 映射、usage 解析、工具参数 JSON 修复。这些属于课程 05/06，本课只需要知道它最终产出统一事件序列。

#### 2.5.8 事件如何回到调用方

适配器产生的是内层流。`lazyStream` 的 `forwardStream` 把内层事件逐个推给外层：

```ts
for await (const event of inner) {
  outer.push(event);
}
outer.end(await inner.result());
```

它不修改事件，也不重排顺序。外层流结束后，`result()` 返回最终 `AssistantMessage`。

调用方可以只消费事件：

```ts
for await (const event of stream) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
const message = await stream.result();
```

也可以不关心增量，直接等最终结果：

```ts
const message = await models.completeSimple(model, context);
```

`completeSimple` 只是 `streamSimple(...).result()` 的便捷包装。

#### 2.5.9 失败路径

| 失败点 | 事件序列 | 最终结果 |
| --- | --- | --- |
| 未知 provider | 只有 `error` | `stopReason: "error"` |
| 认证缺失 | 只有 `error` | `stopReason: "error"` |
| 缺少 API 实现 | 只有 `error` | `stopReason: "error"` |
| 请求建立失败（`start` 之前） | 只有 `error` | `stopReason: "error"` |
| 生成开始后解析失败 | `start` → `error` | `stopReason: "error"` |
| 用户中止（开始前） | 只有 `error` | `stopReason: "aborted"` |
| 用户中止（开始后） | `start` → `error` | `stopReason: "aborted"` |

两条规则：

1. `result()` 永远不会 reject。成功时返回 `done.message`，失败时返回 `error.error`。
2. 生成开始前的失败只有 `error` 事件；生成开始后的失败是 `start` → ... → `error`。

#### 2.5.10 Models 的职责边界

`Models` 负责查找、认证、合并参数、选择实现、转发事件。它不负责：

- `AgentMessage → Message` 转换（`convertToLlm`）
- 工具执行（Agent 循环）
- 会话保存与恢复（harness）
- UI 渲染
- 替 provider 实现重试策略

这条边界让 Agent 只依赖 `StreamFn`，产品层可以替换 provider 而不影响循环。

### 2.6 模型目录的两种形态

模型目录有两种来源。

**静态目录**：provider 自带一份模型清单。例如 DeepSeek 的工厂直接返回 `DEEPSEEK_MODELS`。这份数据通常由脚本从上游文档生成，包含：

- `id`、`name`
- `api`、`baseUrl`
- `reasoning`、`input`
- `contextWindow`、`maxTokens`
- `cost`
- `compat`
- `thinkingLevelMap`

**动态目录**：provider 在运行时从远端拉取模型列表，例如聚合网关。动态 provider 需要三样东西：

1. 一个 `refreshModels()` 实现
2. 一个持久化位置 `ModelsStore`
3. 一个合并策略：静态基线 + 动态覆盖

原项目的合并规则是：

```text
currentModels = baselineModels
for model in dynamicModels:
    if model.id 已存在: 替换
    else: 追加
```

这样静态目录提供“保底”，动态刷新只增量覆盖。

动态刷新还涉及缓存与并发：

- `ModelsStore` 保存 `models`、`lastModified`、`checkedAt`、`etag`
- 刷新分两阶段：先恢复缓存（不联网），再在允许联网时拉取
- 同一 provider 的刷新用 generation + AbortController 防止旧结果覆盖新结果
- `publish()` 在写入持久化后，才同步更新内存状态

这些机制在 A 阶段只需理解目的：**让模型列表可更新，同时不破坏正在进行的请求**。

### 2.7 认证委托与可用性

`Provider.auth` 至少包含一种方式：

- `apiKey`：API key，可能来自存储、环境变量、配置文件或外部命令
- `oauth`：OAuth token，需要登录、刷新、派生请求头

原项目的认证解析遵循一条重要规则：

> 只要存在存储的凭据，就由它决定认证方式；只有完全没有存储凭据时，才回退到环境变量。

这样可以避免“用户已经登录，但某个环境变量又把请求带到另一个账号”的问题。

`Models` 提供三类与认证相关的能力：

| 方法 | 用途 |
| --- | --- |
| `getAuth()` | 解析一次请求所需的认证，返回 `apiKey`、`headers`、`baseUrl`、`env` 和来源标签 |
| `checkAuth()` | 只判断是否已配置，不刷新 OAuth |
| `getAvailable()` | 返回认证已配置的 provider 下的模型，并应用 `filterModels` |

`login()` / `logout()` 把登录流程委托给 provider 自己实现，注册表只负责调用和持久化。

原项目还支持 OAuth；新项目当前只保留 API key，OAuth 列为后置，具体范围见 `BUILD_PLAN.md` 决策表。

### 2.8 多 provider 共存的边界

多个 provider 共存时，有三条边界必须明确：

1. **provider id 唯一**。`Models` 用 id 作为 Map 的键，重复注册会替换旧 provider。
2. **model id 只在 provider 内唯一**。不同 provider 可以有同名模型，`getModel` 必须同时接收 provider 和 id。
3. **API 实现按 model.api 分发**。同一个 provider 可以支持多种 API；缺少对应实现时，返回一个 `error` 流，而不是抛异常。

原项目还提供 `hasApi(model, "openai-completions")` 这样的类型收窄工具，让调用方在拿到动态模型后，可以安全地使用对应 API 的完整选项类型。

此外，`Model` 上还有两类“provider 差异”配置：

- `headers`：模型级请求头
- `compat`：OpenAI 兼容端点的行为差异（是否支持 `developer` 角色、`reasoning_effort` 等）

它们放在模型数据里，而不是注册表里，因为差异是“这个模型/端点”的属性，不是集合的属性。

### 2.9 与整体系统的关系

注册表位于 LLM 层的最外层，向上提供 `StreamFn`：

```ts
type StreamFn = (
  model: Model,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;
```

`Agent` 只依赖这个函数签名，不知道 `Models` 的存在。产品层创建 `Models`，把 `models.streamSimple.bind(models)` 传给 Agent。这样：

- Agent 核心不依赖 provider 注册表
- 测试可以注入 faux provider
- 产品层可以切换模型而不影响 Agent

在完整系统中，注册表还支撑：

- CLI 的模型选择与登录
- TUI 的模型切换与用量显示
- 会话恢复时按 provider + model 找回模型
- 压缩摘要时选择更便宜的模型

### 2.10 小结

本课的核心结论：

1. `Model` 是数据，`Provider` 是行为，`Models` 是集合与请求入口。
2. provider 负责“用哪个 API、怎么认证、有哪些模型”；注册表负责“查找、解析认证、分发”。
3. 模型目录分为静态基线与动态覆盖，动态刷新需要持久化和并发保护。
4. 认证在注册表层解析，适配器只接收准备好的请求参数。
5. 上层只依赖 `StreamFn`，不依赖具体 provider，因此可以替换模型和测试实现。

---

## 3. 讨论与确认记录

> 尚无讨论。学习本课程时，问题、解释、讨论结论以及对 B 阶段的影响记录在此；已确认决策见 `BUILD_PLAN.md` 决策表。

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-06 | A 完成 | 用户确认读完 04 的 A 阶段 | 进入 B 讨论 |
| 2026-11-06 | B 确认 | 用户确认 04 的 B 阶段，范围按建议执行 | B 定稿，转入 BUILD_PLAN |
| 2026-11-06 | 决策 | 04 只做注册表、目录与 faux；真实工厂 05/06；动态刷新远端 19；lazyApi 改到 05 | 见 `BUILD_PLAN.md` 决策表 |
| 2026-11-06 | 实现 | T-04-1 至 T-04-6 完成；build、test、check 通过 | 待用户验收 |
| 2026-11-06 | 验收 | 用户验收 T-04-1 至 T-04-6 | 课程 04 完成 |

---

## 4. B：具体实现规划

### 4.1 原项目实现

| 文件 | 职责 | 关键位置 |
| --- | --- | --- |
| `packages/ai/src/models.ts` | `Provider`、`Models`、`ModelsImpl`、`createProvider`、`createModels`、成本与 thinking 辅助 | `Provider` 97、`Models` 156、`ModelsImpl` 259、`applyAuth` 641、`stream` 672、`streamSimple` 695、`createProvider` 775 |
| `packages/ai/src/models-store.ts` | 动态模型目录的持久化接口与内存实现 | `ModelsStoreEntry` 3、`ModelsStore` 21、`InMemoryModelsStore` 27 |
| `packages/ai/src/model-catalog.ts` | 把按 API 分组的 JSON 目录压平成 `model id → Model` | `flattenModelCatalog` 22 |
| `packages/ai/src/providers/all.ts` | 汇总内置 provider 与 `builtinModels()` | `builtinProviders` 73、`builtinModels` 107 |
| `packages/ai/src/providers/deepseek.ts` | 单个 provider 工厂的典型写法 | 全文 15 行 |
| `packages/ai/src/auth/types.ts` | `ProviderAuth`、`CredentialStore`、`AuthResult` 等认证契约 | `CredentialStore` 65、`ProviderAuth` 237 |
| `packages/ai/src/auth/helpers.ts` | 标准 API key 认证工厂 | `envApiKeyAuth` 9 |
| `packages/ai/src/auth/resolve.ts` | 存储凭据优先、环境变量回退、OAuth 刷新 | `resolveProviderAuth` 50 |

原项目的注册表有几个值得注意的实现细节：

1. `getModels()` 对抛异常的 provider 做兜底，返回空列表，避免一个坏 provider 破坏整个集合。
2. `refresh()` 使用 generation 计数和 AbortController，旧刷新不会覆盖新刷新。
3. `publish()` 串行化同一 provider 的持久化写入，避免并发写坏缓存。
4. `applyAuth()` 合并顺序是：请求显式值 > provider 解析结果 > 默认值；`transformHeaders` 最后执行。
5. `createProvider()` 同时支持“单一 API”和“按 model.api 分派”的映射；缺少实现时返回 `error` 流。

### 4.2 新项目实现建议

建议新增以下文件：

```text
packages/llm/src/
├── models.ts                 # Provider / Models / createProvider / createModels
├── models-store.ts           # ModelsStore 与内存实现
├── model-catalog.ts          # 目录压平
├── auth/
│   ├── types.ts              # ProviderAuth / Credential / CredentialStore / AuthResult
│   └── resolve.ts            # API key 解析
├── providers/
│   ├── faux.ts               # 测试用 provider
│   └── catalog/
│       ├── openai.ts         # 最小静态目录
│       ├── anthropic.ts
│       └── deepseek.ts
```

建议的接口：

```ts
interface Provider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly headers?: ProviderHeaders;
  readonly auth: ProviderAuth;
  getModels(): readonly Model[];
  refreshModels?(context: RefreshModelsContext): Promise<void>;
  filterModels?(models: readonly Model[], credential: Credential | undefined): readonly Model[];
  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  streamSimple(model: Model, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

interface Models {
  getProviders(): readonly Provider[];
  getProvider(id: string): Provider | undefined;
  getModels(provider?: string): readonly Model[];
  getModel(provider: string, id: string): Model | undefined;
  getAvailable(providerId?: string): Promise<readonly Model[]>;
  getAuth(providerId: string): Promise<AuthResult | undefined>;
  getAuth(model: Model): Promise<AuthResult | undefined>;
  stream(model: Model, context: Context, options?: StreamOptions): AssistantMessageEventStream;
  streamSimple(model: Model, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
  refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
}

function createModels(options?: CreateModelsOptions): MutableModels;
function createProvider(options: CreateProviderOptions): Provider;
```

认证类型按方案 A 收缩为 API key：

```ts
interface ProviderAuth {
  apiKey?: ApiKeyAuth;
}

type Credential = ApiKeyCredential;
```

OAuth 相关的 `OAuthCredential`、`OAuthAuth`、登录与刷新流程不进入当前实现。

建议的数据流：

```text
createProvider()
  → 保存 baselineModels
  → 提供 getModels()（baseline + dynamic overlay）
  → 提供 stream/streamSimple（按 model.api 分派）
  → 提供可选 refreshModels（恢复缓存 → 联网拉取 → publish）

ModelsImpl.streamSimple()
  → requireProvider(model)
  → applyAuth(model, options)
  → provider.streamSimple(requestModel, context, requestOptions)
```

建议的简化：

1. **真实 provider 工厂后置到 05/06**。本课只实现 `faux` provider 与三份静态目录；适配器尚未存在，工厂无法完成 `api` 绑定。
2. **认证只做 API key**。`ProviderAuth` 只保留 `apiKey`，`Credential` 只保留 `ApiKeyCredential`；OAuth 的类型、登录、刷新全部后置，不在当前代码中留空分支。
3. **动态刷新保留接口，网络实现可后置**。先实现 `ModelsStore` 与 `refreshModels` 的合并/持久化逻辑，用 faux 或静态数据测试；真实远端刷新到 19 再接入。
4. **模型目录只保留最小条目**。每个 provider 选 1–2 个模型，保留完整字段形状，不复现原项目的生成脚本与全量数据。
5. **成本与 thinking 辅助原样实现**。`calculateCost`、`getSupportedThinkingLevels`、`clampThinkingLevel` 是纯函数，测试成本低，后续用量与 UI 都会用到。

### 4.3 实现顺序

| 任务 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- |
| T-04-1 | `Provider`、`Models`、`MutableModels` 接口与内存注册表；`createModels()` | 03 | 注册、查找、删除 provider；未知 provider 返回空/报错符合约定 |
| T-04-2 | `createProvider()`：静态模型、动态覆盖、按 `model.api` 分派、缺失实现返回 error 流 | T-04-1 | 单一 API 与 API map 两种形态都能分发；faux provider 可流式返回 |
| T-04-3 | 认证契约与 API key 解析：`ProviderAuth`、`CredentialStore`、`resolveProviderAuth`、`applyAuth` | T-04-1 | 存储凭据优先；无凭据时回退环境变量；缺失认证产生 error 流 |
| T-04-4 | 模型目录：`flattenModelCatalog`、三份最小静态目录、`getModels`/`getModel`/`hasApi` | T-04-2 | provider 内查找正确；跨 provider 同名模型不冲突 |
| T-04-5 | 动态刷新与持久化：`ModelsStore`、`refreshModels` 合并、`refresh()` 并发保护 | T-04-2 | 缓存恢复、动态覆盖、旧刷新不覆盖新结果 |
| T-04-6 | 导出、测试与 changelog | T-04-1..5 | `build`、`test`、`tsc --noEmit`、`biome check .` 通过 |

### 4.4 测试

| 测试 | 验证 |
| --- | --- |
| 注册与查找 | `setProvider` 覆盖同 id；`getModel` 区分 provider；未知 provider 的行为 |
| 分发 | 单一 API provider；API map provider；缺少 API 实现时返回 error 流 |
| 认证 | 存储凭据优先；环境变量回退；无凭据时的错误信息 |
| 目录合并 | 静态基线 + 动态覆盖；同 id 替换；新 id 追加 |
| 刷新并发 | 连续两次刷新，旧结果不覆盖新结果；中止后不写入 |
| 持久化 | 写入、读取、删除；`etag`/`checkedAt` 保留 |
| 纯函数 | `calculateCost` 的阶梯计价与 1h 缓存；thinking level 收窄 |

> 本课相关决策见 `BUILD_PLAN.md` 决策表。

### 4.5 复现选项

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| 完整注册表 + 动态刷新 | 与原项目一致，包含远端目录、ETag、并发保护 | 推荐保留接口，远端实现后置 |
| 只做静态注册表 | 不支持动态模型 | 可选；会限制后续自定义 provider |
| 不做注册表，直接调适配器 | 最少代码 | 不推荐；上层会重新出现 provider 分支 |
| 认证与注册表分离 | 由调用方注入 auth | 不推荐；多 provider 时重复逻辑 |
