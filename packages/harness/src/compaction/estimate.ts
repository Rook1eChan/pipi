import type { AgentMessage } from "@pipi/agent";
import type { Usage } from "@pipi/llm";
import { getUsageTokens } from "@pipi/llm";
import { entryToContextMessages } from "../session/context.ts";
import type { SessionEntry } from "../session/types.ts";
import type { CompactionSettings, ContextUsageEstimate } from "./types.ts";

const CHARS_PER_TOKEN = 4;
const ESTIMATED_IMAGE_CHARS = 4800;

/** 从 usage 计算上下文 token；优先用 totalTokens。 */
export function calculateContextTokens(usage: Usage): number {
	return getUsageTokens(usage);
}

function getAssistantUsage(message: AgentMessage): Usage | undefined {
	if (message.role !== "assistant") return undefined;
	const assistant = message as {
		stopReason?: string;
		usage?: Usage;
	};
	if (!assistant.usage) return undefined;
	if (assistant.stopReason === "aborted" || assistant.stopReason === "error") return undefined;
	return calculateContextTokens(assistant.usage) > 0 ? assistant.usage : undefined;
}

/** 从条目路径里找最后一条有效 assistant usage。 */
export function getLastAssistantUsage(entries: SessionEntry[]): Usage | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		for (const message of entryToContextMessages(entries[index]).reverse()) {
			const usage = getAssistantUsage(message);
			if (usage) return usage;
		}
	}
	return undefined;
}

function getLastAssistantUsageInfo(messages: AgentMessage[]): { usage: Usage; index: number } | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const usage = getAssistantUsage(messages[index]);
		if (usage) return { usage, index };
	}
	return undefined;
}

function estimateTextAndImageContentChars(content: string | Array<{ type: string; text?: string }>): number {
	if (typeof content === "string") return content.length;

	let chars = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) chars += block.text.length;
		else if (block.type === "image") chars += ESTIMATED_IMAGE_CHARS;
	}
	return chars;
}

/** 估算单条消息的 token；字符数除以 4，故意偏大。 */
export function estimateTokens(message: AgentMessage): number {
	let chars = 0;

	switch (message.role) {
		case "user": {
			const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
			return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
		}
		case "assistant": {
			const assistant = message as {
				content: Array<{ type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }>;
			};
			for (const block of assistant.content) {
				if (block.type === "text") chars += block.text?.length ?? 0;
				else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
				else if (block.type === "toolCall") {
					chars += (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? {}).length;
				}
			}
			return Math.ceil(chars / CHARS_PER_TOKEN);
		}
		case "custom":
		case "toolResult": {
			const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
			return Math.ceil(estimateTextAndImageContentChars(content) / CHARS_PER_TOKEN);
		}
		case "branchSummary":
		case "compactionSummary": {
			const summary = message as { summary: string };
			return Math.ceil(summary.summary.length / CHARS_PER_TOKEN);
		}
	}

	return 0;
}

/** 复用最后一条有效 usage，只估算它之后的消息。 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
	const usageInfo = getLastAssistantUsageInfo(messages);

	if (!usageInfo) {
		let estimated = 0;
		for (const message of messages) estimated += estimateTokens(message);
		return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null };
	}

	const usageTokens = calculateContextTokens(usageInfo.usage);
	let trailingTokens = 0;
	for (let index = usageInfo.index + 1; index < messages.length; index++) {
		trailingTokens += estimateTokens(messages[index]);
	}

	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
}

/** 上下文是否达到压缩阈值。 */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}
