import type {
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingBudgets,
	Transport,
} from "@pipi/llm";
import { runAgentLoop } from "./agent-loop.ts";
import { PendingMessageQueue } from "./message-queue.ts";
import type {
	AfterToolCallContext,
	AfterToolCallResult,
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentLoopTurnUpdate,
	AgentMessage,
	AgentState,
	AgentTool,
	BeforeToolCallContext,
	BeforeToolCallResult,
	PrepareNextTurnContext,
	QueueMode,
	ShouldStopAfterTurnContext,
	StreamFn,
	ToolExecutionMode,
} from "./types.ts";

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) => message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	);
}

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const DEFAULT_MODEL = {
	id: "unknown",
	name: "unknown",
	api: "unknown",
	provider: "unknown",
	baseUrl: "",
	reasoning: false,
	input: [],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 0,
	maxTokens: 0,
} satisfies Model;

// 把四个字段删掉再重定义，目的是为了去掉readonly的限制
type MutableAgentState = Omit<AgentState, "isRunning" | "streamingMessage" | "pendingToolCalls" | "errorMessage"> & {
	isRunning: boolean;
	streamingMessage?: AgentMessage;
	pendingToolCalls: Set<string>;
	errorMessage?: string;
};

type InitialAgentState = Pick<AgentState, "systemPrompt" | "model" | "thinkingLevel" | "tools" | "messages">;

/** 构造可变状态；tools / messages 赋值时拷贝顶层数组。 */
function createMutableAgentState(initialState?: Partial<InitialAgentState>): MutableAgentState {
	let tools = initialState?.tools?.slice() ?? [];
	let messages = initialState?.messages?.slice() ?? [];

	return {
		systemPrompt: initialState?.systemPrompt ?? "",
		model: initialState?.model ?? DEFAULT_MODEL,
		thinkingLevel: initialState?.thinkingLevel ?? "off",
		get tools() {
			return tools;
		},
		set tools(nextTools: AgentTool[]) {
			tools = nextTools.slice();
		},
		get messages() {
			return messages;
		},
		set messages(nextMessages: AgentMessage[]) {
			messages = nextMessages.slice();
		},
		isRunning: false,
		streamingMessage: undefined,
		pendingToolCalls: new Set<string>(),
		errorMessage: undefined,
	};
}

/** 构造 Agent 的选项。 */
export interface AgentOptions {
	// 初始状态：系统提示、模型、思考档位、工具与消息历史；未提供的字段取默认值。
	initialState?: Partial<InitialAgentState>;

	// 把内部消息转成 LLM 能理解的格式；默认保留 user、assistant、toolResult。
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	// 调模型前裁剪或注入上下文，返回替换后的消息列表。
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => AgentMessage[] | Promise<AgentMessage[]>;

	// 每次请求动态解析 API key；没有可用 key 时返回 undefined。
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;

	// 产生模型事件流的函数，必传；通常是 models.streamSimple 的绑定。
	streamFn: StreamFn;

	// steering 队列的排空模式，默认 single。
	steeringMode?: QueueMode;

	// followUp 队列的排空模式，默认 single。
	followUpMode?: QueueMode;

	// 一批工具的执行模式，默认 parallel；任一工具声明 sequential 时整批串行。
	toolExecution?: ToolExecutionMode;

	// 会话标识，透传给 provider，用于缓存命中。
	sessionId?: string;

	// 各思考档位的 token 预算，透传给支持思考预算的 provider。
	thinkingBudgets?: ThinkingBudgets;

	// 请求传输方式，默认 auto。
	transport?: Transport;

	// provider 请求重试延迟上限，透传给适配器。
	maxRetryDelayMs?: number;

	// 发送前检查或替换 provider 原始请求体。
	onPayload?: SimpleStreamOptions["onPayload"];

	// 收到响应后、读取 body 前调用，可读取状态与响应头。
	onResponse?: SimpleStreamOptions["onResponse"];

	// 参数处理后、工具执行前调用；返回 block 可阻止执行。
	beforeToolCall?: (
		context: BeforeToolCallContext,
		signal?: AbortSignal,
	) => BeforeToolCallResult | undefined | Promise<BeforeToolCallResult | undefined>;

	// 工具执行后、事件发出前调用；返回字段会逐项覆盖结果。
	afterToolCall?: (
		context: AfterToolCallContext,
		signal?: AbortSignal,
	) => AfterToolCallResult | undefined | Promise<AfterToolCallResult | undefined>;

	// 每轮结束后调用；返回 true 则停止运行，不再调模型。
	shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext, signal?: AbortSignal) => boolean | Promise<boolean>;

	// 下一轮开始前调用，只拿到中止信号；返回替换的上下文、模型或思考档位。
	prepareNextTurn?: (
		signal?: AbortSignal,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

	// 与 prepareNextTurn 相同，但额外拿到上一轮的完整快照。
	prepareNextTurnWithContext?: (
		context: PrepareNextTurnContext,
		signal?: AbortSignal,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;
}

// agent运行时的控制器
type RunHandle = {
	promise: Promise<void>;
	resolve: () => void;
	abortController: AbortController;
};

/**
 * 有状态地包装 `runAgentLoop`：维护对话历史、拒绝并发运行、提供插队与追加队列。
 */
export class Agent {
	// agent状态
	private _state: MutableAgentState;

	// 两个待处理消息队列
	private readonly steeringQueue: PendingMessageQueue;
	private readonly followUpQueue: PendingMessageQueue;

	// agent运行控制器
	private runHandle?: RunHandle;

	// 事件订阅者
	private readonly listeners = new Set<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>();

	public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	public transformContext?: (
		messages: AgentMessage[],
		signal?: AbortSignal,
	) => AgentMessage[] | Promise<AgentMessage[]>;
	public streamFunction: StreamFn;
	public getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;
	public toolExecution: ToolExecutionMode;
	public sessionId?: string;
	public thinkingBudgets?: ThinkingBudgets;
	public transport: Transport;
	public maxRetryDelayMs?: number;
	public onPayload?: SimpleStreamOptions["onPayload"];
	public onResponse?: SimpleStreamOptions["onResponse"];
	public beforeToolCall?: (
		context: BeforeToolCallContext,
		signal?: AbortSignal,
	) => BeforeToolCallResult | undefined | Promise<BeforeToolCallResult | undefined>;
	public afterToolCall?: (
		context: AfterToolCallContext,
		signal?: AbortSignal,
	) => AfterToolCallResult | undefined | Promise<AfterToolCallResult | undefined>;
	public shouldStopAfterTurn?: (
		context: ShouldStopAfterTurnContext,
		signal?: AbortSignal,
	) => boolean | Promise<boolean>;
	public prepareNextTurn?: (
		signal?: AbortSignal,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;
	public prepareNextTurnWithContext?: (
		context: PrepareNextTurnContext,
		signal?: AbortSignal,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

	constructor(options: AgentOptions) {
		this._state = createMutableAgentState(options.initialState);
		this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
		this.transformContext = options.transformContext;
		this.streamFunction = options.streamFn;
		this.getApiKey = options.getApiKey;
		this.toolExecution = options.toolExecution ?? "parallel";
		this.sessionId = options.sessionId;
		this.thinkingBudgets = options.thinkingBudgets;
		this.transport = options.transport ?? "auto";
		this.maxRetryDelayMs = options.maxRetryDelayMs;
		this.onPayload = options.onPayload;
		this.onResponse = options.onResponse;
		this.beforeToolCall = options.beforeToolCall;
		this.afterToolCall = options.afterToolCall;
		this.shouldStopAfterTurn = options.shouldStopAfterTurn;
		this.prepareNextTurn = options.prepareNextTurn;
		this.prepareNextTurnWithContext = options.prepareNextTurnWithContext;
		this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "single");
		this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "single");
	}

	/** 当前状态。`tools` / `messages` 赋值时拷贝顶层数组。 */
	get state(): AgentState {
		return this._state;
	}

	/**
	 * 订阅生命周期事件；监听者按注册顺序串行等待。
	 * 返回取消订阅的函数。
	 */
	subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
		this.listeners.add(listener); // 把订阅逻辑存起来
		return () => this.listeners.delete(listener); // 返回一个删除函数，订阅者可以自己删除订阅
	}

	/** 排队 steering 消息的排空模式。 */
	set steeringMode(mode: QueueMode) {
		this.steeringQueue.mode = mode;
	}

	get steeringMode(): QueueMode {
		return this.steeringQueue.mode;
	}

	/** 排队 followUp 消息的排空模式。 */
	set followUpMode(mode: QueueMode) {
		this.followUpQueue.mode = mode;
	}

	get followUpMode(): QueueMode {
		return this.followUpQueue.mode;
	}

	/** 在当前轮结束后插入一条消息。 */
	steer(message: AgentMessage): void {
		this.steeringQueue.enqueue(message);
	}

	/** 在 Agent 本该停止时追加一条消息。 */
	followUp(message: AgentMessage): void {
		this.followUpQueue.enqueue(message);
	}

	/** 清空 steering 队列。 */
	clearSteeringQueue(): void {
		this.steeringQueue.clear();
	}

	/** 清空 followUp 队列。 */
	clearFollowUpQueue(): void {
		this.followUpQueue.clear();
	}

	/** 清空两个队列。 */
	clearAllQueues(): void {
		this.clearSteeringQueue();
		this.clearFollowUpQueue();
	}

	/** 是否有排队消息。 */
	hasQueuedMessages(): boolean {
		return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
	}

	/** 当前运行的中止信号。 */
	get signal(): AbortSignal | undefined {
		return this.runHandle?.abortController.signal;
	}

	/** 中止当前运行。 */
	abort(): void {
		this.runHandle?.abortController.abort();
	}

	waitForIdle(): Promise<void> {
		// 如果this.runHandle?.promise不为空，说明agent运行没结束，promise在pending，返回这个promise，外部调用就是await promise进行等待
		// 如果为空，说明agent不在运行，返回一个resolve的promise。
		return this.runHandle?.promise ?? Promise.resolve();
	}

	/** 清空对话、运行态与队列；运行中调用会抛错。 */
	reset(): void {
		if (this.runHandle) {
			throw new Error("Agent is already processing. Wait for completion before resetting.");
		}

		this._state.messages = [];
		this._state.isRunning = false;
		this._state.streamingMessage = undefined;
		this._state.pendingToolCalls = new Set<string>();
		this._state.errorMessage = undefined;
		this.clearAllQueues();
	}

	/** 追加一条或多条消息并运行，直到 Agent 停止。 */
	async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
		if (this.runHandle) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}
		await this.runAgent(this.normalizePromptInput(input, images));
	}

	/** 从上次停止的位置继续；不追加新的用户消息。 */
	async continue(): Promise<void> {
		// agent正在运行则报错
		if (this.runHandle) {
			throw new Error("Agent is already processing. Wait for completion before continuing.");
		}

		// 检查最后一条消息
		const lastMessage = this._state.messages[this._state.messages.length - 1];
		if (!lastMessage) {
			throw new Error("No messages to continue from");
		}

		// 以assistant结尾，检查还有没有steer/followUp消息
		if (lastMessage.role === "assistant") {
			// runAgentLoop里会检查steer，这里不用传
			if (this.steeringQueue.hasItems()) {
				await this.runAgent([]);
				return;
			}
			// followUp 只在循环结束时消费；先取出来作为 prompt，模型第一次就能看到。
			if (this.followUpQueue.hasItems()) {
				await this.runAgent(this.followUpQueue.drain());
				return;
			}

			throw new Error("Cannot continue from message role: assistant");
		}

		// 以user/toolresult结尾，直接接着跑
		await this.runAgent([]);
	}

	/** 把三种入参统一成 AgentMessage[]。 */
	private normalizePromptInput(
		input: string | AgentMessage | AgentMessage[],
		images?: ImageContent[],
	): AgentMessage[] {
		if (Array.isArray(input)) return input;
		if (typeof input !== "string") return [input];

		const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
		if (images && images.length > 0) content.push(...images);
		return [{ role: "user", content, timestamp: Date.now() }];
	}

	/** 运行一次agent：登记 runHandle，调用循环，结束后释放。 */
	private async runAgent(messages: AgentMessage[]): Promise<void> {
		// 检查agent是否正在运行
		if (this.runHandle) {
			throw new Error("Agent is already processing.");
		}

		// 建runHandle
		const abortController = new AbortController();
		let resolvePromise = () => {};
		const promise = new Promise<void>((resolve) => {
			resolvePromise = resolve;
		});
		this.runHandle = { promise, resolve: resolvePromise, abortController };

		this._state.isRunning = true;
		this._state.streamingMessage = undefined;
		this._state.errorMessage = undefined;

		try {
			await runAgentLoop(
				messages,
				this.createContextSnapshot(),
				this.createLoopConfig(),
				(event) => this.processEvents(event), // emit
				abortController.signal,
				this.streamFunction,
			);
		} catch (error) {
			// loop外异常：补一条错误assistant消息，并发出完整事件序列。
			await this.handleRunFailure(error, abortController.signal.aborted);
		} finally {
			// 修改state，释放runHandle
			this.finishRun();
		}
	}

	/** agent-loop传入的是agent的上下文的拷贝。 */
	private createContextSnapshot(): AgentContext {
		return {
			systemPrompt: this._state.systemPrompt,
			messages: this._state.messages.slice(),
			tools: this._state.tools.slice(),
		};
	}

	/** 组装循环配置。 */
	private createLoopConfig(): AgentLoopConfig {
		return {
			model: this._state.model,
			reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
			toolExecution: this.toolExecution,
			sessionId: this.sessionId,
			thinkingBudgets: this.thinkingBudgets,
			transport: this.transport,
			maxRetryDelayMs: this.maxRetryDelayMs,
			onPayload: this.onPayload,
			onResponse: this.onResponse,
			beforeToolCall: this.beforeToolCall,
			afterToolCall: this.afterToolCall,
			shouldStopAfterTurn: this.shouldStopAfterTurn
				? async (context) => {
						const hook = this.shouldStopAfterTurn;
						return hook ? await hook(context, this.signal) : false;
					}
				: undefined,
			prepareNextTurn: this.prepareNextTurnWithContext
				? async (context) => {
						const hook = this.prepareNextTurnWithContext;
						return hook ? await hook(context, this.signal) : undefined;
					}
				: this.prepareNextTurn
					? async () => {
							const hook = this.prepareNextTurn;
							return hook ? await hook(this.signal) : undefined;
						}
					: undefined,
			convertToLlm: this.convertToLlm,
			transformContext: this.transformContext,
			getApiKey: this.getApiKey,
			getSteeringMessages: async () => this.steeringQueue.drain(),
			getFollowUpMessages: async () => this.followUpQueue.drain(),
		};
	}

	/** 先根据event更新state，再按注册顺序通知监听者。 */
	private async processEvents(event: AgentEvent): Promise<void> {
		// 根据event更新state
		switch (event.type) {
			// 信息开始或更新，更新streamingMessage
			case "message_start":
			case "message_update":
				this._state.streamingMessage = event.message;
				break;
			// 信息结束，清空streamingMessage，把完整消息加入messages
			case "message_end":
				this._state.streamingMessage = undefined;
				this._state.messages.push(event.message);
				break;
			// 工具执行，在集合中加入toolcall id
			case "tool_execution_start":
				this._state.pendingToolCalls = new Set([...this._state.pendingToolCalls, event.toolCallId]);
				break;
			// 工具执行完成，删掉对应的toolcall id
			case "tool_execution_end": {
				const pending = new Set(this._state.pendingToolCalls);
				pending.delete(event.toolCallId);
				this._state.pendingToolCalls = pending;
				break;
			}
			// 一轮结束，取出errorMessage
			case "turn_end":
				if (event.message.role === "assistant" && event.message.errorMessage) {
					this._state.errorMessage = event.message.errorMessage;
				}
				break;
			case "agent_end":
				this._state.streamingMessage = undefined;
				break;
		}

		// 正常来说signal不会在事件发出时为空。为空说明代码写错了。
		const signal = this.runHandle?.abortController.signal;
		if (!signal) {
			throw new Error("Agent listener invoked outside active run");
		}
		// 每个事件都通知所有listener
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}

	/** agent-loop外异常：构造错误assis消息，走完整事件序列，让监听者仍能收到收尾。 */
	private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
		const failureMessage: AgentMessage = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
			api: this._state.model.api,
			provider: this._state.model.provider,
			model: this._state.model.id,
			usage: EMPTY_USAGE,
			stopReason: aborted ? "aborted" : "error",
			errorMessage: error instanceof Error ? error.message : String(error),
			timestamp: Date.now(),
		};
		await this.processEvents({ type: "message_start", message: failureMessage });
		await this.processEvents({ type: "message_end", message: failureMessage });
		await this.processEvents({ type: "turn_end", message: failureMessage, toolResults: [] });
		await this.processEvents({ type: "agent_end", messages: [failureMessage] });
	}

	/** 释放运行状态并结算 waitForIdle。 */
	private finishRun(): void {
		this._state.isRunning = false;
		this._state.streamingMessage = undefined;
		this._state.pendingToolCalls = new Set<string>();
		this.runHandle?.resolve();
		this.runHandle = undefined;
	}
}
