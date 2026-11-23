# 11 工具执行语义

> 课程状态：验收通过
> 覆盖模块：`@pipi/llm` 的工具参数校验，以及 `@pipi/agent` 执行工具时的准备流程
> 课程文件：11-tool-execution.md
> 本课产出：模型给出的工具参数先经过校验与强制转换，再交给工具执行。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| 参数校验 | 检查模型给的参数是否符合工具声明的 schema。 |
| 强制转换 coercion | 类型不匹配但可安全转换时自动修正，例如 `"3"` → `3`。 |
| `TSchema` | TypeBox 的 schema 类型，`Tool.parameters` 使用它。 |
| 参数预处理函数 | 工具提供的 `prepareArguments`，在校验前把模型给的参数修成 schema 要求的形状。 |
| 可选字段 | schema 中不在 `required` 列表里的属性。 |
| 工具结果 | `ToolResultMessage`，失败时 `isError: true`。 |

---

## 1. 构建目标

课程 09 已经实现工具批次、串行/并行、钩子和结果回填，但参数是直接透传的：

```ts
const args = tool.prepareArguments ? tool.prepareArguments(toolCall.arguments) : toolCall.arguments;
```

本课补上中间一步：

```text
模型参数 → prepareArguments → 校验与转换 → beforeToolCall → execute
```

目标：

1. 参数不符合 schema 时给出可读错误，不执行工具
2. 类型可安全转换时自动转换，减少模型的小错误导致失败
3. 校验失败以工具错误结果回填，让模型自行修正
4. 工具不存在时也有明确错误

---

## 2. A：概念与功能讲解

### 2.1 主线

**模型输出的是“看起来像参数”的文本，不是可信数据。**

模型按 schema 生成 JSON，但可能出现：

```text
类型错误       {"limit": "10"}        应为 number
缺少必填字段   {"path": "a.ts"}        少了 line
多余的 null    {"timeout": null}      可选字段写成了 null
嵌套结构错误   {"options": {"deep": "x"}}
```

直接执行会把这些错误带进工具内部，产生难以定位的故障。所以执行前必须校验。

### 2.2 校验在链路中的位置

`agent-loop.ts` 的 `prepareToolCall` 目前是这样：

```ts
const args = tool.prepareArguments ? tool.prepareArguments(toolCall.arguments) : toolCall.arguments;
if (config.beforeToolCall) {
	const before = await config.beforeToolCall({ assistantMessage, toolCall, args, context }, signal);
	...
}
```

接入校验后：

```text
1. prepareArguments   工具自定义的参数预处理函数
2. validateToolArguments   按 schema 校验并转换
3. beforeToolCall     钩子可以拦截
4. tool.execute       拿到可信参数
```

顺序不能反：

| 顺序 | 原因 |
|---|---|
| `prepareArguments` 在前 | 它负责把模型的历史习惯参数改成当前 schema 形状 |
| 校验在钩子前 | `beforeToolCall` 应该看到已经合法的参数 |
| 钩子在执行前 | 拦截发生在副作用之前 |

任一步失败都生成 `isError: true` 的工具结果，不执行工具本体。

### 2.3 三步校验

原项目的 `validateToolArguments`（`ai/src/utils/validation.ts:311`）：

```ts
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	const args = structuredClone(toolCall.arguments);
	normalizeOptionalNulls(args, tool.parameters as JsonSchemaObject);
	Value.Convert(tool.parameters, args);

	const validator = getValidator(tool.parameters);
	// 非 TypeBox schema 追加自定义转换
	...

	if (validator.Check(args)) return args;

	const errors = validator.Errors(args).map(...).join("\n");
	throw new Error(`Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n...`);
}
```

三步各管一件事：

| 步骤 | 作用 |
|---|---|
| `structuredClone` | 不改模型消息里的原始参数 |
| `normalizeOptionalNulls` | 删掉可选字段上的 `null`，等价于“没提供” |
| `Value.Convert` | TypeBox 的类型转换，例如字符串数字转 number |
| `Compile` + `Check` | 编译 schema 并校验，validator 有缓存 |

**为什么先删 null**

模型经常把可选字段写成 `null`。对 JSON schema 来说 `null` 是非法值，但语义上用户就是想省略。删掉比报错更符合意图。

**为什么要 `structuredClone`**

参数对象同时存在于助手消息的 `toolCall.arguments` 里。校验会就地删除、转换字段，不拷贝就会污染历史。

### 2.4 普通 JSON Schema 的处理

`Value.Convert` 只对带 TypeBox kind 标记的 schema 生效，普通 JSON Schema 会被它原样放过。原项目的应对方式是在 `validateToolArguments` 里补一层手写转换：

```ts
if (!Object.getOwnPropertySymbols(tool.parameters).includes(TYPEBOX_KIND)) {
	const coerced = coerceWithJsonSchema(args, tool.parameters as JsonSchemaObject);
	...
}
```

`coerceWithJsonSchema` 递归处理：

| 结构 | 处理 |
|---|---|
| `object` | 按 `properties` 转换每个字段；`additionalProperties` 也处理 |
| `array` | 按 `items` 转换每个元素，支持元组形式 |
| `allOf` | 依次应用 |
| `anyOf` / `oneOf` | 先找已匹配的分支，否则逐个尝试转换后再校验 |
| 基本类型 | `number`、`integer`、`boolean`、`string`、`null` 的宽松转换 |

这层判断在 TypeBox 1.3.7 下已经失效：1.x 的 kind 标记是非枚举字符串属性 `~kind`，`Object.getOwnPropertySymbols` 永远拿不到 `Symbol.for("TypeBox.Kind")`。原项目当时的实际行为是**所有 schema 都跑一遍手写转换**，TypeBox schema 也不例外。上游后来把这层整体删掉，改成独立包 `@earendil-works/pi-schema`，校验和 coercion 都由该包承担。

本项目只支持 TypeBox schema，不实现这层手写转换（见 D-053）。

### 2.5 校验失败如何呈现

校验失败抛出 `Error`，消息包含路径与收到的参数：

```text
Validation failed for tool "read":
  - line: Expected number
  - options.deep: Expected boolean

Received arguments:
{
  "path": "a.ts",
  "line": "ten"
}
```

循环捕获后转成：

```ts
{
	role: "toolResult",
	toolName: "read",
	isError: true,
	content: [{ type: "text", text: "Validation failed ..." }]
}
```

模型看到的是工具结果，而不是异常，所以它可以自己修正参数重试。

### 2.6 工具不存在

`validateToolCall` 是先按名字找工具再校验：

```ts
const tool = tools.find((t) => t.name === toolCall.name);
if (!tool) throw new Error(`Tool "${toolCall.name}" not found`);
return validateToolArguments(tool, toolCall);
```

循环里也有同样的检查，两者作用不同：

| 位置 | 场景 |
|---|---|
| 循环的 `prepareToolCall` | 运行时只传了部分工具，模型调用了不可用的 |
| `validateToolCall` | 调用方手里有一组工具，想按名字校验 |

### 2.7 与钩子、结果回填的关系

```text
prepareArguments
  → 校验
    → beforeToolCall（可 block）
      → execute
        → afterToolCall（可覆盖）
          → ToolResultMessage
```

- 校验失败：不进入 `beforeToolCall`，直接产生错误结果
- `beforeToolCall` 拦截：参数已经合法
- `afterToolCall`：拿到的是执行结果，与校验无关

### 2.8 与整体系统的关系

```text
@pipi/llm
  utils/validation.ts   validateToolArguments、validateToolCall
        ↑
@pipi/agent
  agent-loop.ts         在 prepareToolCall 里调用
        ↑
工具实现（课程 12）
  声明 parameters，实现 execute
```

校验放在 llm 包，因为 `Tool` 与 `TSchema` 都在那里，agent 只负责调用时机。

### 2.9 小结

| 结论 | 说明 |
| --- | --- |
| 参数默认不可信 | 模型可能给错类型、缺字段、多 null |
| 校验在 prepare 之后、钩子之前 | 钩子看到的是合法参数 |
| 三步处理 | 删可选 null、类型转换、schema 校验 |
| 校验不改历史 | `structuredClone` 后再处理 |
| 失败变成工具结果 | 模型可以自行修正重试 |
| 普通 JSON schema 需要单独处理 | 上游改用独立校验包，本项目不跟随（D-053） |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-23 | 范围 | 开始课程 11 | A 先讲校验语义与接入位置 |
| 2026-11-23 | 核查上游 | 上游 2026-11-01（`6536f80`）改用独立包 `@earendil-works/pi-schema`，`validation.ts` 从 350 行降到 69 行；TypeBox 的 symbol 判断在 1.3.7 下本就恒为 false | 决策一取 A：只做 TypeBox 路径（D-053），2.4 补上游现状 |
| 2026-11-23 | 确认 | 三项决策落定：只走 TypeBox；错误信息包含原始参数；validator 用 `WeakMap` 按 schema 对象缓存 | 4.2、4.5 改为已确认结论 |
| 2026-11-23 | 实现 | 导出提前到 T-11-2，供 T-11-3 跨包调用；`validateToolCall` 照原项目实现 | 4.3 任务边界微调 |
| 2026-11-23 | 验收 | 用户验收 T-11-1 至 T-11-4 | 课程 11 完成 |

---

## 4. B：具体实现规划

> B 已实现并验收（2026-11-23）。决策见 `BUILD_PLAN.md` D-053；任务 T-11-1 至 T-11-4。

实现位置：`packages/llm/src/utils/validation.ts`（校验与缓存）、`packages/llm/src/index.ts`（公共导出）、`packages/agent/src/agent-loop.ts`（`prepareToolCall` 接入）。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `ai/src/utils/validation.ts` | 350 | `validateToolArguments`、`validateToolCall`、可选 null 清理、TypeBox 转换、普通 JSON schema 转换、错误格式化 |
| 上游 `ai/src/utils/validation.ts` | 69 | 改用 `@earendil-works/pi-schema` 的 `compile(schema, { coerce: true })`，校验与转换由该包承担 |

### 4.2 新项目实现建议

| 模块 | 内容 | 建议 |
| --- | --- | --- |
| `validateToolArguments` | clone、清理 null、`Value.Convert`、`Compile` 校验、错误信息 | 原样实现 |
| `validateToolCall` | 按名字找工具后校验 | 原样实现 |
| validator 缓存 | `WeakMap` 按 schema 缓存 `Compile` 结果 | 原样实现 |
| 普通 JSON schema 转换 | 手写递归 coercion | 不实现（D-053） |
| 接入循环 | `prepareToolCall` 在 `prepareArguments` 后调用 | 原样实现 |

### 4.3 建议任务拆分

| 任务 | 范围 |
| --- | --- |
| T-11-1 | `validateToolArguments`：clone、可选 null 清理、TypeBox 转换与校验、错误格式化 |
| T-11-2 | `validateToolCall` 与 validator 缓存 |
| T-11-3 | 接入 `agent-loop` 的 `prepareToolCall`，失败转工具错误结果 |
| T-11-4 | 导出、测试与 changelog |

### 4.4 复现选项

已确认选 A：只实现 TypeBox 校验路径，普通 JSON schema 转换后置（D-053）。

| 选项 | 范围 |
| --- | --- |
| A（已确认） | 完整实现 TypeBox 校验路径，普通 JSON schema 转换后置 |
| B（不采用） | 完整复现，包括普通 JSON schema 的递归 coercion |
| C（不采用） | 只做 `Value.Convert` + `Check`，不做可选 null 清理 |

### 4.5 已确认结论

已写入 `BUILD_PLAN.md` 决策表，此处只列结论。

| 事项 | 结论 |
| --- | --- |
| 普通 JSON schema 的 coercion | 本课不实现，只支持 TypeBox（D-053） |
| 校验失败信息是否包含原始参数 | 包含，`Received arguments` 回显 `toolCall.arguments` 的完整 JSON |
| validator 缓存键 | schema 对象，模块级 `WeakMap`，编译成功后写入 |
