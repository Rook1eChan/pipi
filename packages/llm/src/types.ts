/**
 * @pipi/llm 的公共数据契约。
 *
 * 本文件只定义数据形状，不发起网络请求、不解析流、不执行工具、不持久化会话。
 * 这些行为由其他模块负责。
 */

import type { TSchema } from "typebox";

/** 可序列化为 JSON 的值。用于 provider 返回的透明数据。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** 已知的 API 家族。自定义 API 仍然可以用字符串表示。 */
export type KnownApi = "openai-completions" | "openai-responses" | "openai-codex-responses" | "anthropic-messages";

/** API 标识：已知家族或自定义字符串。 */
export type Api = KnownApi | (string & {});

/** 已知的 provider。自定义 provider 仍然可以用字符串表示。 */
export type KnownProvider = "openai" | "openai-codex" | "anthropic" | "deepseek" | "faux";

/** Provider 标识：已知 provider 或自定义字符串。 */
export type ProviderId = KnownProvider | string;

/** 请求模型时使用的思考强度。 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** 模型配置中的思考级别，额外允许关闭。 */
export type ModelThinkingLevel = "off" | ThinkingLevel;

/** 某些 provider 需要的文本元数据签名。 */
export interface TextSignatureV1 {
	v: 1;
	id: string;
	phase?: "commentary" | "final_answer";
}

/** 普通文本块。 */
export interface TextContent {
	type: "text";
	text: string;
	/** provider 特有的多轮元数据，例如 OpenAI Responses 的消息签名。 */
	textSignature?: string;
}

/** 推理/思考内容块。 */
export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	/** provider 特有的签名或加密载荷，用于多轮回放。 */
	thinkingSignature?: string;
	/** 内容被安全策略脱敏时，原始加密载荷保存在 thinkingSignature。 */
	redacted?: boolean;
}

/** 图片内容块。data 为 base64，不直接使用 URL。 */
export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

/** 模型请求调用某个工具。 */
export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	/** Google 特有：复用思考上下文的不透明签名。 */
	thoughtSignature?: string;
	/** OpenAI Responses 特有：动态加载或命名空间工具的命名空间。 */
	namespace?: string;
}

/** 一次调用的 token 用量与折算费用。 */
export interface UsageCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

/** token 用量与费用。 */
export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** 1 小时保留期的缓存写入，仅部分 provider 报告。 */
	cacheWrite1h?: number;
	/** 推理 token，是 output 的子集。 */
	reasoning?: number;
	totalTokens: number;
	cost: UsageCost;
}

/** 一次回复的结束原因。 */
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted";

/** 诊断中的错误摘要。 */
export interface DiagnosticErrorInfo {
	name?: string;
	message: string;
	stack?: string;
	code?: string | number;
}

/** provider 或运行时的脱敏诊断信息。 */
export interface AssistantMessageDiagnostic {
	type: string;
	timestamp: number;
	error?: DiagnosticErrorInfo;
	details?: Record<string, unknown>;
}

/** 用户输入。content 可以是纯文本，也可以是文本/图片块数组。 */
export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

/** 模型回复。content 可以同时包含思考、文本和多个工具调用。 */
export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: ProviderId;
	model: string;
	/** 上游实际返回的模型，和请求的 model 不同时才有值。 */
	responseModel?: string;
	/** 上游返回的响应 id。 */
	responseId?: string;
	/** provider 实际使用的思考档位。 */
	providerThinkingLevel?: string;
	diagnostics?: AssistantMessageDiagnostic[];
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	rawStopReason?: string;
	/** provider 是否明确结束了本轮。 */
	endTurn?: boolean;
	timestamp: number;
}

/**
 * 流式事件协议。
 *
 * 成功流以 `start` 开头，经过若干块事件，以 `done` 结束。生成开始前的失败只发
 * `error`，生成开始后的失败也以 `error` 结束。`partial` 是到该事件为止的完整消息，
 * 由生产者原地修改，不是快照。`done` 与 `error` 是互斥的终止事件。
 */
export type AssistantMessageEvent =
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
	| {
			type: "done";
			reason: Extract<StopReason, "stop" | "length" | "toolUse">; // Extract 表示取交集
			message: AssistantMessage;
	  }
	| { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

/** 工具执行结果。通过 toolCallId 与助手消息中的 ToolCall 配对。 */
export interface ToolResultMessage<TDetails = unknown> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	/** 工具自身的用量，不进入主对话的 token 账本。 */
	usage?: Usage;
	/** 这次结果之后新可用的工具名。 */
	addedToolNames?: string[];
	isError: boolean;
	timestamp: number;
}

/** 模型能理解的消息。 */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** OpenAI 兼容端点的兼容开关。只保留当前需要的子集。 */
export interface OpenAICompletionsCompat {
	supportsStore?: boolean;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	supportsUsageInStreaming?: boolean;
	supportsFinishReason?: boolean;
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	requiresToolResultName?: boolean;
	requiresAssistantAfterToolResult?: boolean;
	requiresThinkingAsText?: boolean;
	requiresReasoningContentOnAssistantMessages?: boolean;
	thinkingFormat?:
		| "openai"
		| "openrouter"
		| "deepseek"
		| "zai"
		| "qwen"
		| "chat-template"
		| "qwen-chat-template"
		| "string-thinking";
	supportsStrictMode?: boolean;
}

/** 工具参数的受限采样配置。
目的是为了让provider输出json时出错更少。
*/
export type GrammarFormat = "openai_lark" | "openai_regex";
export type GrammarVariants = Partial<Record<GrammarFormat, string>>;
export type ConstrainedSamplingConfig =
	| { type: "json_schema"; strict: "prefer" | "require" }
	| { type: "grammar"; variants: GrammarVariants };

/** 模型可调用的工具声明。parameters 使用 TypeBox schema。 */
export interface Tool<TParameters extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: TParameters;
	constrainedSampling?: false | ConstrainedSamplingConfig;
}

/** 模型价格，单位为美元 / 百万 token。 */
export interface ModelCostRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/** 按输入 token 数触发的阶梯价格。 */
export interface ModelCostTier extends ModelCostRates {
	inputTokensAbove: number;
}

/** 模型价格与可选阶梯。 */
export interface ModelCost extends ModelCostRates {
	tiers?: ModelCostTier[];
}

/** 思考档位到 provider 具体值的映射；null 表示不支持。 */
export type ThinkingLevelMap = Partial<Record<ModelThinkingLevel, string | null>>;

/** token 计费式 provider 使用的思考预算。 */
export interface ThinkingBudgets {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

/** 模型描述。*/
export interface Model<TApi extends Api = Api> {
	id: string;
	name: string;
	api: TApi;
	provider: ProviderId;
	baseUrl: string;
	reasoning: boolean;
	thinkingLevelMap?: ThinkingLevelMap;
	input: ("text" | "image")[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	samplingParams?: Record<string, unknown>;
	headers?: Record<string, string>;
	compat?: TApi extends "openai-completions" ? OpenAICompletionsCompat : never;
}

/** 一次请求的context */
export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

/** provider 作用域的环境变量覆盖；同名键优先于 process.env。 */
export type ProviderEnv = Record<string, string>;

/** 自定义请求头；值为 null 时抑制同名默认头。 */
export type ProviderHeaders = Record<string, string | null>;

/** 可注入的 fetch 实现，用于测试、代理或自定义网络层；不影响 WebSocket 传输。 */
export type FetchFunction = typeof globalThis.fetch;

/** 首选传输方式；不支持该选项的 provider 会忽略。 */
export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";

/** 提示缓存保留偏好，由 provider 映射到自身支持的档位。 */
export type CacheRetention = "none" | "short" | "long";

/** 简单请求的工具选择策略；省略时由 provider 决定默认行为。 */
export type ToolChoice = "auto" | "none";

export interface ProviderResponse {
	status: number;
	headers: Record<string, string>;
}

/**
 * 各个provider都有的基础请求参数，不一定全部使用。
 * 各个provider还有一些含义相同命名不同的参数，比如比如thinkeffort/thinking，这里不包括。
 */
export interface StreamOptions {
	signal?: AbortSignal;
	apiKey?: string;
	/**
	 * 可选的 fetch 实现，用于 provider 的 HTTP 请求。
	 * 默认使用 `globalThis.fetch`。无法注入自定义实现的 adapter 可能拒绝该选项。
	 * 该选项不影响 WebSocket transport。
	 */
	fetch?: FetchFunction;
	/**
	 * provider 作用域的环境变量。用于区域设置、端点占位符、代理变量等 provider 配置时，
	 * 优先于 process.env。
	 */
	env?: ProviderEnv;
	/**
	 * 可选回调：发送前检查或替换 provider 的 payload。
	 * 返回 undefined 表示保持 payload 不变。
	 */
	onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
	/**
	 * 可选回调：收到 HTTP 响应后、消费其 body 流之前调用。
	 */
	onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
	/**
	 * 可选的自定义 HTTP 请求头。
	 * 与 provider 默认头合并，调用方传入的值覆盖默认值。
	 * null 值会抑制同名的 provider/API 默认头。
	 */
	headers?: ProviderHeaders;
	/**
	 * HTTP 请求超时，单位毫秒，仅对支持该选项的 provider/SDK 生效。
	 * 例如 OpenAI 与 Anthropic 的 SDK 客户端默认 10 分钟。
	 */
	timeoutMs?: number;
	/**
	 * 客户端重试的最大次数，仅对支持该选项的 provider/SDK 生效。
	 * 例如 OpenAI 与 Anthropic 的 SDK 客户端默认 2 次。
	 */
	maxRetries?: number;
	/**
	 * 服务端要求较长等待时，重试的最大延迟，单位毫秒。
	 * 超过该值时请求立即失败，并在错误中带上服务端要求的延迟，
	 * 由上层重试逻辑带用户提示地处理。
	 * 默认 60000（60 秒）。设为 0 关闭上限。
	 */
	maxRetryDelayMs?: number;
	temperature?: number;
	/**
	 * 任意采样参数，原样合并进请求体，位置在具名字段之后，因此同名键会覆盖它们。
	 * 用于让自定义 OpenAI 兼容服务（llama.cpp、vLLM、SGLang 等）收到 pi 未建模的参数，
	 * 例如 `top_p`、`top_k`、`min_p`、`repetition_penalty`。
	 * 按 key 覆盖 `Model.samplingParams`。仅 OpenAI 兼容 adapter 会应用；其它 API 忽略该选项。
	 */
	samplingParams?: Record<string, unknown>;
	maxTokens?: number;
	/**
	 * 支持多种 transport 的 provider 的首选 transport。
	 * 不支持该选项的 provider 会忽略它。
	 */
	transport?: Transport;
	/**
	 * prompt cache 的保留偏好。provider 会把它映射成自己支持的值。
	 * 默认 "short"。
	 */
	cacheRetention?: CacheRetention;
	/**
	 * 可选的 session 标识，供支持基于 session 缓存的 provider 使用。
	 * provider 可用它启用 prompt cache、请求路由或其它与 session 相关的特性。
	 * 不支持该选项的 provider 会忽略它。
	 */
	sessionId?: string;
	/**
	 * 附加到 API 请求的可选 metadata。
	 * provider 提取自己理解的字段，忽略其余内容。
	 * 例如 Anthropic 用 `user_id` 做滥用追踪和限流。
	 */
	metadata?: Record<string, unknown>;
}

/** 把各家provider不同的字段做一个统一接口。上层调用不需要考虑provider的特有字段 */
export interface SimpleStreamOptions extends StreamOptions {
	toolChoice?: ToolChoice;
	reasoning?: ThinkingLevel;
	thinkingBudgets?: ThinkingBudgets;
}
