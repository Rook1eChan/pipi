import type {
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	OpenAICompletionsCompat,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	UserMessage,
} from "../types.ts";

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

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

/** 不支持图片的模型把图片替换成占位文本，相邻图片只保留一个占位。 */
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

function convertUserMessage(message: UserMessage, supportsImages: boolean): ChatCompletionMessage {
	if (typeof message.content === "string") {
		return { role: "user", content: sanitizeSurrogates(message.content) };
	}

	const content: ChatContentPart[] = [];
	for (const block of supportsImages
		? message.content
		: downgradeImages(message.content, NON_VISION_USER_IMAGE_PLACEHOLDER)) {
		if (block.type === "text") {
			content.push({ type: "text", text: sanitizeSurrogates(block.text) });
		} else {
			content.push({ type: "image_url", image_url: { url: imageUrl(block) } });
		}
	}
	return { role: "user", content };
}

/**
 * 把助手消息转成 OpenAI 格式。
 *
 * 思考内容按 compat 处理：转成普通文本、写入可回放的思考字段，或直接丢弃。
 * 没有正文也没有工具调用的消息会被跳过。
 */
function convertAssistantMessage(
	model: Model,
	message: AssistantMessage,
	compat: ResolvedOpenAICompletionsCompat,
): ChatCompletionMessage | undefined {
	const text = message.content
		.filter(isTextBlock)
		.map((block) => block.text)
		.filter((value) => value.trim().length > 0)
		.map(sanitizeSurrogates)
		.join("");
	const thinkingBlocks = message.content.filter(isThinkingBlock).filter((block) => block.thinking.trim().length > 0);
	const toolCalls = message.content.filter(isToolCallBlock).map(convertToolCall);

	const assistant: ChatCompletionMessage = { role: "assistant", content: null };

	if (thinkingBlocks.length > 0 && compat.requiresThinkingAsText) {
		const thinkingText = thinkingBlocks.map((block) => sanitizeSurrogates(block.thinking)).join("\n\n");
		assistant.content = [
			{ type: "text", text: thinkingText },
			...(text.length > 0 ? [{ type: "text" as const, text }] : []),
		];
	} else {
		if (text.length > 0) assistant.content = text;
		if (thinkingBlocks.length > 0) {
			const signature = thinkingBlocks[0].thinkingSignature;
			const field =
				signature && isReasoningField(signature)
					? signature
					: compat.thinkingFormat === "deepseek"
						? "reasoning_content"
						: undefined;
			if (field) assistant[field] = thinkingBlocks.map((block) => block.thinking).join("\n");
		}
	}

	if (toolCalls.length > 0) assistant.tool_calls = toolCalls;

	if (
		compat.requiresReasoningContentOnAssistantMessages &&
		model.reasoning &&
		assistant.reasoning_content === undefined
	) {
		assistant.reasoning_content = "";
	}

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

	for (; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== "toolResult") break;
		const blocks = model.input.includes("image")
			? message.content
			: downgradeImages(message.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER);
		const text = blocks
			.filter((block): block is TextContent => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const images = blocks.filter((block): block is ImageContent => block.type === "image");
		const content = text.length > 0 ? text : images.length > 0 ? "(see attached image)" : "(no tool output)";

		const toolMessage: ChatCompletionMessage = {
			role: "tool",
			content: sanitizeSurrogates(content),
			tool_call_id: message.toolCallId,
		};
		if (compat.requiresToolResultName && message.toolName) toolMessage.name = message.toolName;
		params.push(toolMessage);

		for (const image of images) imageParts.push({ type: "image_url", image_url: { url: imageUrl(image) } });
	}

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
 * 把统一 Context 转成 OpenAI Chat Completions 的消息数组。
 *
 * system prompt 在推理模型且端点支持时使用 developer 角色，否则使用 system。
 * 失败或中止的助手消息会被丢弃，避免把不完整内容回放给模型。
 */
export function convertMessages(
	model: Model,
	context: Context,
	compat: ResolvedOpenAICompletionsCompat,
): ChatCompletionMessage[] {
	const params: ChatCompletionMessage[] = [];

	if (context.systemPrompt) {
		const role = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system";
		params.push({ role, content: sanitizeSurrogates(context.systemPrompt) });
	}

	const messages = context.messages.filter(
		(message) => message.role !== "assistant" || (message.stopReason !== "aborted" && message.stopReason !== "error"),
	);
	const supportsImages = model.input.includes("image");

	let lastRole = "";
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];

		if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && message.role === "user") {
			params.push({ role: "assistant", content: "I have processed the tool results." });
		}

		if (message.role === "user") {
			params.push(convertUserMessage(message, supportsImages));
		} else if (message.role === "assistant") {
			const converted = convertAssistantMessage(model, message, compat);
			if (converted) params.push(converted);
		} else {
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
 * 解析工具的 strict 设置。
 *
 * strict 只对声明了 json_schema 约束的工具启用；端点不支持时，
 * `strict: "require"` 直接报错，`strict: "prefer"` 降级为普通 function 工具。
 */
function resolveStrictSchema(
	tool: Tool,
	supportsStrictMode: boolean,
): { schema: Record<string, unknown>; strict: boolean } | undefined {
	const config = tool.constrainedSampling;
	if (!config || config.type !== "json_schema") return undefined;

	if (!supportsStrictMode) {
		if (config.strict === "require") {
			throw new Error(
				`Tool "${tool.name}" requires JSON-schema constrained sampling, but strict tools are unsupported.`,
			);
		}
		return undefined;
	}

	try {
		return { schema: makeStrictJsonSchema(tool.parameters), strict: true };
	} catch (error) {
		if (config.strict !== "require") return undefined;
		throw new Error(
			`Tool "${tool.name}" requires JSON-schema constrained sampling, but ${error instanceof Error ? error.message : String(error)}.`,
		);
	}
}

/** 把工具声明转成 OpenAI function schema。 */
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
