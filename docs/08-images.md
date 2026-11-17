# 08 图像输入与图像生成

> 课程状态：A 学习中
> 覆盖模块：`@pipi/llm` 的多模态输入契约与图像生成能力
> 课程文件：08-images.md
> 本课产出：图像能进入对话上下文；图像生成有独立的模型类型、独立的 provider 与统一返回。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| 多模态 multimodal | 一次请求里同时包含文本与图像等不同形态的内容。 |
| `ImageContent` | 统一的图像内容块，携带 base64 数据与 MIME 类型。 |
| base64 | 把二进制数据编码成 ASCII 字符串的方式，便于放进 JSON。 |
| data URL | `data:<mime>;base64,<数据>` 形式的自包含 URL，不指向外部地址。 |
| 视觉模型 vision model | 能读取图像输入的模型，例如 GPT-4o、Claude 的视觉版本。 |
| 图像生成 image generation | 由文本提示（可带参考图）生成新图像的能力。 |
| 参考图 reference image | 生成请求里作为条件输入的图像，例如图生图、风格参考。 |
| `modalities` | 请求希望模型返回的内容形态，例如只要图像，或图像加文本。 |
| OpenRouter | 一个聚合多家模型的网关服务，本课中也是原项目唯一的图像生成 provider。 |
| 惰性加载 lazy loading | 首次使用时才 `import` 实现模块，避免启动时加载全部适配器。 |

---

## 1. 构建目标

图像在编码 Agent 里有两个完全相反的方向：

```text
方向一：图像 → 模型      用户贴图、工具返回截图、设计稿
方向二：模型 → 图像      根据描述生成图片
```

方向一属于“输入”，它改变的是消息内容；方向二属于“生成”，它改变的是系统能提供的能力种类。两者的数据流、模型目录、返回结构都不同，因此本课把它们放在一起讲，但分别设计。

具体目标：

1. 图像可以作为用户消息与工具结果的一部分进入上下文
2. 模型是否支持图像输入是可查询的能力，不支持时要有确定的降级行为
3. 图像生成有独立的模型类型、独立的 provider 集合与独立的返回类型
4. 生成失败不破坏调用方控制流，错误与中止有明确表达
5. 图像的成本与 token 估算有统一口径

不在本课范围：

- 剪贴板贴图、终端内图像渲染（D-014 后置到课程 24）
- 图像压缩、缩放、格式转换（课程 24）
- 模型选择界面与 TUI 展示（课程 24）
- 把生成能力包装成 Agent 工具（依赖课程 09、12）

---

## 2. A：概念与功能讲解

### 2.1 本课主线

本课围绕一条主线展开：

```text
图像是一种内容，不是一种消息
```

文本、图像、思考、工具调用都是“内容块”（content block）。一条消息是若干内容块的有序组合，而不是“一条文本消息”或“一条图片消息”。

沿着这条主线，本课回答四个问题：

| 问题 | 对应小节 |
| --- | --- |
| 图像如何放进消息？ | 2.2 |
| 模型能不能读图？ | 2.3、2.4 |
| 图像占多少上下文？ | 2.5 |
| 模型如何生成图像？ | 2.6–2.9 |

### 2.2 图像如何进入数据契约

课程 02 已经定义了图像内容块：

```ts
export interface ImageContent {
	type: "image";
	data: string; // base64 编码的图像数据
	mimeType: string; // 例如 "image/jpeg"、"image/png"
}
```

它出现在两个位置：

```ts
interface UserMessage {
	content: string | (TextContent | ImageContent)[];
}

interface ToolResultMessage {
	content: (TextContent | ImageContent)[];
}
```

**为什么用 base64 而不是 URL**

| 方案 | 问题 |
| --- | --- |
| 传远程 URL | provider 需要二次抓取，可能失败、可能被墙、可能过期 |
| 传本地路径 | 模型侧看不到本地文件系统，路径没有意义 |
| 传 base64 | 自包含、可离线、可持久化到会话文件 |

代价是体积变大：base64 会让二进制膨胀约三分之一，并且图像会直接进入会话历史。后续课程处理会话持久化时，必须考虑这个体积。

**为什么消息内容是数组**

一段用户输入可能同时包含说明文字和多张图：

```text
"这个报错怎么修？" + 截图1 + 截图2
```

数组保留了顺序，也允许未来加入其他块类型。字符串形式只是单段文本的简写，在进入请求前会被规范化成块数组。

**为什么工具结果也允许图像**

工具可以产出图像：截图、图表、渲染结果。工具结果与用户消息共享同一种内容块，模型看到的就是同一种东西，不需要为“工具产生的图”单独设计类型。

### 2.3 能力协商：模型能不能读图

图像不是所有模型都能处理。统一类型里用一个字段表达能力：

```ts
interface Model<TApi> {
	input: ("text" | "image")[];
}
```

这是一个能力声明，不是请求参数。它来自模型目录，随模型条目一起提供。

使用方在发请求前检查：

```ts
if (model.input.includes("image")) {
	// 可以发图像
}
```

**不支持图像时怎么办**

有三种可能的设计：

| 设计 | 结果 |
| --- | --- |
| 直接报错 | 用户贴图后整个请求失败，体验差 |
| 静默丢弃 | 模型看不到图，回答会莫名其妙 |
| 替换成占位文本 | 请求继续，模型知道“这里本来有图” |

原项目选择第三种。占位文本是明确的：

```text
(image omitted: model does not support images)
(tool image omitted: model does not support images)
```

这带来一个重要的语义：**图像内容始终留在上下文里，只在编码请求的那一刻被降级**。会话历史不因为切换模型而丢失图像；换回视觉模型后，图像又能被发送。

相邻的多张图只产生一个占位符，避免连续重复文本浪费 token。

### 2.4 图像输入如何映射到请求

以 OpenAI Chat Completions 为例，一段带图用户消息被编码为：

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "这个报错怎么修？" },
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBOR..." } }
  ]
}
```

要点：

- `image_url` 是 OpenAI 兼容 API 的字段名，值可以是远程 URL，也可以是 data URL
- 这里只使用 data URL，因为数据本来就以 base64 存在本地
- 文本仍然走 `type: "text"`，顺序与消息里的块顺序一致

工具结果的处理更绕一层。Chat Completions 的 `tool` 消息内容只能是字符串，不能是内容块数组。因此工具结果里的图像不能直接放在原消息里，而是被拆成两部分：

```text
1. tool 消息：文本结果（若只有图，则写 "(see attached image)"）
2. user 消息：一段 "Attached image(s) from tool result:" + 若干 image_url
```

这样模型先看到工具执行结果，再看到随附图像，语义接近“工具把截图交给了你”。

### 2.5 图像占多少上下文

文本可以按字符数估算 token，图像不行：base64 长度取决于压缩率，与模型实际消耗的 token 没有稳定关系。

原项目采用固定代价估算：

```text
1 张图 ≈ 4800 字符 ≈ 1200 token
```

这个数字不精确，但满足两个用途：

1. 判断上下文是否接近上限
2. 在压缩时决定哪些消息需要处理

**为什么不按 base64 长度算**

同一张 1000×1000 的图，存成 PNG 可能是 2 MB，存成 JPEG 可能只有 200 KB。按字符数算会得到差十倍的估算，导致压缩时机完全失真。

**为什么可以接受不精确**

估算只用于“是否该压缩”的判断。真正准确的用量来自 provider 返回的 `usage`。估算偏大只会让压缩提前发生，偏小则可能触发一次失败请求，因此宁可略偏大。

### 2.6 图像生成为什么需要独立类型

图像生成看起来也能塞进聊天接口：发一段文本，返回一张图。但两者的契约差异很大。

| 维度 | 聊天 | 图像生成 |
| --- | --- | --- |
| 返回方式 | 流式事件 | 一次性结果 |
| 单次输入 | 完整消息历史 | 一段提示与可选参考图 |
| 输出内容 | 文本、思考、工具调用 | 文本、图像 |
| 停止原因 | `stop`、`length`、`toolUse`、`error`、`aborted` | `stop`、`error`、`aborted` |
| 模型能力字段 | `input`、`reasoning`、`contextWindow`、`maxTokens` | `input`、`output` |
| 工具调用 | 支持 | 不支持 |

如果强行复用聊天类型，会出现大量“这个字段在这里没意义”的情况：图像模型没有上下文窗口、没有思考等级、不会调用工具，也不会流式返回。

因此原项目建立了并列的第二套类型：

```ts
interface ImagesModel<TApi> {
	id: string;
	name: string;
	api: TApi;
	provider: ImagesProviderId;
	baseUrl: string;
	input: ("text" | "image")[];
	output: ("text" | "image")[];
	cost: ModelCost;
	headers?: Record<string, string>;
}

interface ImagesContext {
	input: (TextContent | ImageContent)[];
}

interface AssistantImages {
	api: ImagesApi;
	provider: ImagesProviderId;
	model: string;
	output: (TextContent | ImageContent)[];
	responseId?: string;
	usage?: Usage;
	stopReason: "stop" | "error" | "aborted";
	errorMessage?: string;
	timestamp: number;
}
```

三个设计细节值得注意。

**第一，`input` 与 `output` 分开**

`input` 描述模型接受什么，`output` 描述模型能产出什么。文生图模型是 `input: ["text"]`、`output: ["image"]`；图生图模型是 `input: ["text", "image"]`、`output: ["image"]`；也有模型两者都能产出。

**第二，`ImagesContext` 没有消息历史**

生成是一次性的：一段提示、若干参考图，结束。没有多轮，没有 `role`，没有 `timestamp`。这是刻意的简化，因为图像生成 API 普遍是无状态的。

**第三，`AssistantImages` 不是 `AssistantMessage`**

它不参与对话历史，也不需要 `ThinkingContent` 和 `ToolCall`。它的 `stopReason` 只有三种取值，因为生成不存在“长度截断”和“工具调用”这两种结束方式。

### 2.7 生成侧的调用契约

生成入口有三个层次：

```text
generateImages(model, context, options)      顶层函数，按 model.api 分发
  → ImagesModels.generateImages(...)         集合方法，解析认证并合并选项
    → provider.generateImages(...)           provider 持有的实现
      → api 模块的 generateImages(...)       具体协议适配
```

**顶层函数与集合方法的区别**

顶层 `generateImages` 只做一件事：根据 `model.api` 找到已注册的 API 实现并调用。它不解析认证，不知道 credential 存在哪。

集合方法 `ImagesModels.generateImages` 负责产品级编排：

```text
查找 provider
  → 解析认证（与聊天共用 CredentialStore）
  → 合并 baseUrl、headers、env
  → 调用 provider
  → 捕获所有错误，转成 AssistantImages
```

**为什么集合方法永不 reject**

约定是：**生成失败也返回一个结果对象**。

```ts
{
  stopReason: "error",
  errorMessage: "...",
  output: [],
}
```

好处是调用方只有一种处理路径：检查 `stopReason`。坏处是真正的编程错误（例如 provider 未注册）也会被包装，调试时需要看 `errorMessage`。

这与聊天侧的约定不同。聊天侧返回的是事件流，流内部用 `error` 事件表达失败；生成侧没有流，只能用返回值表达。

**中止的处理**

`options.signal` 被传入请求；发生中止时：

```ts
output.stopReason = signal.aborted ? "aborted" : "error";
```

中止不是错误，调用方通常需要区别对待：中止是用户主动停止，不该弹出错误提示。

### 2.8 一次生成请求的形态

原项目只实现了一个图像 API 家族：`openrouter-images`。它的请求仍然走 OpenAI 兼容的 Chat Completions 接口，靠 `modalities` 字段声明要图像：

```json
{
  "model": "black-forest-labs/flux.2-pro",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "一只在雨中的猫" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
      ]
    }
  ],
  "stream": false,
  "modalities": ["image", "text"]
}
```

几个要点：

| 点 | 说明 |
| --- | --- |
| `stream: false` | 生成不走流式，直接等完整响应 |
| `modalities` | 根据 `model.output` 决定是否同时要文本 |
| 参考图 | 与用户消息的图像块编码方式相同 |
| 重试 | 与聊天共用 provider 重试逻辑，但先关闭 SDK 自带重试，避免双重重试 |

响应里的图像是 data URL：

```json
{
  "choices": [
    {
      "message": {
        "content": "这是生成的图片。",
        "images": [
          { "image_url": "data:image/png;base64,iVBOR..." }
        ]
      }
    }
  ]
}
```

适配器只接受 `data:` 开头的值，并用正则拆出 MIME 类型与 base64 数据。远程 URL 会被忽略，因为下游需要的是可直接保存、可直接回填到消息里的自包含数据。

**成本如何计算**

图像模型的 `cost` 仍然是每百万 token 的输入输出价格，`usage` 来自响应的 `prompt_tokens` / `completion_tokens`。按 token 计费，而不是按张数。

这一点与直觉不同：很多图像 API 按张收费，但 OpenRouter 的这条通道把它折算成 token。因此 `ModelCost` 里没有“每张图多少钱”的字段，只有 token 单价。

### 2.9 三套注册结构

图像能力有三层注册关系，与聊天侧一一对应：

```text
api 名 → 实现函数        images-api-registry.ts
provider → 模型 + 认证   images-models.ts 的 ImagesProvider
顶层入口                 images.ts
```

**api 注册表**

```ts
registerImagesApiProvider({
	api: "openrouter-images",
	generateImages: generateImagesOpenRouter,
});
```

注册时校验 `model.api` 与注册的 api 是否一致，避免调用方把 A 家族的模型传给 B 家族的实现。

**provider 集合**

`ImagesProvider` 与聊天的 `Provider` 结构相似：id、name、auth、模型列表、生成函数。差异在于模型列表是同步读取的 `getModels()`，而不是构造时传入的数组。这样动态 provider 可以在刷新后替换列表。

`ImagesModels` 提供 `getProviders`、`getModels`、`getModel`、`refresh`、`getAuth`、`generateImages`，与 `Models` 保持对称。

**惰性加载**

与聊天适配器一样，图像适配器不在启动时加载。`providers/images/register-builtins.ts` 在注册时使用一个包装函数，首次调用才 `import` 真正的实现。

如果动态 import 失败，包装函数把它转成：

```ts
{
  stopReason: "error",
  errorMessage: "...",
  output: [],
}
```

而不是抛出异常。这与“生成失败返回结果”的约定一致。

### 2.10 生成能力在系统中的位置

一个容易忽略的事实：原项目的图像生成能力没有接入编码 Agent 的主循环。

它没有对应的内置工具，也没有在交互界面里提供入口。`generateImages` 只作为 SDK 能力存在，供上层应用或扩展调用。

这带来一个范围判断：

| 选择 | 影响 |
| --- | --- |
| 只做库能力 | 与当前课程依赖一致，范围清晰 |
| 同时做内置工具 | 需要工具执行语义（课程 11）与结果回填（课程 12、13） |
| 同时做 TUI 展示 | 需要终端图像渲染（课程 24） |

本课建议先完成库能力，把“如何使用生成结果”留给后续课程。

### 2.11 与整体系统的关系

```text
@pipi/llm
  ├─ types.ts
  │    ├─ ImageContent             输入与输出的共同内容块
  │    ├─ ImagesModel              生成模型
  │    ├─ ImagesContext            单轮生成输入
  │    └─ AssistantImages          生成结果
  ├─ images-api-registry.ts        api 名 → 生成实现
  ├─ images-models.ts              provider 集合 + 认证 + 编排
  ├─ images.ts                     顶层分发函数
  ├─ image-models.ts               图像模型目录查询
  ├─ api/openrouter-images.ts      OpenAI 兼容生成适配器
  └─ providers/images/*            内置 provider 与惰性注册
```

它与已有模块的关系：

| 模块 | 关系 |
| --- | --- |
| 课程 02 类型 | 复用 `TextContent`、`ImageContent`、`Usage`、`ModelCost` |
| 课程 03 事件流 | 无关：生成不流式 |
| 课程 04 注册表 | 结构对称，但独立注册表、独立集合 |
| 课程 05 适配器 | 复用图像编码方式、重试、错误归一化 |
| 课程 07 认证 | 共用 `CredentialStore`、`AuthResult`、解析顺序 |

关键结论：图像生成不是“聊天的一个模式”，而是一个并列的能力子系统。它复用基础设施，但不复用控制流。

### 2.12 小结

| 结论 | 说明 |
| --- | --- |
| 图像是内容块 | 与文本同级，出现在用户消息与工具结果里 |
| 能力来自模型条目 | `input` 声明能否读图，不支持时降级为占位文本 |
| 降级发生在编码时 | 会话历史保留原图，切换模型不丢数据 |
| 估算用固定代价 | 一张图约 1200 token，只用于压缩判断 |
| 生成是独立子系统 | 独立模型类型、独立注册表、独立集合 |
| 生成不流式 | 一次性结果对象，`stopReason` 只有三种 |
| 失败不抛异常 | 集合方法返回 `AssistantImages`，用 `stopReason` 表达结果 |
| 生成未接入主循环 | 当前只是库能力，工具化后置 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-14 | 范围 | 用户要求开始课程 08；课程 07 的 T-07-3、T-07-4 尚未验收 | 先进行 08 的 A 阶段；07 的验收状态另行确认 |
| 2026-11-14 | 决策提醒 | D-013（图像生成后置到课程 08）触发条件已到期；D-019（OAuth 后置，课程 07 复审）仍未处理 | 待用户决定是否转为生效 |

---

## 4. B：具体实现规划

> B 尚未展开。以下只记录原项目结构、可选范围与待确认事项，不作为已批准方案。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `ai/src/images.ts` | 21 | 顶层 `generateImages`，按 api 分发 |
| `ai/src/images-api-registry.ts` | 53 | api 名到生成实现的注册表与 api 匹配校验 |
| `ai/src/images-models.ts` | 275 | `ImagesProvider`、`ImagesModels`、`createImagesProvider`、认证编排 |
| `ai/src/image-models.ts` | 42 | 图像模型目录查询：按 provider 取模型 |
| `ai/src/api/openrouter-images.ts` | 196 | OpenRouter 图像生成适配器 |
| `ai/src/api/openrouter-images.lazy.ts` | 10 | 惰性包装 |
| `ai/src/providers/images/register-builtins.ts` | 50 | 内置图像 api 注册与加载失败包装 |
| `ai/src/providers/openrouter-images.ts` | 22 | OpenRouter 图像 provider 工厂 |
| `ai/src/image-models.generated.ts` | — | 57 个图像模型条目，全部属于 `openrouter` |

测试文件：

| 文件 | 用例数 | 覆盖 |
| --- | ---: | --- |
| `test/images-models.test.ts` | 6 | 集合、认证合并、动态刷新、内置注册 |
| `test/openrouter-images.test.ts` | 3 | 请求参数、响应解析、中止 |
| `test/images.test.ts` | 3 | 真实 provider 冒烟（需要 key） |
| `test/image-tool-result.test.ts` | 26 | 图像输入、工具结果图像、能力降级 |

### 4.2 新项目实现建议

以下为建议方案，均未确认。

**方案 A：只做生成库能力（建议）**

| 项 | 内容 |
| --- | --- |
| 范围 | 类型、api 注册表、`ImagesModels`、一个 OpenAI 兼容生成适配器、测试 |
| provider | OpenRouter（与原项目一致）或 faux 测试 provider |
| 不包含 | 内置工具、TUI、剪贴板、图像压缩 |
| 理由 | 与课程依赖一致；生成能力可以独立验证，不被上层阻塞 |
| 后果 | 用户暂时无法在编码 Agent 内直接生成图片 |

**方案 B：生成 + 内置工具**

在方案 A 基础上增加一个图像生成工具，注册进 Agent 的工具集合。

| 后果 |
| --- |
| 需要课程 09、11、12 的工具执行语义先完成，08 无法独立验收 |
| 工具结果需要能承载图像，课程 13 的输出治理也要考虑 |

**方案 C：08 只做输入侧收尾，生成整体后置**

输入侧在课程 05 已基本实现。若选择此方案，本课只剩补测试与文档。

| 后果 |
| --- |
| 与 D-013（图像生成在课程 08）冲突，需要改写决策 |
| 图像生成能力推迟到课程 25 或直接舍弃 |

**provider 范围的冲突**

D-018 限定 provider 为 OpenAI、Anthropic、DeepSeek 系列。原项目的图像生成只有 OpenRouter，二者不一致。可选处理：

| 选项 | 说明 |
| --- | --- |
| 允许 OpenRouter 作为图像 provider 例外 | 与上游实现一致，成本最低 |
| 改用 OpenAI 图像接口 | 需要新增一个 `openai-images` 家族，与原项目不同 |
| 只做 faux 图像 provider | 只验证架构，不接真实服务 |

**模型目录规模**

D-022 规定每个 provider 先保留 1–2 个模型。图像目录可按同样口径只保留 1–2 条。

### 4.3 复现选项汇总

| 选项 | 输入侧 | 生成侧 | 上层接入 |
| --- | --- | --- | --- |
| A | 保持现状 | 完整库能力 | 无 |
| B | 保持现状 | 完整库能力 | 内置工具 |
| C | 补测试 | 不实现 | 无 |

### 4.4 待确认决策

| 事项 | 选项 |
| --- | --- |
| D-013 是否转为生效 | 是：08 实现生成；否：改写决策并后置 |
| 图像 provider 范围 | OpenRouter 例外 / OpenAI 新家族 / 仅 faux |
| 是否接入 Agent 工具 | 后置到 09–12 / 本课实现 |
| 模型目录规模 | 1–2 条 / 全量 |
| 是否支持参考图输入 | 支持 / 仅文生图 |
| 成本口径 | 按 token（与原项目一致） / 增加按张计价字段 |
