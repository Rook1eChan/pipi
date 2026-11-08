import type { AssistantMessage, Context, ImageContent, Message, TextContent, Tool, Usage } from "../types.ts";

/** context 用量的估算结果。 */
export interface ContextUsageEstimate {
	tokens: number; // 估算的总 token 数
	usageTokens: number; // 最近一条 assistant usage
	trailingTokens: number; // 之后新增内容的估算 token 数
	lastUsageIndex: number | null; // 最近一条 assistant usage 的消息下标
}

// 4字符估算为1token
const CHARS_PER_TOKEN = 4;
// 一张图像估算为4800token
const ESTIMATED_IMAGE_CHARS = 4800;

/** 根据usage计算token。 */
export function getUsageTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "undefined";
	} catch {
		return "[unserializable]";
	}
}

// 计算text和image的字符数
function estimateTextAndImageContentChars(content: string | Array<TextContent | ImageContent>): number {
	if (typeof content === "string") return content.length;

	let chars = 0;
	for (const block of content) chars += block.type === "text" ? block.text.length : ESTIMATED_IMAGE_CHARS;
	return chars;
}

/** 按字符数估算文本 token。 */
export function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 按字符数估算text与image的 token。 */
export function estimateTextAndImageContentTokens(content: string | Array<TextContent | ImageContent>): number {
	return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
}

/** 估算单条消息的 token。 */
export function estimateMessageTokens(message: Message): number {
	if (message.role === "user" || message.role === "toolResult") {
		return estimateTextAndImageContentTokens(message.content);
	}

	let chars = 0;
	for (const block of message.content) {
		if (block.type === "text") {
			chars += block.text.length;
		} else if (block.type === "thinking") {
			chars += block.thinking.length;
		} else {
			chars += block.name.length + safeJsonStringify(block.arguments).length;
		}
	}
	return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * 找最近一条能代表当前前缀的 assistant usage。
 *
 * 只有时间戳不早于已知最新前缀、且不是中止或错误的回复才可用；
 * 中止和失败的回复没有完整消耗，不能作为基线。
 */
function getLastAssistantUsageInfo(messages: readonly Message[]): { usage: Usage; index: number } | undefined {
	let latestPrefixTimestamp = Number.NEGATIVE_INFINITY;
	let usageInfo: { usage: Usage; index: number } | undefined;

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role === "assistant") {
			const assistant = message as AssistantMessage;
			const usageAppliesToPrefix = assistant.timestamp >= latestPrefixTimestamp;
			if (
				usageAppliesToPrefix &&
				assistant.stopReason !== "aborted" &&
				assistant.stopReason !== "error" &&
				getUsageTokens(assistant.usage) > 0
			) {
				usageInfo = { usage: assistant.usage, index };
			}
		}
		latestPrefixTimestamp = Math.max(latestPrefixTimestamp, message.timestamp);
	}

	return usageInfo;
}

// 估算message列表的token。找usage基线，计算剩余message的token；否则全量计算
function estimateMessages(messages: readonly Message[]): ContextUsageEstimate {
	// 先找usage基线
	const usageInfo = getLastAssistantUsageInfo(messages);
	if (usageInfo) {
		const usageTokens = getUsageTokens(usageInfo.usage);
		let trailingTokens = 0;
		for (let index = usageInfo.index + 1; index < messages.length; index++) {
			trailingTokens += estimateMessageTokens(messages[index]);
		}
		return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: usageInfo.index };
	}

	let tokens = 0;
	for (const message of messages) tokens += estimateMessageTokens(message);
	return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}

function estimateToolsTokens(tools: readonly Tool[] | undefined): number {
	if (!tools || tools.length === 0) return 0;
	return estimateTextTokens(safeJsonStringify(tools));
}

function isMessageArray(value: Context | readonly Message[]): value is readonly Message[] {
	return Array.isArray(value);
}

/**
 * 估算一次请求的 token 大小。
 *
 * 优先复用最近一条 assistant usage 作为基线，只估算其后的新增消息；
 * 没有可用基线时逐条估算消息，再加上 system prompt 与工具声明。
 */
export function estimateContextTokens(context: Context | readonly Message[]): ContextUsageEstimate {
	// Message[]直接计算
	if (isMessageArray(context)) return estimateMessages(context);

	// context先计算context.messages
	const estimate = estimateMessages(context.messages);

	/* 有usage基线，则systemPrompt已计算。需要计算lastUsageIndex之后新增的tools。
    tools放在context.tools，不在消息里 */
	if (estimate.lastUsageIndex !== null) {
		const addedNames = new Set(
			context.messages
				.slice(estimate.lastUsageIndex + 1)
				.filter((message) => message.role === "toolResult")
				.flatMap((message) => message.addedToolNames ?? []),
		);
		const addedToolTokens = estimateToolsTokens(context.tools?.filter((tool) => addedNames.has(tool.name)));
		return {
			tokens: estimate.tokens + addedToolTokens,
			usageTokens: estimate.usageTokens,
			trailingTokens: estimate.trailingTokens + addedToolTokens,
			lastUsageIndex: estimate.lastUsageIndex,
		};
	}

	// 没有usage基线，只估算了message[]，需要加上systemPrompt和tool的token
	const prefixTokens =
		(context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0) + estimateToolsTokens(context.tools);

	return {
		tokens: estimate.tokens + prefixTokens,
		usageTokens: estimate.usageTokens,
		trailingTokens: estimate.trailingTokens + prefixTokens,
		lastUsageIndex: estimate.lastUsageIndex,
	};
}
