# 10 Agent 状态机与消息队列

> 课程状态：验收通过
> 覆盖模块：`@pipi/agent` 的 `Agent` 状态机、消息队列与代理 stream
> 课程文件：10-agent-state.md
> 本课产出：无状态的循环被包装成有状态、可订阅、可中止、可排队的 Agent。

---

## 0. 阅读前

| 术语 | 含义 |
| --- | --- |
| 状态机 | 用一组字段描述“现在在干什么”，并由事件驱动字段变化。 |
| activeRun | 一次正在进行的运行，包含结束承诺与中止控制器。 |
| idle | 没有运行、也没有排队消息的静止状态。 |
| steering | 运行中插队的消息，当前轮结束后注入。 |
| followUp | Agent 本该停止时才消费的追加消息。 |
| `QueueMode` | 队列排空策略：一次全部或一次一条。 |
| 快照 | 传给循环的上下文副本，循环修改不影响 `Agent` 自身状态。 |

---

## 1. 构建目标

课程 09 的 `runAgentLoop` 是一次性函数：传入消息，跑完返回新增消息，不保存任何东西。

真实产品需要：

```text
维护对话历史
拒绝并发运行
运行中可插话
运行结束可订阅
可中止、可等待空闲
```

这些都由 `Agent` 负责。

---

## 2. A：概念与功能讲解

### 2.1 主线

```text
Agent = 状态 + 单次运行的生命周期 + 两个队列
```

循环仍然只做“调模型、跑工具”，`Agent` 负责它周围的调度与记账。

### 2.2 状态结构

`AgentState`（`agent/src/types.ts:327`）：

```ts
export interface AgentState {
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	set tools(tools: AgentTool<any>[]);
	get tools(): AgentTool<any>[];
	set messages(messages: AgentMessage[]);
	get messages(): AgentMessage[];
	readonly isRunning: boolean;
	readonly streamingMessage?: AgentMessage;
	readonly pendingToolCalls: ReadonlySet<string>;
	readonly errorMessage?: string;
}
```

九个字段分三类：

| 类别 | 字段 | 谁写 |
| --- | --- | --- |
| 配置 | `systemPrompt`、`model`、`thinkingLevel`、`tools` | 调用方 |
| 对话 | `messages` | `Agent` 在 `message_end` 时追加 |
| 运行态 | `isRunning`、`streamingMessage`、`pendingToolCalls`、`errorMessage` | `Agent` 内部维护 |

`tools` / `messages` 用访问器，赋值时 `slice()` 拷贝顶层数组（`agent.ts:68`），避免调用方持有同一个数组后被内部修改。

### 2.3 单次运行的生命周期

入口是 `runAgent`（原项目叫 `runPromptMessages`，对应 `agent.ts:436`）：

```ts
const abortController = new AbortController();
let resolvePromise = () => {};
const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
this.activeRun = { promise, resolve: resolvePromise, abortController };

this._state.isRunning = true;
this._state.streamingMessage = undefined;
this._state.errorMessage = undefined;

try {
	await runAgentLoop(messages, snapshot, config, emit, abortController.signal, this.streamFunction);
} catch (error) {
	await this.handleRunFailure(error, abortController.signal.aborted);
} finally {
	this.finishRun();
}
```

`ActiveRun` 保存三样东西：

| 字段 | 用途 |
| --- | --- |
| `promise` | `waitForIdle()` 等待它 |
| `resolve` | `finishRun()` 手动结算 |
| `abortController` | `abort()` 中止循环 |

**并发守卫**：`prompt` 和 `continue` 开头都检查 `this.activeRun`，已有运行就抛错。运行中的新输入必须走 `steer()` 或 `followUp()`。

### 2.4 事件如何变成状态

循环通过 `emit` 推事件，`Agent` 用 `processEvents`（`agent.ts:560`）归约：

```ts
switch (event.type) {
	case "message_start":
	case "message_update":
		this._state.streamingMessage = event.message;
		break;
	case "message_end":
		this._state.streamingMessage = undefined;
		this._state.messages.push(event.message);
		break;
	case "tool_execution_start":
		this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls, event.toolCallId]);
		break;
	case "tool_execution_end":
		// 从集合中删除该 id
		break;
	case "turn_end":
		if (event.message.role === "assistant" && event.message.errorMessage) {
			this._state.errorMessage = event.message.errorMessage;
		}
		break;
	case "agent_end":
		this._state.streamingMessage = undefined;
		break;
}
```

关键点：

- `message_start` 不写入 `messages`，只设置 `streamingMessage`；真正入历史在 `message_end`
- 流式期间 UI 从 `streamingMessage` 读当前快照
- `pendingToolCalls` 每次创建新 `Set`，保证外部拿到的 `ReadonlySet` 快照不会被内部改动

归约完成后，事件再按订阅顺序发给监听者。

### 2.5 订阅与 idle

```ts
subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void
```

监听者按注册顺序串行 `await`。`agent_end` 是最后一个事件，但 Agent 要等这些监听者完成后才算 idle。

```ts
waitForIdle(): Promise<void> {
	return this.activeRun?.promise ?? Promise.resolve();
}
```

`activeRun.promise` 在 `finishRun()` 里才 resolve，所以 `await agent.waitForIdle()` 意味着“循环结束 + `agent_end` 监听者完成”。

### 2.6 两个队列

```ts
class PendingMessageQueue {
	private messages: AgentMessage[] = [];
	public mode: QueueMode;

	drain(): AgentMessage[] {
		if (this.mode === "all") {
			const drained = this.messages.slice();
			this.messages = [];
			return drained;
		}
		const first = this.messages[0];
		if (!first) return [];
		this.messages = this.messages.slice(1);
		return [first];
	}
}
```

对外接口：

| 方法 | 作用 |
| --- | --- |
| `steer(message)` | 运行中插队 |
| `followUp(message)` | 停止前追加 |
| `clearSteeringQueue()` / `clearFollowUpQueue()` | 清空 |
| `hasQueuedMessages()` | 是否有排队 |

默认模式都是 `single`（`agent.ts:233`），对应循环中“一次注入一条”的 steer 行为。

队列只在 `Agent` 层实现，`runAgentLoop` 只调用 `getSteeringMessages()` / `getFollowUpMessages()`，不知道队列存在。

### 2.7 prompt、continue、reset

**prompt**（`agent.ts:354`）接受三种入参：

```ts
string + images   → 构造 user 消息
AgentMessage      → 包成数组
AgentMessage[]    → 原样
```

然后交给 `runAgent`。

**continue**（`agent.ts:372`）不追加新消息，按最后一条消息的角色分派：

```text
最后一条是 assistant
  → 有 steering：空 prompt 启动，由循环入口注入
  → 只有 followUp：先 drain 出来作为 prompt 启动
  → 都没有：抛错

最后一条是 user / toolResult
  → 直接继续跑循环
```

steering 不预取，避免和循环入口的轮询重复；followUp 只在循环结束时消费，必须先取出来作为 prompt，否则模型会对着 assistant 消息空跑一轮。

**reset** 在运行中直接抛错，避免清空正在使用的状态。

### 2.8 失败处理

`runAgentLoop` 本身把模型错误编码进消息，但循环外的异常（钩子抛错、快照构造失败）会冒泡到 `runAgent`：

```ts
catch (error) {
	await this.handleRunFailure(error, abortController.signal.aborted);
}
```

`handleRunFailure`（`agent.ts:533`）构造一条空内容的助手消息，`stopReason` 按中止状态取 `"aborted"` 或 `"error"`，然后手动发完整事件序列：

```text
message_start → message_end → turn_end → agent_end
```

这样订阅者看到的序列仍然完整。

### 2.9 快照与配置

`createContextSnapshot()`（`agent.ts:482`）拷贝消息与工具数组：

```ts
return {
	systemPrompt: this._state.systemPrompt,
	messages: this._state.messages.slice(),
	tools: this._state.tools.slice(),
};
```

循环里的追加只改副本，`Agent` 的状态只在 `message_end` 事件里更新。

`createLoopConfig()` 把 `Agent` 的字段与钩子组装成 `AgentLoopConfig`，并把 `this.signal` 传给需要信号的钩子（`beforeToolCall`、`shouldStopAfterTurn` 等）。

### 2.10 proxy 是什么

`proxy.ts` 提供一个替代 `streamFn`：

```ts
streamProxy(model, context, options) → ProxyMessageEventStream
```

它把请求发到自建服务器，服务器负责持有 API key 并转发给 provider。为了让带宽更小，服务器在事件里**去掉 `partial` 字段**，客户端再根据 delta 重建完整消息。

它解决的问题是：客户端不接触 provider key，认证集中在服务端。

和状态机没有直接关系，只是另一种 `StreamFn` 实现。本项目不实现（D-049）。

### 2.11 与整体系统的关系

```text
课程 09  runAgentLoop（无状态）
   ↓
课程 10  Agent（状态 + 队列 + 订阅）      ← 本课
   ↓
课程 13  会话持久化（订阅 message_end 落盘）
课程 17  AgentSession（把 Agent 接进产品）
```

`Agent` 是循环和产品之间的适配层：循环不保存状态，产品不直接操作循环。

### 2.12 小结

| 结论 | 说明 |
| --- | --- |
| Agent 持有唯一状态 | 配置、对话、运行态都在 `AgentState` |
| 单次运行由 `activeRun` 表示 | 结束承诺 + 中止控制器 |
| 并发被拒绝 | 运行中只能用队列插话 |
| 事件归约状态 | `message_end` 才入历史，流式用 `streamingMessage` |
| idle 晚于 `agent_end` | 要等监听者完成 |
| 队列在 Agent 层 | 循环只消费 hook 返回值 |
| 失败也发完整事件 | `handleRunFailure` 补齐序列 |

---

## 3. 讨论与确认记录

| 日期 | 类型 | 内容 | 对 B 的影响 |
| --- | --- | --- | --- |
| 2026-11-20 | 决策 | 用户决定本项目不实现 OAuth；D-019 转为生效 | 认证相关覆盖范围收窄，OAuth 文件标为舍弃 |
| 2026-11-20 | 范围 | 开始课程 10 | A 阶段先讲状态机、队列与订阅 |
| 2026-11-22 | 决策 | `streamProxy` 不实现；其余按原项目设置（D-049、D-050） | B 去掉 proxy，待确认项清空 |
| 2026-11-23 | 状态 | 用户验收 T-10-1 至 T-10-5 | 课程 10 完成 |

---

## 4. B：具体实现规划

> B 已实现并验收（2026-11-23）。决策见 `BUILD_PLAN.md` D-049、D-050；任务 T-10-1 至 T-10-5。

### 4.1 原项目实现

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `agent/src/agent.ts` | 617 | `Agent` 类、`AgentState` 归约、`PendingMessageQueue`、`prompt`/`continue`/`abort`/`waitForIdle` |
| `agent/src/proxy.ts` | 402 | `streamProxy`：服务端代理的 `StreamFn` 实现；本项目不实现 |

`AgentState` 类型定义在 `agent/src/types.ts`，A 节已引用。

### 4.2 新项目实现

| 模块 | 内容 | 依据 |
| --- | --- | --- |
| `AgentState` | 九个字段；`tools`/`messages` 访问器赋值时拷贝顶层数组 | 原项目 |
| `PendingMessageQueue` | `enqueue`、`drain`、`clear`、`hasItems`、可变 `mode` | 原项目 |
| `Agent` | `activeRun`、`subscribe`、`abort`、`signal`、`waitForIdle`、`reset` | 原项目 |
| 输入入口 | `prompt` 三种入参归一化、`continue` 按最后消息角色分派 | 原项目 |
| 队列 API | `steer`、`followUp`、`clearSteeringQueue`、`clearFollowUpQueue`、`clearAllQueues`、`hasQueuedMessages` | 原项目 |
| 事件归约 | `processEvents`；`message_end` 入历史，其余更新运行态 | 原项目 |
| 失败收尾 | `handleRunFailure` 补齐 `message_start` / `message_end` / `turn_end` / `agent_end` | 原项目 |
| 配置组装 | `createContextSnapshot`、`createLoopConfig` | 原项目（`continue` 的 steering 处理按 D-051 简化） |
| `streamProxy` | 不实现 | D-049 |

实现约定（D-050）：

- `AgentState` 暴露全部运行态字段
- 监听者按注册顺序串行 `await`，异常向上冒泡
- `steeringMode`、`followUpMode` 默认 `single`

### 4.3 任务拆分

| 任务 ID | 目标与范围 | 文件/模块 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| T-10-1 | `AgentState`、`PendingMessageQueue` 与队列行为 | `packages/agent/src/types.ts`、`packages/agent/src/message-queue.ts`、`packages/agent/src/index.ts` | T-09-5 | 两种排空模式、清空、判空、默认值测试通过 |
| T-10-2 | `Agent` 生命周期：`prompt`、`continue`、`abort`、`waitForIdle`、`reset`、队列 API | `packages/agent/src/agent.ts` | T-10-1 | 并发拒绝、中止、空闲等待、`continue` 分派测试通过 |
| T-10-3 | 事件归约与订阅：`processEvents`、`subscribe` | `packages/agent/src/agent.ts` | T-10-2 | 状态字段随事件变化；监听顺序与异常冒泡符合约定 |
| T-10-4 | 失败收尾、快照与 `createLoopConfig` | `packages/agent/src/agent.ts` | T-10-3 | 循环外异常产生完整事件序列 |
| T-10-5 | 导出、测试与 changelog | `packages/agent/src/index.ts`、`packages/agent/test/*`、`packages/agent/CHANGELOG.md` | T-10-1..4 | `build`、`test`、`check` 通过 |

### 4.4 复现选项

| 选项 | 状态 |
| --- | --- |
| 完整实现状态机、队列与订阅；`streamProxy` 不实现 | 已确认（D-049、D-050） |
| 只支持单个监听者 | 未采用 |
| 队列 API 后置到课程 17 | 未采用 |

### 4.5 待确认决策

无。默认按原项目实现；唯一偏离是 `streamProxy` 不实现。
