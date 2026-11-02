import type {
	AssistantMessage,
	DeferredHandle,
	ImageContent,
	Message,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "@pipi/llm";
import { describe, expect, it } from "vitest";

const usage: Usage = {
	input: 10,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 15,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const image: ImageContent = {
	type: "image",
	data: "aGVsbG8=",
	mimeType: "image/png",
};

const deferredHandle: DeferredHandle = {
	provider: "openai",
	modelId: "test-model",
	api: "openai-responses",
	id: "resp_1",
	expiresAt: 123,
};

const user: UserMessage = {
	role: "user",
	content: "read src/a.ts",
	timestamp: 1,
};

const assistant: AssistantMessage = {
	role: "assistant",
	content: [
		{ type: "thinking", thinking: "need to read the file" },
		{ type: "text", text: "let me check" },
		{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/a.ts" } },
	],
	api: "openai-completions",
	provider: "openai",
	model: "test-model",
	usage,
	stopReason: "toolUse",
	timestamp: 2,
};

const toolResult: ToolResultMessage = {
	role: "toolResult",
	toolCallId: "call_1",
	toolName: "read",
	content: [{ type: "text", text: "export const a = 1;" }],
	isError: false,
	timestamp: 3,
};

describe("message types", () => {
	it("survives JSON serialization", () => {
		const messages: Message[] = [user, assistant, toolResult];
		const roundTrip = JSON.parse(JSON.stringify(messages)) as Message[];

		expect(roundTrip).toHaveLength(3);
		expect(roundTrip[0].role).toBe("user");
		expect(roundTrip[1].role).toBe("assistant");
		expect(roundTrip[2].role).toBe("toolResult");
	});

	it("serializes images and deferred handles", () => {
		const payload = { image, deferredHandle };
		expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
	});

	it("keeps tool calls paired with their results", () => {
		const call = assistant.content.find((block) => block.type === "toolCall");
		expect(call?.id).toBe(toolResult.toolCallId);
	});
});
