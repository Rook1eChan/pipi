import type {
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Context,
	ImageContent,
	Message,
	Model,
	ModelThinkingLevel,
	SimpleStreamOptions,
	TextContent,
	Tool,
	ToolCall,
	ToolResultMessage,
	Usage,
} from "@pipi/llm";

/** 产生助手消息事件流的函数。由调用方注入，agent 不依赖具体 provider。 */
export type StreamFn = (
	model: Model,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/** 单条助手消息中多个工具调用的执行方式。 */
export type ToolExecutionMode = "sequential" | "parallel";

/** 排队消息在排空点一次注入多少条。 */
export type QueueMode = "all" | "single";

/** 助手消息中的工具调用块。 */
export type AgentToolCall = ToolCall;

/** `beforeToolCall` 的返回值。 */
export interface BeforeToolCallResult {
	block?: boolean;
	reason?: string;
	terminate?: boolean;
}

/** `afterToolCall` 的部分覆盖值，未提供的字段保留原值。 */
export interface AfterToolCallResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
	usage?: Usage;
	terminate?: boolean;
}

/** 传给 `beforeToolCall` 的上下文。 */
export interface BeforeToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	args: unknown;
	context: AgentContext;
}

/** 传给 `afterToolCall` 的上下文。 */
export interface AfterToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	args: unknown;
	result: AgentToolResult<unknown>;
	isError: boolean;
	context: AgentContext;
}

/** 传给 `shouldStopAfterTurn` 与 `prepareNextTurn` 的上下文。 */
export interface ShouldStopAfterTurnContext {
	message: AssistantMessage;
	toolResults: ToolResultMessage[];
	context: AgentContext;
	newMessages: AgentMessage[];
}

/** 下一轮开始前可替换的运行时状态。 */
export interface AgentLoopTurnUpdate {
	context?: AgentContext;
	model?: Model;
	thinkingLevel?: ModelThinkingLevel;
}

export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {}

/**
 * 一次运行的配置：模型、消息转换与全部扩展钩子。
 * 继承 `SimpleStreamOptions`，请求级选项由循环传给 `streamFn`。
 */
export interface AgentLoopConfig extends SimpleStreamOptions {
	/** 本轮使用的模型；`prepareNextTurn` 可以为下一轮替换它。 */
	model: Model;

	/** 把内部消息转成 LLM 能理解的格式；自定义角色在此转换或过滤，不能抛错。 */
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/** 调模型前裁剪或注入上下文，返回替换后的消息列表。 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => AgentMessage[] | Promise<AgentMessage[]>;

	/** 每次请求动态解析 API key；没有可用 key 时返回 undefined。 */
	getApiKey?: (provider: string) => string | undefined | Promise<string | undefined>;

	/** `turn_end` 之后调用；返回 true 则发出 `agent_end` 并停止循环。 */
	shouldStopAfterTurn?: (context: ShouldStopAfterTurnContext) => boolean | Promise<boolean>;

	/** 下一轮开始前替换上下文、模型或思考档位；返回 undefined 表示不变。 */
	prepareNextTurn?: (
		context: PrepareNextTurnContext,
	) => AgentLoopTurnUpdate | undefined | Promise<AgentLoopTurnUpdate | undefined>;

	/** 取中途插队消息，在下一次模型调用前注入当前上下文。 */
	getSteeringMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;

	/** 取排队追加消息；内层循环结束时消费，会开启新一轮。 */
	getFollowUpMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;

	/** 整批工具的执行模式；默认并行，任一工具要求串行时整批串行。 */
	toolExecution?: ToolExecutionMode;

	/** 参数处理后、工具执行前调用；返回 `block` 可阻止执行。 */
	beforeToolCall?: (
		context: BeforeToolCallContext,
		signal?: AbortSignal,
	) => BeforeToolCallResult | undefined | Promise<BeforeToolCallResult | undefined>;

	/** 工具执行后、事件发出前调用；返回字段会逐项覆盖已执行结果。 */
	afterToolCall?: (
		context: AfterToolCallContext,
		signal?: AbortSignal,
	) => AfterToolCallResult | undefined | Promise<AfterToolCallResult | undefined>;
}

/** 工具产出的结果。失败通过抛异常表达，不写进 content。 */
export interface AgentToolResult<T = unknown> {
	content: (TextContent | ImageContent)[];
	details?: T;
	usage?: Usage;
	addedToolNames?: string[];
	terminate?: boolean;
}

/** 工具执行过程中的增量更新。 */
export type AgentToolUpdateCallback<T = unknown> = (partial: AgentToolResult<T>) => void;

/**
 * agent 运行时使用的工具定义：在 llm 的 `Tool` 上补充执行能力与调度信息。
 * `execute` 失败必须抛异常，循环会把异常转成错误结果回填给模型。
 */
export interface AgentTool<TParameters = Record<string, unknown>, TDetails = unknown> extends Tool {
	/** UI 显示用的可读名称。 */
	label: string;
	/** 参数预处理函数：在 schema 校验前修正原始参数，必须返回与目标 schema 匹配的对象。 */
	prepareArguments?: (args: unknown) => TParameters;
	/** 执行工具；失败必须抛异常，循环会把它转成错误结果回填给模型。 */
	execute: (
		toolCallId: string, // 本次调用的 id，回填到工具结果消息
		params: TParameters, // 经 prepareArguments 处理后的参数
		signal?: AbortSignal, // 中止信号
		onUpdate?: AgentToolUpdateCallback<TDetails>, // 执行过程中的增量结果
	) => Promise<AgentToolResult<TDetails>>;
	/** 效果已产生但结果未知时的恢复策略。 */
	replay?: "never" | "safe";
	/** 单个工具的执行模式覆盖；声明 sequential 会让整批工具串行。 */
	executionMode?: ToolExecutionMode;
}

/** 循环当前持有的上下文快照。 */
export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools?: AgentTool[];
}

/**
 * Agent 对外暴露的状态。
 */
export interface AgentState {
	/** 每次请求附带的系统提示。 */
	systemPrompt: string;

	/** 后续轮次使用的模型。 */
	model: Model;

	/** 后续轮次请求的思考档位；`off` 表示不启用。 */
	thinkingLevel: ModelThinkingLevel;

	/** 可用工具；赋值时拷贝顶层数组。 */
	set tools(tools: AgentTool[]);
	get tools(): AgentTool[];

	/** 对话历史；赋值时拷贝顶层数组。 */
	set messages(messages: AgentMessage[]);
	get messages(): AgentMessage[];

	/** 当前是否正在处理一次运行。 */
	readonly isRunning: boolean;

	/** 正在流式生成的助手消息快照。 */
	readonly streamingMessage?: AgentMessage;

	/** 当前正在执行的工具调用 id 集合。 */
	readonly pendingToolCalls: ReadonlySet<string>;

	/** 最近一次失败或中止的错误信息。 */
	readonly errorMessage?: string;
}

/** 应用可通过声明合并扩展自定义消息类型。 */
export interface CustomAgentMessages {}

/** 内部消息类型：LLM 消息 + 应用自定义消息。 */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/** UI 与扩展消费的事件。 */
export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };
