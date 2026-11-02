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

/**
 * provider 返回的延期响应句柄。
 *
 * 只在 stopReason 为 "deferred" 时出现。这里只定义形状，
 * 取回结果的方法由模型运行时提供。
 */
export interface DeferredHandle {
	provider: ProviderId;
	modelId: string;
	api: Api;
	/** provider 侧的响应 id、任务 id 或批次行 id。 */
	id: string;
	expiresAt?: number;
	pollAfterMs?: number;
	/** 重建最终消息所需的 provider 数据。 */
	data?: JsonValue;
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
export type StopReason = "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";

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
	/** stopReason 为 deferred 时的取件句柄。 */
	deferred?: DeferredHandle;
	errorMessage?: string;
	rawStopReason?: string;
	/** provider 是否明确结束了本轮。 */
	endTurn?: boolean;
	timestamp: number;
}

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

/** 模型描述。它是数据，不是类。 */
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

/** 一次模型请求的输入。 */
export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

export type ProviderEnv = Record<string, string>;
export type ProviderHeaders = Record<string, string | null>;
export type FetchFunction = typeof globalThis.fetch;
export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";
export type CacheRetention = "none" | "short" | "long";
export type ToolChoice = "auto" | "none";

export interface ProviderResponse {
	status: number;
	headers: Record<string, string>;
}

/** 请求相关的通用选项。 */
export interface StreamOptions {
	signal?: AbortSignal;
	apiKey?: string;
	fetch?: FetchFunction;
	env?: ProviderEnv;
	onPayload?: (payload: unknown, model: Model<Api>) => unknown | undefined | Promise<unknown | undefined>;
	onResponse?: (response: ProviderResponse, model: Model<Api>) => void | Promise<void>;
	headers?: ProviderHeaders;
	timeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
	temperature?: number;
	samplingParams?: Record<string, unknown>;
	maxTokens?: number;
	transport?: Transport;
	cacheRetention?: CacheRetention;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}

/** 统一思考档位与工具选择的简单请求选项。 */
export interface SimpleStreamOptions extends StreamOptions {
	toolChoice?: ToolChoice;
	reasoning?: ThinkingLevel;
	thinkingBudgets?: ThinkingBudgets;
}
