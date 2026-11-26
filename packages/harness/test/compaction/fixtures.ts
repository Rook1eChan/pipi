import type { AgentMessage, StreamFn } from "@pipi/agent";
import type { AssistantMessage, Model, SimpleStreamOptions, ToolCall, Usage } from "@pipi/llm";
import { AssistantMessageEventStream } from "@pipi/llm";
import type { SessionEntry, SessionMessageEntry } from "../../src/session/types.ts";

export function usage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function userMessage(text: string, timestamp = 1): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

export function assistantMessage(
	text: string,
	options: {
		timestamp?: number;
		usage?: Usage;
		stopReason?: AssistantMessage["stopReason"];
		toolCalls?: ToolCall[];
	} = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }, ...(options.toolCalls ?? [])],
		api: "openai-completions",
		provider: "faux",
		model: "faux-model",
		usage: options.usage ?? usage(10),
		stopReason: options.stopReason ?? "stop",
		timestamp: options.timestamp ?? 2,
	};
}

export function messageEntry(
	id: string,
	message: AgentMessage,
	parentId: string | null,
	timestamp = "2026-01-01T00:00:00.000Z",
): SessionMessageEntry {
	return { type: "message", id, parentId, timestamp, message };
}

export function model(overrides: Partial<Model> = {}): Model {
	return {
		id: "faux-model",
		name: "Faux Model",
		api: "openai-completions",
		provider: "faux",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		...overrides,
	};
}

/** 按顺序返回预设消息的 stream 函数。 */
export function streamFrom(messages: AssistantMessage[]): StreamFn {
	let index = 0;
	return (_model, _context, _options?: SimpleStreamOptions) => {
		const message = messages[index++];
		if (!message) throw new Error("No more fake responses");
		const stream = new AssistantMessageEventStream();
		stream.end(message);
		return stream;
	};
}

export function entryPathOf(entries: SessionEntry[]): SessionEntry[] {
	return entries;
}
