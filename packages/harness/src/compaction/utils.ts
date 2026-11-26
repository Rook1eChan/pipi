import type { AgentMessage } from "@pipi/agent";
import type { Message } from "@pipi/llm";

/** 摘要中累计的文件操作。 */
export interface FileOperations {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}

export function createFileOps(): FileOperations {
	return { read: new Set(), written: new Set(), edited: new Set() };
}

/** 从 assistant 的工具调用里提取 read / write / edit 路径。 */
export function extractFileOpsFromMessage(message: AgentMessage, fileOps: FileOperations): void {
	if (message.role !== "assistant") return;
	if (!("content" in message) || !Array.isArray(message.content)) return;

	for (const block of message.content) {
		if (typeof block !== "object" || block === null) continue;
		if (!("type" in block) || block.type !== "toolCall") continue;
		if (!("arguments" in block) || !("name" in block)) continue;

		const args = block.arguments as Record<string, unknown> | undefined;
		const path = typeof args?.path === "string" ? args.path : undefined;
		if (!path) continue;

		switch (block.name) {
			case "read":
				fileOps.read.add(path);
				break;
			case "write":
				fileOps.written.add(path);
				break;
			case "edit":
				fileOps.edited.add(path);
				break;
		}
	}
}

/** 从已有摘要条目的 details 继承文件清单；扩展生成的摘要不继承。 */
export function extractFileOpsFromSummary(
	summary: { fromHook?: boolean; details?: unknown },
	fileOps: FileOperations,
): void {
	if (summary.fromHook || !summary.details) return;
	const { readFiles, modifiedFiles } = summary.details as {
		readFiles?: unknown;
		modifiedFiles?: unknown;
	};
	if (Array.isArray(readFiles)) {
		for (const file of readFiles) fileOps.read.add(file as string);
	}
	if (Array.isArray(modifiedFiles)) {
		for (const file of modifiedFiles) fileOps.edited.add(file as string);
	}
}

/** 计算最终文件清单：只读文件与修改文件。 */
export function computeFileLists(fileOps: FileOperations): {
	readFiles: string[];
	modifiedFiles: string[];
} {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readOnly = [...fileOps.read].filter((file) => !modified.has(file)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles: readOnly, modifiedFiles };
}

/** 把文件清单格式化成摘要末尾的 XML 段。 */
export function formatFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}
	if (sections.length === 0) return "";
	return `\n\n${sections.join("\n\n")}`;
}

const TOOL_RESULT_MAX_CHARS = 2000;

function truncateForSummary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const truncatedChars = text.length - maxChars;
	return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/** 提取内容块里的纯文本。 */
export function contentText(content: string | ReadonlyArray<{ type: string; text?: string }>, fallback = ""): string {
	if (typeof content === "string") return content || fallback;
	const text = content
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("");
	return text || fallback;
}

/** 把对话序列化成纯文本，避免模型把摘要请求当成继续对话。 */
export function serializeConversation(messages: Message[]): string {
	const parts: string[] = [];

	for (const message of messages) {
		if (message.role === "user") {
			const text = contentText(message.content);
			if (text) parts.push(`[User]: ${text}`);
		} else if (message.role === "assistant") {
			const thinkingParts: string[] = [];
			const toolCalls: string[] = [];

			for (const block of message.content) {
				if (block.type === "thinking") {
					thinkingParts.push(block.thinking);
				} else if (block.type === "toolCall") {
					const args = block.arguments as Record<string, unknown>;
					const argsText = Object.entries(args)
						.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
						.join(", ");
					toolCalls.push(`${block.name}(${argsText})`);
				}
			}

			if (thinkingParts.length > 0) {
				parts.push(`[Assistant thinking]: ${thinkingParts.join("\n")}`);
			}
			if (message.content.some((block) => block.type === "text")) {
				parts.push(`[Assistant]: ${contentText(message.content)}`);
			}
			if (toolCalls.length > 0) {
				parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
			}
		} else if (message.role === "toolResult") {
			const text = contentText(message.content);
			if (text) {
				parts.push(`[Tool result]: ${truncateForSummary(text, TOOL_RESULT_MAX_CHARS)}`);
			}
		}
	}

	return parts.join("\n\n");
}

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;
