import { describe, expect, it } from "vitest";
import {
	type ChatCompletionMessage,
	convertMessages,
	convertTools,
	makeStrictJsonSchema,
	resolveCompat,
	sanitizeSurrogates,
} from "../src/api/openai-completions.ts";
import type {
	AssistantMessage,
	Context,
	ImageContent,
	Model,
	Tool,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "../src/types.ts";

const IMAGE: ImageContent = { type: "image", data: "AAAA", mimeType: "image/png" };

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeModel(overrides: Partial<Model<"openai-completions">> = {}): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://example.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4_096,
		...overrides,
	};
}

function user(content: UserMessage["content"], timestamp = 0): UserMessage {
	return { role: "user", content, timestamp };
}

function assistant(
	content: AssistantMessage["content"],
	options: { stopReason?: AssistantMessage["stopReason"]; timestamp?: number } = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "test-model",
		usage: EMPTY_USAGE,
		stopReason: options.stopReason ?? "stop",
		timestamp: options.timestamp ?? 0,
	};
}

function toolResult(
	content: ToolResultMessage["content"],
	overrides: Partial<ToolResultMessage> = {},
): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "read",
		content,
		isError: false,
		timestamp: 0,
		...overrides,
	};
}

function context(messages: Context["messages"], extra: Partial<Context> = {}): Context {
	return { messages, ...extra };
}

describe("sanitizeSurrogates", () => {
	it("removes unpaired surrogates", () => {
		expect(sanitizeSurrogates("a\uD800b")).toBe("ab");
		expect(sanitizeSurrogates("a\uDC00b")).toBe("ab");
	});

	it("keeps valid surrogate pairs", () => {
		expect(sanitizeSurrogates("a😀b")).toBe("a😀b");
	});
});

describe("convertMessages - system prompt", () => {
	it("uses system role for non-reasoning models", () => {
		const params = convertMessages(makeModel(), context([], { systemPrompt: "be brief" }), resolveCompat());
		expect(params[0]).toEqual({ role: "system", content: "be brief" });
	});

	it("uses developer role for reasoning models when supported", () => {
		const params = convertMessages(
			makeModel({ reasoning: true }),
			context([], { systemPrompt: "be brief" }),
			resolveCompat(),
		);
		expect(params[0]).toEqual({ role: "developer", content: "be brief" });
	});

	it("falls back to system role when developer is unsupported", () => {
		const params = convertMessages(
			makeModel({ reasoning: true }),
			context([], { systemPrompt: "be brief" }),
			resolveCompat({ supportsDeveloperRole: false }),
		);
		expect(params[0]).toEqual({ role: "system", content: "be brief" });
	});

	it("omits the system prompt when absent", () => {
		expect(convertMessages(makeModel(), context([user("hi")]), resolveCompat())).toHaveLength(1);
	});
});

describe("convertMessages - user messages", () => {
	it("keeps string content as-is", () => {
		const params = convertMessages(makeModel(), context([user("hello")]), resolveCompat());
		expect(params[0]).toEqual({ role: "user", content: "hello" });
	});

	it("converts text and image blocks", () => {
		const params = convertMessages(
			makeModel({ input: ["text", "image"] }),
			context([user([{ type: "text", text: "look" }, IMAGE])]),
			resolveCompat(),
		);
		expect(params[0]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "look" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
			],
		});
	});

	it("replaces images with a placeholder for non-vision models", () => {
		const params = convertMessages(
			makeModel(),
			context([user([{ type: "text", text: "look" }, IMAGE])]),
			resolveCompat(),
		);
		expect(params[0]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "look" },
				{ type: "text", text: "(image omitted: model does not support images)" },
			],
		});
	});
});

describe("convertMessages - assistant messages", () => {
	it("sends text as a plain string", () => {
		const params = convertMessages(
			makeModel(),
			context([assistant([{ type: "text", text: "hi" }])]),
			resolveCompat(),
		);
		expect(params[0]).toEqual({ role: "assistant", content: "hi" });
	});

	it("skips empty assistant messages", () => {
		const params = convertMessages(
			makeModel(),
			context([assistant([{ type: "text", text: "  " }])]),
			resolveCompat(),
		);
		expect(params).toEqual([]);
	});

	it("skips aborted and failed assistant messages", () => {
		for (const stopReason of ["aborted", "error"] as const) {
			const params = convertMessages(
				makeModel(),
				context([assistant([{ type: "text", text: "partial" }], { stopReason })]),
				resolveCompat(),
			);
			expect(params).toEqual([]);
		}
	});

	it("serializes tool calls as JSON arguments", () => {
		const params = convertMessages(
			makeModel(),
			context([assistant([{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/a.ts" } }])]),
			resolveCompat(),
		);
		expect(params[0]).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"src/a.ts"}' } }],
		});
	});

	it("replays thinking into reasoning_content for DeepSeek", () => {
		const params = convertMessages(
			makeModel({ reasoning: true }),
			context([
				assistant([
					{ type: "thinking", thinking: "pondering", thinkingSignature: "reasoning_content" },
					{ type: "text", text: "hi" },
				]),
			]),
			resolveCompat({ thinkingFormat: "deepseek" }),
		);
		expect(params[0]).toEqual({ role: "assistant", content: "hi", reasoning_content: "pondering" });
	});

	it("converts thinking to text when required", () => {
		const params = convertMessages(
			makeModel({ reasoning: true }),
			context([
				assistant([
					{ type: "thinking", thinking: "pondering" },
					{ type: "text", text: "hi" },
				]),
			]),
			resolveCompat({ requiresThinkingAsText: true }),
		);
		expect(params[0]).toEqual({
			role: "assistant",
			content: [
				{ type: "text", text: "pondering" },
				{ type: "text", text: "hi" },
			],
		});
	});

	it("adds empty reasoning_content when the endpoint requires it", () => {
		const params = convertMessages(
			makeModel({ reasoning: true }),
			context([assistant([{ type: "text", text: "hi" }])]),
			resolveCompat({ requiresReasoningContentOnAssistantMessages: true }),
		);
		expect(params[0]).toEqual({ role: "assistant", content: "hi", reasoning_content: "" });
	});
});

describe("convertMessages - tool results", () => {
	it("converts a tool result to a tool message", () => {
		const params = convertMessages(
			makeModel(),
			context([toolResult([{ type: "text", text: "file body" }])]),
			resolveCompat(),
		);
		expect(params[0]).toEqual({ role: "tool", content: "file body", tool_call_id: "call_1" });
	});

	it("adds the tool name when required", () => {
		const params = convertMessages(
			makeModel(),
			context([toolResult([{ type: "text", text: "file body" }])]),
			resolveCompat({ requiresToolResultName: true }),
		);
		expect(params[0]).toMatchObject({ role: "tool", name: "read" });
	});

	it("uses a placeholder for empty results", () => {
		expect(convertMessages(makeModel(), context([toolResult([])]), resolveCompat())[0]).toMatchObject({
			content: "(no tool output)",
		});
	});

	it("attaches tool images as a following user message", () => {
		const params = convertMessages(
			makeModel({ input: ["text", "image"] }),
			context([toolResult([IMAGE])]),
			resolveCompat(),
		);
		expect(params).toHaveLength(2);
		expect(params[0]).toEqual({ role: "tool", content: "(see attached image)", tool_call_id: "call_1" });
		expect(params[1]).toEqual({
			role: "user",
			content: [
				{ type: "text", text: "Attached image(s) from tool result:" },
				{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
			],
		});
	});

	it("groups consecutive tool results into one image message", () => {
		const params = convertMessages(
			makeModel({ input: ["text", "image"] }),
			context([toolResult([IMAGE], { toolCallId: "call_1" }), toolResult([IMAGE], { toolCallId: "call_2" })]),
			resolveCompat(),
		);
		expect(params.map((entry) => entry.role)).toEqual(["tool", "tool", "user"]);
		expect(params[2].content).toHaveLength(3);
	});

	it("inserts a bridge assistant message when required", () => {
		const params = convertMessages(
			makeModel(),
			context([toolResult([{ type: "text", text: "done" }]), user("next")]),
			resolveCompat({ requiresAssistantAfterToolResult: true }),
		);
		expect(params.map((entry) => entry.role)).toEqual(["tool", "assistant", "user"]);
	});
});

describe("convertTools", () => {
	const tool = (overrides: Partial<Tool> = {}): Tool => ({
		name: "read",
		description: "read a file",
		parameters: { type: "object", properties: { path: { type: "string" } } },
		...overrides,
	});

	it("converts a function tool without strict by default", () => {
		expect(convertTools([tool()], resolveCompat())).toEqual([
			{
				type: "function",
				function: {
					name: "read",
					description: "read a file",
					parameters: { type: "object", properties: { path: { type: "string" } } },
				},
			},
		]);
	});

	it("makes schemas strict when the tool requires json_schema sampling", () => {
		const tools = convertTools(
			[tool({ constrainedSampling: { type: "json_schema", strict: "require" } })],
			resolveCompat(),
		);
		expect(tools[0].function.strict).toBe(true);
		expect(tools[0].function.parameters).toEqual({
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
			additionalProperties: false,
		});
	});

	it("drops strict for prefer when the endpoint does not support it", () => {
		const tools = convertTools(
			[tool({ constrainedSampling: { type: "json_schema", strict: "prefer" } })],
			resolveCompat({ supportsStrictMode: false }),
		);
		expect(tools[0].function.strict).toBeUndefined();
	});

	it("throws for require when the endpoint does not support strict", () => {
		expect(() =>
			convertTools(
				[tool({ constrainedSampling: { type: "json_schema", strict: "require" } })],
				resolveCompat({ supportsStrictMode: false }),
			),
		).toThrow(/requires JSON-schema constrained sampling/);
	});
});

describe("makeStrictJsonSchema", () => {
	it("requires every property and forbids additional ones", () => {
		expect(
			makeStrictJsonSchema({
				type: "object",
				properties: { nested: { type: "object", properties: { value: { type: "number" } } } },
			}),
		).toEqual({
			type: "object",
			properties: {
				nested: {
					type: "object",
					properties: { value: { type: "number" } },
					required: ["value"],
					additionalProperties: false,
				},
			},
			required: ["nested"],
			additionalProperties: false,
		});
	});

	it("rejects unsupported combinators", () => {
		expect(() => makeStrictJsonSchema({ type: "object", oneOf: [] })).toThrow(/oneOf/);
	});
});

describe("resolveCompat", () => {
	it("fills defaults and keeps overrides", () => {
		const compat = resolveCompat({ maxTokensField: "max_tokens" });
		expect(compat.maxTokensField).toBe("max_tokens");
		expect(compat.supportsDeveloperRole).toBe(true);
		expect(compat.thinkingFormat).toBe("openai");
	});
});

describe("ChatCompletionMessage shape", () => {
	it("uses the declared wire type", () => {
		const params: ChatCompletionMessage[] = convertMessages(makeModel(), context([user("hi")]), resolveCompat());
		expect(params[0].role).toBe("user");
	});
});
