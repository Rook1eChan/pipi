import { describe, expect, it } from "vitest";
import {
	adjustMaxTokensForThinking,
	buildBaseOptions,
	clampMaxTokensToContext,
	clampReasoning,
	clampThinkingBudgetToAnswerRoom,
	DEFAULT_THINKING_BUDGETS,
	thinkingBudgetForLevel,
} from "../src/api/simple-options.ts";
import type { AssistantMessage, Context, ImageContent, Model, Tool, Usage, UserMessage } from "../src/types.ts";
import {
	estimateContextTokens,
	estimateMessageTokens,
	estimateTextAndImageContentTokens,
	estimateTextTokens,
	getUsageTokens,
} from "../src/utils/estimate.ts";

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
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10_000,
		maxTokens: 1_000,
		...overrides,
	};
}

function user(content: UserMessage["content"], timestamp = 0): UserMessage {
	return { role: "user", content, timestamp };
}

function assistant(
	content: AssistantMessage["content"],
	options: { usage?: Partial<Usage>; stopReason?: AssistantMessage["stopReason"]; timestamp?: number } = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "test-model",
		usage: { ...EMPTY_USAGE, ...options.usage },
		stopReason: options.stopReason ?? "stop",
		timestamp: options.timestamp ?? 0,
	};
}

describe("estimateTextTokens", () => {
	it("estimates four characters per token", () => {
		expect(estimateTextTokens("")).toBe(0);
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("abcde")).toBe(2);
	});
});

describe("estimateTextAndImageContentTokens", () => {
	it("counts an image as a fixed number of characters", () => {
		const image: ImageContent = { type: "image", data: "", mimeType: "image/png" };
		expect(estimateTextAndImageContentTokens([image])).toBe(1200);
	});

	it("sums text blocks and images", () => {
		const image: ImageContent = { type: "image", data: "", mimeType: "image/png" };
		expect(estimateTextAndImageContentTokens([{ type: "text", text: "abcd" }, image])).toBe(1201);
	});
});

describe("estimateMessageTokens", () => {
	it("estimates user text", () => {
		expect(estimateMessageTokens(user("abcdefgh"))).toBe(2);
	});

	it("estimates assistant text, thinking and tool calls", () => {
		const message = assistant([
			{ type: "text", text: "abcd" },
			{ type: "thinking", thinking: "abcdefgh" },
			{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
		]);
		expect(estimateMessageTokens(message)).toBe(7);
	});
});

describe("estimateContextTokens", () => {
	it("adds system prompt and tool declarations when there is no usage baseline", () => {
		const tools: Tool[] = [{ name: "read", description: "read a file", parameters: { type: "object" } }];
		const context: Context = {
			systemPrompt: "x".repeat(400),
			messages: [user("abcd")],
			tools,
		};
		const expected = 100 + 1 + Math.ceil(JSON.stringify(tools).length / 4);
		expect(estimateContextTokens(context).tokens).toBe(expected);
	});

	it("reuses the latest assistant usage and estimates only trailing messages", () => {
		const messages = [
			assistant([{ type: "text", text: "hello" }], { usage: { input: 100, output: 20 } }),
			user("abcd"),
		];
		const estimate = estimateContextTokens(messages);
		expect(estimate.usageTokens).toBe(120);
		expect(estimate.trailingTokens).toBe(1);
		expect(estimate.tokens).toBe(121);
		expect(estimate.lastUsageIndex).toBe(0);
	});

	it("ignores aborted and failed assistant usage", () => {
		for (const stopReason of ["aborted", "error"] as const) {
			const messages = [assistant([{ type: "text", text: "abcd" }], { usage: { input: 100 }, stopReason })];
			const estimate = estimateContextTokens(messages);
			expect(estimate.usageTokens).toBe(0);
			expect(estimate.tokens).toBe(1);
		}
	});

	it("counts tools that become available after the usage baseline", () => {
		const tools: Tool[] = [
			{ name: "read", description: "", parameters: { type: "object" } },
			{ name: "edit", description: "", parameters: { type: "object" } },
		];
		const context: Context = {
			messages: [
				assistant([{ type: "text", text: "" }], { usage: { input: 50 } }),
				{
					role: "toolResult",
					toolCallId: "call_1",
					toolName: "read",
					content: [],
					addedToolNames: ["edit"],
					isError: false,
					timestamp: 1,
				},
			],
			tools,
		};
		const estimate = estimateContextTokens(context);
		const addedToolTokens = Math.ceil(JSON.stringify([tools[1]]).length / 4);
		expect(estimate.tokens).toBe(50 + addedToolTokens);
	});
});

describe("getUsageTokens", () => {
	it("prefers totalTokens and falls back to the sum", () => {
		expect(getUsageTokens({ ...EMPTY_USAGE, totalTokens: 42 })).toBe(42);
		expect(getUsageTokens({ ...EMPTY_USAGE, input: 10, output: 5, cacheRead: 2, cacheWrite: 1 })).toBe(18);
	});
});

describe("clampMaxTokensToContext", () => {
	it("leaves the requested value alone when the context fits", () => {
		const model = makeModel({ contextWindow: 100_000 });
		expect(clampMaxTokensToContext(model, { messages: [] }, 2_000)).toBe(2_000);
	});

	it("clamps to the room left by context and the safety margin", () => {
		const model = makeModel({ contextWindow: 5_000 });
		expect(clampMaxTokensToContext(model, { messages: [] }, 2_000)).toBe(904);
	});

	it("never returns less than one token", () => {
		const model = makeModel({ contextWindow: 5_000 });
		const context: Context = { messages: [user("x".repeat(400_000))] };
		expect(clampMaxTokensToContext(model, context, 2_000)).toBe(1);
	});

	it("does not clamp when contextWindow is unknown", () => {
		const model = makeModel({ contextWindow: 0 });
		expect(clampMaxTokensToContext(model, { messages: [] }, 2_000)).toBe(2_000);
	});
});

describe("buildBaseOptions", () => {
	it("merges samplingParams with caller values taking precedence", () => {
		const model = makeModel({ samplingParams: { top_p: 0.9, top_k: 5 } });
		const options = buildBaseOptions(model, { messages: [] }, { samplingParams: { top_k: 10 } });
		expect(options.samplingParams).toEqual({ top_p: 0.9, top_k: 10 });
	});

	it("uses model maxTokens and clamps it to the context", () => {
		const model = makeModel({ contextWindow: 5_000, maxTokens: 2_000 });
		expect(buildBaseOptions(model, { messages: [] }).maxTokens).toBe(904);
	});

	it("prefers the parsed apiKey over the option value", () => {
		const model = makeModel();
		expect(buildBaseOptions(model, { messages: [] }, { apiKey: "from-options" }, "from-auth").apiKey).toBe(
			"from-auth",
		);
		expect(buildBaseOptions(model, { messages: [] }, { apiKey: "from-options" }).apiKey).toBe("from-options");
	});

	it("passes request hooks and transport options through", () => {
		const model = makeModel();
		const onPayload = () => undefined;
		const fetch = async () => new Response();
		const options = buildBaseOptions(model, { messages: [] }, { onPayload, fetch, maxRetries: 3, sessionId: "s1" });
		expect(options.onPayload).toBe(onPayload);
		expect(options.fetch).toBe(fetch);
		expect(options.maxRetries).toBe(3);
		expect(options.sessionId).toBe("s1");
	});
});

describe("clampReasoning", () => {
	it("narrows unsupported levels to high", () => {
		expect(clampReasoning("xhigh")).toBe("high");
		expect(clampReasoning("max")).toBe("high");
		expect(clampReasoning("low")).toBe("low");
		expect(clampReasoning(undefined)).toBeUndefined();
	});
});

describe("thinkingBudgetForLevel", () => {
	it("returns defaults per level", () => {
		expect(thinkingBudgetForLevel("minimal")).toBe(DEFAULT_THINKING_BUDGETS.minimal);
		expect(thinkingBudgetForLevel("high")).toBe(DEFAULT_THINKING_BUDGETS.high);
	});

	it("lets custom budgets override defaults", () => {
		expect(thinkingBudgetForLevel("low", { low: 500 })).toBe(500);
	});
});

describe("adjustMaxTokensForThinking", () => {
	it("fits thinking inside the model cap when the caller sets no limit", () => {
		expect(adjustMaxTokensForThinking(undefined, 100_000, "low")).toEqual({
			maxTokens: 100_000,
			thinkingBudget: 2048,
		});
	});

	it("adds the thinking budget to an explicit cap", () => {
		expect(adjustMaxTokensForThinking(8_000, 100_000, "low")).toEqual({
			maxTokens: 10_048,
			thinkingBudget: 2048,
		});
	});

	it("caps at the model limit and reserves room for the answer", () => {
		expect(adjustMaxTokensForThinking(8_000, 8_000, "medium")).toEqual({
			maxTokens: 8_000,
			thinkingBudget: 6976,
		});
	});

	it("keeps the budget when the ceiling still leaves room", () => {
		expect(adjustMaxTokensForThinking(8_000, 8_500, "medium")).toEqual({
			maxTokens: 8_500,
			thinkingBudget: 8192,
		});
	});

	it("uses custom budgets", () => {
		expect(adjustMaxTokensForThinking(8_000, 100_000, "low", { low: 500 })).toEqual({
			maxTokens: 8_500,
			thinkingBudget: 500,
		});
	});
});

describe("clampThinkingBudgetToAnswerRoom", () => {
	it("keeps at least the minimum answer room", () => {
		expect(clampThinkingBudgetToAnswerRoom(2_000, 2_500)).toBe(1476);
		expect(clampThinkingBudgetToAnswerRoom(500, 2_500)).toBe(500);
		expect(clampThinkingBudgetToAnswerRoom(2_000, 500)).toBe(0);
	});
});
