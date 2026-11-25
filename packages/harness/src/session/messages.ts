import type { AgentMessage } from "@pipi/agent";
import type { ImageContent, Message, TextContent } from "@pipi/llm";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

/** 扩展注入的消息：参与上下文，展示方式由 display 决定。 */
export interface CustomMessage<T = unknown> {
	role: "custom";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	display: boolean;
	details?: T;
	timestamp: number;
}

/** 压缩摘要消息：替代被裁剪的历史。 */
export interface CompactionSummaryMessage {
	role: "compactionSummary";
	summary: string;
	tokensBefore: number;
	timestamp: number;
}

declare module "@pipi/agent" {
	interface CustomAgentMessages {
		custom: CustomMessage;
		compactionSummary: CompactionSummaryMessage;
	}
}

export function createCustomMessage(
	customType: string,
	content: string | (TextContent | ImageContent)[],
	display: boolean,
	details: unknown | undefined,
	timestamp: string,
): CustomMessage {
	return { role: "custom", customType, content, display, details, timestamp: new Date(timestamp).getTime() };
}

export function createCompactionSummaryMessage(
	summary: string,
	tokensBefore: number,
	timestamp: string,
): CompactionSummaryMessage {
	return { role: "compactionSummary", summary, tokensBefore, timestamp: new Date(timestamp).getTime() };
}

/** 把内部消息（含自定义角色）转成 LLM 能接收的消息。 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
	const result: Message[] = [];
	for (const message of messages) {
		switch (message.role) {
			case "custom": {
				const content =
					typeof message.content === "string"
						? [{ type: "text" as const, text: message.content }]
						: message.content;
				result.push({ role: "user", content, timestamp: message.timestamp });
				break;
			}
			case "compactionSummary":
				result.push({
					role: "user",
					content: [
						{
							type: "text",
							text: COMPACTION_SUMMARY_PREFIX + message.summary + COMPACTION_SUMMARY_SUFFIX,
						},
					],
					timestamp: message.timestamp,
				});
				break;
			case "user":
			case "assistant":
			case "toolResult":
				result.push(message);
				break;
		}
	}
	return result;
}
