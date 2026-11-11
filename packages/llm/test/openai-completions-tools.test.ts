import { describe, expect, it } from "vitest";
import { stream } from "../src/api/openai-completions.ts";
import type { AssistantMessageEvent, Context, Model } from "../src/types.ts";

const MODEL: Model<"openai-completions"> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4_096,
};

const EMPTY_CONTEXT: Context = { messages: [] };

function chunk(choices: unknown[], extra: Record<string, unknown> = {}): unknown {
	return { id: "chatcmpl-1", model: "test-model", choices, ...extra };
}

function delta(part: Record<string, unknown>, finish: string | null = null): unknown {
	return chunk([{ index: 0, delta: part, finish_reason: finish }]);
}

function sse(frames: unknown[]): string {
	return `${frames.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`;
}

function fetchReturning(body: string, calls: RequestInit[] = []): typeof fetch {
	return (async (_input: string | URL | Request, init?: RequestInit) => {
		calls.push(init ?? {});
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	}) as typeof fetch;
}

async function collect(result: ReturnType<typeof stream>): Promise<{
	events: AssistantMessageEvent[];
	message: Awaited<ReturnType<typeof result.result>>;
}> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of result) events.push(event);
	return { events, message: await result.result() };
}

describe("stream tool calls", () => {
	it("accumulates argument fragments and finalizes the block", async () => {
		const frames = [
			delta({
				tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "read", arguments: '{"pa' } }],
			}),
			delta({ tool_calls: [{ index: 0, function: { arguments: 'th":"src/a.ts"}' } }] }),
			delta({}, "tool_calls"),
		];

		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(sse(frames)) }),
		);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(message.stopReason).toBe("toolUse");
		expect(message.content).toEqual([
			{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/a.ts" } },
		]);
		expect(Object.keys(message.content[0])).not.toContain("partialArgs");
	});

	it("keeps multiple tool calls separate by index", async () => {
		const frames = [
			delta({
				tool_calls: [
					{ index: 0, id: "call_1", function: { name: "read", arguments: '{"path":"a"}' } },
					{ index: 1, id: "call_2", function: { name: "edit", arguments: '{"path":"b",' } },
				],
			}),
			delta({ tool_calls: [{ index: 1, function: { arguments: '"text":"c"}' } }] }),
			delta({}, "tool_calls"),
		];

		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(sse(frames)) }),
		);

		expect(message.content).toEqual([
			{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "a" } },
			{ type: "toolCall", id: "call_2", name: "edit", arguments: { path: "b", text: "c" } },
		]);
	});

	it("resolves a block by id when later fragments omit the index", async () => {
		const frames = [
			delta({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: "{" } }] }),
			delta({ tool_calls: [{ id: "call_1", function: { arguments: "}" } }] }),
			delta({}, "tool_calls"),
		];

		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(sse(frames)) }),
		);
		expect(message.content).toHaveLength(1);
	});
});

describe("stream usage", () => {
	it("maps cached and reasoning tokens and computes cost", async () => {
		const frames = [
			delta({ content: "hi" }),
			chunk([], {
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					prompt_tokens_details: { cached_tokens: 10 },
					completion_tokens_details: { reasoning_tokens: 5 },
				},
			}),
			delta({}, "stop"),
		];

		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(sse(frames)) }),
		);

		expect(message.usage.input).toBe(90);
		expect(message.usage.output).toBe(20);
		expect(message.usage.cacheRead).toBe(10);
		expect(message.usage.cacheWrite).toBe(0);
		expect(message.usage.reasoning).toBe(5);
		expect(message.usage.totalTokens).toBe(120);
		expect(message.usage.cost.total).toBeGreaterThan(0);
	});

	it("falls back to choice-level usage", async () => {
		const frames = [
			chunk([{ index: 0, delta: {}, finish_reason: "stop", usage: { prompt_tokens: 10, completion_tokens: 2 } }]),
		];

		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(sse(frames)) }),
		);
		expect(message.usage.input).toBe(10);
		expect(message.usage.output).toBe(2);
	});
});

describe("stream stop reasons", () => {
	it("maps length", async () => {
		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				fetch: fetchReturning(sse([delta({ content: "x" }, "length")])),
			}),
		);
		expect(message.stopReason).toBe("length");
		expect(events.at(-1)).toMatchObject({ type: "done", reason: "length" });
	});

	it("turns content_filter into an error event", async () => {
		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				fetch: fetchReturning(sse([delta({}, "content_filter")])),
			}),
		);
		expect(events.map((event) => event.type)).toEqual(["start", "error"]);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("content_filter");
	});

	it("fails when the stream ends without finish_reason", async () => {
		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				fetch: fetchReturning(sse([delta({ content: "partial" })])),
			}),
		);
		expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "error"]);
		expect(message.errorMessage).toContain("without finish_reason");
	});

	it("infers toolUse when the endpoint does not report finish_reason", async () => {
		const model: Model<"openai-completions"> = { ...MODEL, compat: { supportsFinishReason: false } };
		const frames = [delta({ tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: "{}" } }] })];

		const { message } = await collect(
			stream(model, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(sse(frames)) }),
		);
		expect(message.stopReason).toBe("toolUse");
	});
});
