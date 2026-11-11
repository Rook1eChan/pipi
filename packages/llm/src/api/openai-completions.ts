// openai-chat-completions 协议

import { calculateCost, clampThinkingLevel } from "../models.ts";
import type {
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	OpenAICompletionsCompat,
	OpenAICompletionsOptions,
	SimpleStreamOptions,
	StopReason,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	Usage,
	UserMessage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { parseStreamingJson } from "../utils/json-parse.ts";
import { buildBaseOptions } from "./simple-options.ts";

/** OpenAI Chat Completions 的文本内容块。 */
export interface ChatContentPartText {
	type: "text";
	text: string;
}

/** OpenAI Chat Completions 的图片内容块。data 使用 base64 data URL。 */
export interface ChatContentPartImage {
	type: "image_url";
	image_url: { url: string };
}

export type ChatContentPart = ChatContentPartText | ChatContentPartImage;

/** OpenAI Chat Completions 的工具调用。 */
export interface ChatToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

/** 发给 OpenAI Chat Completions 的消息。 */
export interface ChatCompletionMessage {
	role: "system" | "developer" | "user" | "assistant" | "tool";
	content: string | ChatContentPart[] | null;
	tool_calls?: ChatToolCall[];
	tool_call_id?: string;
	name?: string;
	// 下面三字段都表示思考文本，不同openai-like的断点的命名不同
	// 解析时按顺序取第一个非空值
	reasoning_content?: string;
	reasoning?: string;
	reasoning_text?: string;
}

/** OpenAI Chat Completions 的工具声明。 */
export interface ChatCompletionTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
		strict?: boolean;
	};
}

/** 补齐默认值后的 compat。 */
export type ResolvedOpenAICompletionsCompat = Required<OpenAICompletionsCompat>;

const DEFAULT_COMPAT: ResolvedOpenAICompletionsCompat = {
	supportsStore: true,
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	supportsFinishReason: true,
	maxTokensField: "max_completion_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
	thinkingFormat: "openai",
	supportsStrictMode: true,
};

/** 用默认值补齐模型上的 compat 覆盖项。 */
export function resolveCompat(compat?: OpenAICompletionsCompat): ResolvedOpenAICompletionsCompat {
	return { ...DEFAULT_COMPAT, ...compat };
}

/** 移除不成对的 UTF-16 代理项，避免 JSON 序列化后产生非法字符。 */
export function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// 模型不支持image时，user message中image的占位符
const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

/** 模型不支持图片，把图片替换成占位文本，相邻图片只保留一个占位。 */
function downgradeImages(content: (TextContent | ImageContent)[], placeholder: string): TextContent[] {
	const result: TextContent[] = [];
	let previousWasPlaceholder = false;

	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) result.push({ type: "text", text: placeholder });
			previousWasPlaceholder = true;
			continue;
		}

		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}

	return result;
}

function isTextBlock(block: AssistantMessage["content"][number]): block is TextContent {
	return block.type === "text";
}

function isThinkingBlock(block: AssistantMessage["content"][number]): block is ThinkingContent {
	return block.type === "thinking";
}

function isToolCallBlock(block: AssistantMessage["content"][number]): block is ToolCall {
	return block.type === "toolCall";
}

function imageUrl(block: ImageContent): string {
	return `data:${block.mimeType};base64,${block.data}`;
}

/** 支持回放的思考字段名。 */
function isReasoningField(value: string): value is "reasoning_content" | "reasoning" | "reasoning_text" {
	return value === "reasoning_content" || value === "reasoning" || value === "reasoning_text";
}

/** 把工具参数转成 OpenAI 要求的 JSON 字符串。 */
function convertToolCall(toolCall: ToolCall): ChatToolCall {
	return {
		id: toolCall.id,
		type: "function",
		function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
	};
}

// 转换user message
function convertUserMessage(message: UserMessage, supportsImages: boolean): ChatCompletionMessage {
	// 纯文字
	if (typeof message.content === "string") {
		return { role: "user", content: sanitizeSurrogates(message.content) };
	}

	// message.content 是content数组时
	const content: ChatContentPart[] = [];
	const blocks = supportsImages
		? message.content
		: downgradeImages(message.content, NON_VISION_USER_IMAGE_PLACEHOLDER);
	for (const block of blocks) {
		if (block.type === "text") {
			content.push({ type: "text", text: sanitizeSurrogates(block.text) });
		} else {
			content.push({ type: "image_url", image_url: { url: imageUrl(block) } });
		}
	}
	return { role: "user", content };
}

/**
 * 转换assistant message
 *
 * 思考内容按 compat 处理：转成普通文本、写入专门的字段，或直接丢弃。
 * 没有正文也没有工具调用的消息会被跳过。
 */
function convertAssistantMessage(
	model: Model,
	message: AssistantMessage,
	compat: ResolvedOpenAICompletionsCompat,
): ChatCompletionMessage | undefined {
	// 取出正文部分
	const text = message.content
		.filter(isTextBlock)
		.map((block) => block.text)
		.filter((value) => value.trim().length > 0)
		.map(sanitizeSurrogates)
		.join("");
	// 取出思考部分
	const thinkingBlocks = message.content.filter(isThinkingBlock).filter((block) => block.thinking.trim().length > 0);
	// 取出工具调用部分
	const toolCalls = message.content.filter(isToolCallBlock).map(convertToolCall);

	const assistant: ChatCompletionMessage = { role: "assistant", content: null };

	// 如果把思考部分当作普通文本
	if (thinkingBlocks.length > 0 && compat.requiresThinkingAsText) {
		const thinkingText = thinkingBlocks.map((block) => sanitizeSurrogates(block.thinking)).join("\n\n");
		assistant.content = [
			{ type: "text", text: thinkingText },
			...(text.length > 0 ? [{ type: "text" as const, text }] : []), // 加入正文部分
		];
	} else {
		// 如果把思考部分当作一个字段
		if (text.length > 0) assistant.content = text;
		if (thinkingBlocks.length > 0) {
			const signature = thinkingBlocks[0].thinkingSignature;
			// 确定字段的名称，先根据signature，再看thinkingFormat，否则思考为空
			const field =
				signature && isReasoningField(signature)
					? signature
					: compat.thinkingFormat === "deepseek"
						? "reasoning_content"
						: undefined;
			if (field) assistant[field] = thinkingBlocks.map((block) => block.thinking).join("\n");
		}
	}

	// 模型要求 reasoning_content 不为空
	if (
		compat.requiresReasoningContentOnAssistantMessages &&
		model.reasoning &&
		assistant.reasoning_content === undefined
	) {
		assistant.reasoning_content = "";
	}

	if (toolCalls.length > 0) assistant.tool_calls = toolCalls;

	if (assistant.content === null && assistant.tool_calls === undefined) return undefined;
	return assistant;
}

/** 工具结果只保留文本；图片单独作为一条 user 消息附加在后。 */
function convertToolResultMessages(
	model: Model,
	messages: readonly Message[],
	startIndex: number,
	compat: ResolvedOpenAICompletionsCompat,
): {
	params: ChatCompletionMessage[];
	nextIndex: number;
	hasImages: boolean;
} {
	const params: ChatCompletionMessage[] = [];
	const imageParts: ChatContentPartImage[] = [];
	let index = startIndex;

	// 处理连续的 toolResult
	for (; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== "toolResult") break;

		const blocks = model.input.includes("image")
			? message.content
			: downgradeImages(message.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER); // 模型不支持图片时使用占位符

		// 拆出text和image
		const text = blocks
			.filter((block): block is TextContent => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const images = blocks.filter((block): block is ImageContent => block.type === "image");
		// 构造content
		const content = text.length > 0 ? text : images.length > 0 ? "(see attached image)" : "(no tool output)";

		// 构造并 push tool 消息
		const toolMessage: ChatCompletionMessage = {
			role: "tool",
			content: sanitizeSurrogates(content),
			tool_call_id: message.toolCallId,
		};
		if (compat.requiresToolResultName && message.toolName) toolMessage.name = message.toolName;
		params.push(toolMessage);

		// 收集图片，不直接挂 tool 消息，因为 OpenAI 的 tool 消息只支持纯文本
		for (const image of images) imageParts.push({ type: "image_url", image_url: { url: imageUrl(image) } });
	}

	// toolresult的图片当作一个user
	if (imageParts.length > 0) {
		if (compat.requiresAssistantAfterToolResult) {
			params.push({ role: "assistant", content: "I have processed the tool results." });
		}
		params.push({
			role: "user",
			content: [{ type: "text", text: "Attached image(s) from tool result:" }, ...imageParts],
		});
	}

	return { params, nextIndex: index - 1, hasImages: imageParts.length > 0 };
}

/**
 * 把统一的 Context 转成 OpenAI Chat Completions 的消息数组。
 *
 * 失败或中止的助手消息会被丢弃，避免把不完整内容回放给模型。
 */
export function convertMessages(
	model: Model,
	context: Context,
	compat: ResolvedOpenAICompletionsCompat,
): ChatCompletionMessage[] {
	const params: ChatCompletionMessage[] = [];

	// system prompt 在推理模型且端点支持时使用 developer 角色，否则使用 system。
	if (context.systemPrompt) {
		const role = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system";
		params.push({ role, content: sanitizeSurrogates(context.systemPrompt) }); // sanitizeSurrogates 移除不成对的 UTF-16 代理项
	}

	// 丢弃中断和出错的assistant message
	const messages = context.messages.filter(
		(message) => message.role !== "assistant" || (message.stopReason !== "aborted" && message.stopReason !== "error"),
	);
	const supportsImages = model.input.includes("image");

	let lastRole = "";
	// 逐条转换消息
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];

		// compat要求ToolResult后必须跟Assistant
		if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && message.role === "user") {
			params.push({ role: "assistant", content: "I have processed the tool results." });
		}

		// 转换user、assistant、toolresult三类消息
		if (message.role === "user") {
			params.push(convertUserMessage(message, supportsImages));
		} else if (message.role === "assistant") {
			const converted = convertAssistantMessage(model, message, compat);
			if (converted) params.push(converted);
		} else {
			// ToolResult往往多条连在一起，这里直接传入messages
			const converted = convertToolResultMessages(model, messages, index, compat);
			params.push(...converted.params);
			index = converted.nextIndex;
			lastRole = converted.hasImages ? "user" : "toolResult";
			continue;
		}

		lastRole = message.role;
	}

	return params;
}

const UNSUPPORTED_STRICT_SCHEMA_KEYS = [
	"$ref",
	"$defs",
	"definitions",
	"allOf",
	"oneOf",
	"patternProperties",
	"dependentSchemas",
	"dependencies",
	"unevaluatedProperties",
	"propertyNames",
	"contains",
	"prefixItems",
	"not",
	"if",
	"then",
	"else",
] as const;

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把 JSON Schema 转成 OpenAI strict 模式接受的形式。
 *
 * 对象必须显式列出全部 required 并禁止额外属性；数组递归处理 items。
 * 遇到 strict 不支持的组合子时抛错，由调用方决定是否降级。
 */
export function makeStrictJsonSchema(schema: unknown): Record<string, unknown> {
	if (!isJsonObject(schema)) throw new Error("boolean schemas are unsupported");

	// 不支持的键值
	for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
		if (schema[key] !== undefined) throw new Error(`${key} schemas are unsupported`);
	}

	const result: Record<string, unknown> = { ...schema };

	if (Array.isArray(schema.anyOf)) {
		result.anyOf = schema.anyOf.map((variant) => makeStrictJsonSchema(variant));
	}

	const isObjectSchema =
		schema.type === "object" ||
		(Array.isArray(schema.type) && schema.type.includes("object")) ||
		schema.properties !== undefined;

	if (isObjectSchema) {
		const properties = isJsonObject(schema.properties) ? schema.properties : {};
		const strictProperties: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(properties)) strictProperties[name] = makeStrictJsonSchema(value);
		result.properties = strictProperties;
		const required = Object.keys(strictProperties);
		if (required.length > 0) result.required = required;
		result.additionalProperties = false;
	}

	if (isJsonObject(schema.items)) result.items = makeStrictJsonSchema(schema.items);

	return result;
}

/**
 * 解析工具的 strict 策略。
 *
 * strict 只对声明了 json_schema 约束的工具启用；端点不支持时，
 * `strict: "require"` 直接报错，`strict: "prefer"` 降级为普通 function 工具。
 */
function resolveStrictSchema(
	tool: Tool,
	supportsStrictMode: boolean,
): { schema: Record<string, unknown>; strict: boolean } | undefined {
	const config = tool.constrainedSampling;
	// tool不需要strict或者strict类型不是json_schema，直接返回
	if (!config || config.type !== "json_schema") return undefined;

	if (!supportsStrictMode) {
		// 工具的strict标为require，但compat.supportsStrictMode==false，报错
		if (config.strict === "require") {
			throw new Error(
				`Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`,
			);
		}
		return undefined;
	}

	try {
		// 返回修改后的JSON Schema
		return { schema: makeStrictJsonSchema(tool.parameters), strict: true };
	} catch (error) {
		if (config.strict !== "require") return undefined;
		throw new Error(
			`Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error instanceof Error ? error.message : String(error)}.`,
		);
	}
}

/** 把tools转成 OpenAI function 格式 */
export function convertTools(tools: readonly Tool[], compat: ResolvedOpenAICompletionsCompat): ChatCompletionTool[] {
	const supportsStrictMode = compat.supportsStrictMode !== false;

	return tools.map((tool) => {
		const strict = resolveStrictSchema(tool, supportsStrictMode);
		return {
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: strict?.schema ?? (tool.parameters as Record<string, unknown>),
				...(strict ? { strict: strict.strict } : {}),
			},
		};
	});
}

/** 发给 Openai Chat Completions 的请求体。 */
export interface ChatCompletionRequest {
	model: string;
	messages: ChatCompletionMessage[];
	stream: true;
	stream_options?: { include_usage: boolean };
	store?: boolean;
	max_tokens?: number;
	max_completion_tokens?: number;
	temperature?: number;
	tools?: ChatCompletionTool[];
	tool_choice?: OpenAICompletionsOptions["toolChoice"];
	reasoning_effort?: string;
	thinking?: { type: "enabled" | "disabled" };
	[key: string]: unknown;
}

interface ChatCompletionToolCallDelta {
	index?: number;
	id?: string;
	type?: string;
	function?: { name?: string; arguments?: string };
}

interface ChatUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	cached_tokens?: number;
	prompt_cache_hit_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
	completion_tokens_details?: { reasoning_tokens?: number };
}

interface ChatCompletionChunk {
	id?: string;
	model?: string;
	usage?: ChatUsage;
	choices?: Array<{
		delta?: {
			content?: string | null;
			reasoning_content?: string | null;
			reasoning?: string | null;
			reasoning_text?: string | null;
			tool_calls?: ChatCompletionToolCallDelta[];
		};
		finish_reason?: string | null;
		usage?: ChatUsage;
	}>;
}

/** 流式累积中的 tool call，additional 字段只在本函数内使用。 */
interface StreamingToolCallBlock extends ToolCall {
	partialArgs?: string;
	streamIndex?: number;
}

/** 把 provider 的 usage 换算成统一 Usage，并计算费用。 */
function parseUsage(raw: ChatUsage, model: Model): Usage {
	const promptTokens = raw.prompt_tokens ?? 0;
	const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? raw.cached_tokens ?? 0;
	const cacheWrite = raw.prompt_tokens_details?.cache_write_tokens ?? 0;
	const input = Math.max(0, promptTokens - cacheRead - cacheWrite);
	const output = raw.completion_tokens ?? 0;

	const usage: Usage = {
		input,
		output,
		cacheRead,
		cacheWrite,
		reasoning: raw.completion_tokens_details?.reasoning_tokens ?? 0,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	calculateCost(model, usage);
	return usage;
}

/** 把 finish_reason 映射成统一 stopReason。 */
function mapStopReason(reason: string): { stopReason: StopReason; errorMessage?: string } {
	switch (reason) {
		case "stop":
		case "end":
			return { stopReason: "stop" };
		case "length":
			return { stopReason: "length" };
		case "function_call":
		case "tool_calls":
			return { stopReason: "toolUse" };
		case "content_filter":
			return { stopReason: "error", errorMessage: "Provider finish_reason: content_filter" };
		case "network_error":
			return { stopReason: "error", errorMessage: "Provider finish_reason: network_error" };
		default:
			return { stopReason: "error", errorMessage: `Provider finish_reason: ${reason}` };
	}
}

/** 按 compat 写入思考参数。当前覆盖 openai 与 deepseek 两种格式。 */
function applyThinkingParams(
	payload: ChatCompletionRequest,
	model: Model,
	options: OpenAICompletionsOptions | undefined,
	compat: ResolvedOpenAICompletionsCompat,
): void {
	if (!model.reasoning) return;
	const effort = options?.reasoningEffort;

	if (compat.thinkingFormat === "deepseek") {
		if (effort) {
			payload.thinking = { type: "enabled" };
		} else if (model.thinkingLevelMap?.off !== null) {
			payload.thinking = { type: "disabled" };
		}
		if (effort && compat.supportsReasoningEffort) {
			payload.reasoning_effort = model.thinkingLevelMap?.[effort] ?? effort;
		}
		return;
	}

	if (compat.thinkingFormat !== "openai" || !compat.supportsReasoningEffort) return;
	if (effort) {
		payload.reasoning_effort = model.thinkingLevelMap?.[effort] ?? effort;
	} else {
		const off = model.thinkingLevelMap?.off;
		if (typeof off === "string") payload.reasoning_effort = off;
	}
}

/** 组装请求体：消息、工具、输出上限与思考参数。 */
export function buildRequest(
	model: Model,
	context: Context,
	options?: OpenAICompletionsOptions,
	compat: ResolvedOpenAICompletionsCompat = resolveCompat(model.compat),
): ChatCompletionRequest {
	const payload: ChatCompletionRequest = {
		model: model.id,
		messages: convertMessages(model, context, compat),
		stream: true,
	};

	if (compat.supportsUsageInStreaming) payload.stream_options = { include_usage: true };
	if (compat.supportsStore) payload.store = false;

	if (options?.maxTokens !== undefined) {
		if (compat.maxTokensField === "max_tokens") payload.max_tokens = options.maxTokens;
		else payload.max_completion_tokens = options.maxTokens;
	}

	if (options?.temperature !== undefined) payload.temperature = options.temperature;
	if (context.tools && context.tools.length > 0) payload.tools = convertTools(context.tools, compat);
	if (options?.toolChoice !== undefined) payload.tool_choice = options.toolChoice;

	applyThinkingParams(payload, model, options, compat);

	if (options?.samplingParams) Object.assign(payload, options.samplingParams);

	return payload;
}

function createAssistantMessage(model: Model): AssistantMessage {
	const usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage,
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

function buildHeaders(model: Model, options?: OpenAICompletionsOptions): Record<string, string> {
	const merged: Record<string, string | null> = {
		"content-type": "application/json",
		accept: "text/event-stream",
		...model.headers,
		...options?.headers,
	};
	if (options?.apiKey) merged.authorization = `Bearer ${options.apiKey}`;

	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(merged)) {
		if (value !== null) headers[name] = value;
	}
	return headers;
}

/** 取 SSE 一帧里的 data 行进行拼接。 */
function parseFrameData(frame: string): string | undefined {
	const data = frame
		.split("\n") // 把多行数据分开
		.map((line) => (line.startsWith("data:") ? line.slice(5).trimStart() : undefined)) // 去掉data:空格
		.filter((line): line is string => line !== undefined) // 去掉空白行
		.join("\n"); // 回车连接
	return data.length > 0 ? data : undefined;
}

// 建立流接口并返回，发送请求，接收 SSE 并 push 到流接口
// 运行顺序：建立流、运行async函数，遇到第一个await退出，返回流
export function stream(
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();

	// IIFE，遇到第一个 await 退出
	void (async () => {
		// 唯一的输出消息，事件里的 partial 一直指向它
		const output = createAssistantMessage(model);

		try {
			// apiKey 已由 Models 层解析，这里只负责检查
			if (!options?.apiKey) throw new Error(`Provider is not configured: ${model.provider}`);

			// 补齐compat默认值
			const compat = resolveCompat(model.compat);
			let payload = buildRequest(model, context, options, compat);

			// hook，允许调用方在发送前改写请求体
			const nextPayload = await options?.onPayload?.(payload, model);
			if (nextPayload !== undefined) payload = nextPayload as ChatCompletionRequest;

			const fetchImpl = options?.fetch ?? globalThis.fetch; // globalThis.fetch是平台自带的网络请求函数
			const response = await fetchImpl(`${model.baseUrl}/chat/completions`, {
				method: "POST",
				headers: buildHeaders(model, options),
				body: JSON.stringify(payload),
				signal: options?.signal,
			});

			// hook，收到响应头、读取body前调用
			await options?.onResponse?.(
				{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
				model,
			);

			// 非 2xx 时把响应体带进错误，便于定位
			if (!response.ok) {
				const body = await response.text(); // 完整接收响应内容
				throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 500)}` : ""}`);
			}

			// 开始往调用方推流
			stream.push({ type: "start", partial: output });

			// 拿到body内容的获取器
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Response has no body");

			// 缓冲区保存跨读取的残帧；两个块变量记录当前正在累积的内容
			const decoder = new TextDecoder();
			let buffer = "";
			let textBlock: TextContent | null = null;
			let thinkingBlock: ThinkingContent | null = null;
			let finished = false;
			let hasFinishReason = false;
			// tool call 分片到达：首片带 id/name，后续片只带 index
			const toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
			const toolCallBlocksById = new Map<string, StreamingToolCallBlock>();

			// 单个 chunk 的处理：只累积并推送增量，不做收尾
			const handleChunk = (chunk: ChatCompletionChunk): void => {
				if (chunk.id) output.responseId ??= chunk.id; // ??=表示只有当左边的值是 null 或 undefined 时，才把右边的值赋给它
				if (chunk.model && chunk.model !== model.id) output.responseModel ??= chunk.model;

				// usage 可能出现在顶层，也可能出现在 choice 里（部分兼容端点）
				if (chunk.usage) output.usage = parseUsage(chunk.usage, model);

				const choice = chunk.choices?.[0];
				if (!choice) return;
				if (!chunk.usage && choice.usage) output.usage = parseUsage(choice.usage, model);

				// finish_reason 只出现一次，映射成统一 stopReason
				if (choice.finish_reason) {
					output.rawStopReason = choice.finish_reason;
					const mapped = mapStopReason(choice.finish_reason);
					output.stopReason = mapped.stopReason;
					if (mapped.errorMessage) output.errorMessage = mapped.errorMessage;
					hasFinishReason = true;
				}

				const delta = choice.delta;
				if (!delta) return;

				// 文本
				if (typeof delta.content === "string" && delta.content.length > 0) {
					// 第一次出现内容，建块并推 text_start
					if (!textBlock) {
						textBlock = { type: "text", text: "" };
						output.content.push(textBlock);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					}
					// 不是第一次，增加块里的内容
					textBlock.text += delta.content;
					stream.push({
						type: "text_delta",
						contentIndex: output.content.length - 1,
						delta: delta.content,
						partial: output,
					});
				}

				// 思考字段各家命名不同，按顺序取第一个非空值，避免同一段内容重复
				let reasoningField: "reasoning_content" | "reasoning" | "reasoning_text" | undefined;
				let reasoningValue: string | undefined;
				for (const field of ["reasoning_content", "reasoning", "reasoning_text"] as const) {
					const value = delta[field];
					if (typeof value === "string" && value.length > 0) {
						reasoningField = field;
						reasoningValue = value;
						break;
					}
				}

				// 思考：字段名记进 signature，供跨轮回放使用
				if (reasoningField && reasoningValue) {
					if (!thinkingBlock) {
						thinkingBlock = { type: "thinking", thinking: "", thinkingSignature: reasoningField };
						output.content.push(thinkingBlock);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					}
					thinkingBlock.thinking += reasoningValue;
					stream.push({
						type: "thinking_delta",
						contentIndex: output.content.length - 1,
						delta: reasoningValue,
						partial: output,
					});
				}

				// 工具调用：按 index 找块，找不到再按 id 找，都没有才新建
				for (const toolCall of delta.tool_calls ?? []) {
					const streamIndex = typeof toolCall.index === "number" ? toolCall.index : undefined;
					const name = toolCall.function?.name ?? "";
					let block = streamIndex !== undefined ? toolCallBlocksByIndex.get(streamIndex) : undefined;
					if (!block && toolCall.id) block = toolCallBlocksById.get(toolCall.id);

					if (!block) {
						block = {
							type: "toolCall",
							id: toolCall.id ?? "",
							name,
							arguments: {},
							partialArgs: "",
							streamIndex,
						};
						if (streamIndex !== undefined) toolCallBlocksByIndex.set(streamIndex, block);
						if (toolCall.id) toolCallBlocksById.set(toolCall.id, block);
						output.content.push(block);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}

					if (streamIndex !== undefined && block.streamIndex === undefined) {
						block.streamIndex = streamIndex;
						toolCallBlocksByIndex.set(streamIndex, block);
					}
					if (toolCall.id) toolCallBlocksById.set(toolCall.id, block);
					if (!block.name && name) block.name = name;

					const args = toolCall.function?.arguments;
					if (args) {
						block.partialArgs = (block.partialArgs ?? "") + args;
						block.arguments = parseStreamingJson(block.partialArgs);
						stream.push({
							type: "toolcall_delta",
							contentIndex: output.content.indexOf(block),
							delta: args,
							partial: output,
						});
					}
				}
			};

			// 读到 [DONE] 或连接关闭（done）为止；一次读取可能包含多帧，也可能只有半帧
			while (!finished) {
				const { value, done } = await reader.read(); // 读出字节
				if (done) break; // done=true表示流关闭
				buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n"); // 加入buffer

				// 按空行切帧，残帧留在 buffer 里等下次读取
				while (true) {
					const frameEnd = buffer.indexOf("\n\n");
					if (frameEnd === -1) break;
					const frame = buffer.slice(0, frameEnd);
					buffer = buffer.slice(frameEnd + 2);
					const data = parseFrameData(frame); // 取出一帧内的数据（一个ChatCompletionChunk）
					if (data === undefined) continue;
					if (data === "[DONE]") {
						finished = true;
						break;
					}
					handleChunk(JSON.parse(data) as ChatCompletionChunk); // 把帧转为事件推出去
				}
			}

			// 有些端点不发 [DONE]，关闭连接时 buffer 里可能还剩最后一帧
			if (!finished && buffer.trim().length > 0) {
				const data = parseFrameData(buffer.replace(/\r\n/g, "\n"));
				if (data && data !== "[DONE]") handleChunk(JSON.parse(data) as ChatCompletionChunk);
			}

			// 循环结束后兜底
			if (options?.signal?.aborted) throw new Error("Request was aborted");

			// 按内容块顺序补结束事件，闭合每个块
			for (let index = 0; index < output.content.length; index++) {
				const block = output.content[index];
				if (block.type === "text") {
					stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
				} else if (block.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: output });
				} else {
					// 工具参数做最后一次完整解析，并清掉仅用于累积的临时字段
					const toolBlock = block as StreamingToolCallBlock;
					toolBlock.arguments = parseStreamingJson(toolBlock.partialArgs);
					delete toolBlock.partialArgs;
					delete toolBlock.streamIndex;
					stream.push({ type: "toolcall_end", contentIndex: index, toolCall: toolBlock, partial: output });
				}
			}

			// 有些端点不返回 finish_reason，按内容推断
			if (!hasFinishReason && !compat.supportsFinishReason) {
				output.stopReason = output.content.some((block) => block.type === "toolCall") ? "toolUse" : "stop";
			}
			if (output.stopReason === "error") {
				throw new Error(output.errorMessage ?? "Provider returned an error stop reason");
			}
			if ((compat.supportsFinishReason && !hasFinishReason) || output.stopReason === "pending") {
				throw new Error("Stream ended without finish_reason");
			}

			// 收尾并关闭流，此后不再有事件
			const reason = output.stopReason;
			if (reason !== "stop" && reason !== "length" && reason !== "toolUse") {
				throw new Error("Stream ended without finish_reason");
			}
			stream.push({ type: "done", reason, message: output });
			stream.end();
		} catch (error) {
			// sig 传入 fentch，中途的abort由底层流中断并抛出error。
			// 中止和失败都通过 error 事件表达，result() 不会 reject
			output.stopReason = options?.signal?.aborted ? "aborted" : "error"; // 根据sig给出stopReason
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

/** 把统一请求选项翻译成原生选项后交给 stream。 */
export function streamSimple(
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const base = buildBaseOptions(model, context, options, options?.apiKey);
	const clamped = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	const reasoningEffort = clamped === "off" ? undefined : clamped;

	return stream(model, context, {
		...base,
		toolChoice: options?.toolChoice,
		reasoningEffort,
	});
}
