import type { Context, Model, Tool, Usage, UserMessage } from "@pipi/llm";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

const usage: Usage = {
	input: 100,
	output: 20,
	cacheRead: 10,
	cacheWrite: 5,
	reasoning: 5,
	totalTokens: 135,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const readTool: Tool = {
	name: "read",
	description: "Read a text file.",
	parameters: Type.Object({
		path: Type.String({ description: "File path" }),
	}),
};

const model: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 4096,
};

const user: UserMessage = {
	role: "user",
	content: "read src/a.ts",
	timestamp: 1,
};

const context: Context = {
	systemPrompt: "You are a coding agent.",
	messages: [user],
	tools: [readTool],
};

describe("model contract", () => {
	it("builds a context with tools and messages", () => {
		expect(context.messages).toHaveLength(1);
		expect(context.tools?.[0].name).toBe("read");
		expect(model.api).toBe("openai-completions");
	});

	it("keeps usage invariants", () => {
		expect(usage.totalTokens).toBe(usage.input + usage.output + usage.cacheRead + usage.cacheWrite);
		expect(usage.reasoning ?? 0).toBeLessThanOrEqual(usage.output);
	});
});
