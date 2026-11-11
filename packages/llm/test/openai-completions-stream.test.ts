import { describe, expect, it } from "vitest";
import { buildRequest, resolveCompat, stream, streamSimple } from "../src/api/openai-completions.ts";
import type { AssistantMessageEvent, Context, Model } from "../src/types.ts";

const MODEL: Model<"openai-completions"> = {
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
};

const EMPTY_CONTEXT: Context = { messages: [] };

function chunk(delta: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
	return { id: "chatcmpl-1", model: "test-model", choices: [{ index: 0, delta, finish_reason: null }], ...extra };
}

function sse(chunks: unknown[], finish: string | null = "stop"): string {
	const frames = finish
		? [
				...chunks,
				{ id: "chatcmpl-1", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: finish }] },
			]
		: chunks;
	return `${frames.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`;
}

function sseResponse(chunks: unknown[], init: ResponseInit = {}): Response {
	return new Response(sse(chunks), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
		...init,
	});
}

function fetchReturning(response: Response | (() => Promise<Response>), calls: RequestInit[] = []): typeof fetch {
	return (async (_input: string | URL | Request, init?: RequestInit) => {
		calls.push(init ?? {});
		return typeof response === "function" ? response() : response;
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

describe("buildRequest", () => {
	it("sets streaming, usage and store fields", () => {
		const payload = buildRequest(MODEL, EMPTY_CONTEXT);
		expect(payload.stream).toBe(true);
		expect(payload.stream_options).toEqual({ include_usage: true });
		expect(payload.store).toBe(false);
	});

	it("uses the max token field from compat", () => {
		expect(buildRequest(MODEL, EMPTY_CONTEXT, { maxTokens: 100 }).max_completion_tokens).toBe(100);
		const deepseek = resolveCompat({ maxTokensField: "max_tokens" });
		expect(buildRequest(MODEL, EMPTY_CONTEXT, { maxTokens: 100 }, deepseek).max_tokens).toBe(100);
	});

	it("passes temperature, tools and tool choice", () => {
		const payload = buildRequest(
			MODEL,
			{
				messages: [],
				tools: [{ name: "read", description: "", parameters: { type: "object" } }],
			},
			{ temperature: 0.3, toolChoice: "required" },
		);
		expect(payload.temperature).toBe(0.3);
		expect(payload.tools?.[0].function.name).toBe("read");
		expect(payload.tool_choice).toBe("required");
	});

	it("merges samplingParams last", () => {
		const payload = buildRequest(MODEL, EMPTY_CONTEXT, {
			temperature: 0.3,
			samplingParams: { temperature: 0.9, top_p: 0.5 },
		});
		expect(payload.temperature).toBe(0.9);
		expect(payload.top_p).toBe(0.5);
	});

	it("writes reasoning_effort for the openai format", () => {
		const payload = buildRequest({ ...MODEL, reasoning: true }, EMPTY_CONTEXT, { reasoningEffort: "high" });
		expect(payload.reasoning_effort).toBe("high");
	});

	it("writes thinking for the deepseek format", () => {
		const compat = resolveCompat({ thinkingFormat: "deepseek" });
		const payload = buildRequest({ ...MODEL, reasoning: true }, EMPTY_CONTEXT, { reasoningEffort: "high" }, compat);
		expect(payload.thinking).toEqual({ type: "enabled" });
		expect(payload.reasoning_effort).toBe("high");
	});
});

describe("stream", () => {
	it("streams text deltas and finishes the block", async () => {
		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "test-key",
				fetch: fetchReturning(sseResponse([chunk({ content: "你" }), chunk({ content: "好" })])),
			}),
		);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"text_start",
			"text_delta",
			"text_delta",
			"text_end",
			"done",
		]);
		expect(message.content).toEqual([{ type: "text", text: "你好" }]);
		expect(message.stopReason).toBe("stop");
	});

	it("streams thinking and keeps the field as signature", async () => {
		const { events, message } = await collect(
			stream({ ...MODEL, reasoning: true }, EMPTY_CONTEXT, {
				apiKey: "test-key",
				fetch: fetchReturning(
					sseResponse([
						chunk({ reasoning_content: "想", reasoning: "重复" }),
						chunk({ reasoning_content: "一下" }),
						chunk({ content: "答案" }),
					]),
				),
			}),
		);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_delta",
			"text_start",
			"text_delta",
			"thinking_end",
			"text_end",
			"done",
		]);
		expect(message.content).toEqual([
			{ type: "thinking", thinking: "想一下", thinkingSignature: "reasoning_content" },
			{ type: "text", text: "答案" },
		]);
	});

	it("handles frames split across reads", async () => {
		const body = sse([chunk({ content: "ab" })]);
		const encoder = new TextEncoder();
		const bytes = encoder.encode(body);
		const response = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(bytes.slice(0, 10));
					controller.enqueue(bytes.slice(10));
					controller.close();
				},
			}),
			{ status: 200, headers: { "content-type": "text/event-stream" } },
		);

		const { message } = await collect(stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", fetch: fetchReturning(response) }));
		expect(message.content).toEqual([{ type: "text", text: "ab" }]);
	});

	it("sends authorization and request body", async () => {
		const calls: RequestInit[] = [];
		await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "test-key",
				fetch: fetchReturning(sseResponse([chunk({ content: "ok" })]), calls),
			}),
		);

		const headers = calls[0].headers as Record<string, string>;
		expect(headers.authorization).toBe("Bearer test-key");
		expect(JSON.parse(String(calls[0].body))).toMatchObject({ model: "test-model", stream: true });
	});

	it("lets onPayload replace the body", async () => {
		const calls: RequestInit[] = [];
		await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				fetch: fetchReturning(sseResponse([chunk({ content: "ok" })]), calls),
				onPayload: (payload) => ({ ...(payload as object), model: "patched" }),
			}),
		);
		expect(JSON.parse(String(calls[0].body)).model).toBe("patched");
	});

	it("calls onResponse with the status", async () => {
		const statuses: number[] = [];
		await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				fetch: fetchReturning(sseResponse([chunk({ content: "ok" })])),
				onResponse: (response) => {
					statuses.push(response.status);
				},
			}),
		);
		expect(statuses).toEqual([200]);
	});

	it("turns HTTP errors into an error event", async () => {
		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				fetch: fetchReturning(new Response('{"error":"bad key"}', { status: 401 })),
			}),
		);

		expect(events.map((event) => event.type)).toEqual(["error"]);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("401");
	});

	it("fails before the request when the api key is missing", async () => {
		const { events, message } = await collect(stream(MODEL, EMPTY_CONTEXT));
		expect(events.map((event) => event.type)).toEqual(["error"]);
		expect(message.errorMessage).toContain("not configured");
	});

	it("reports aborted streams", async () => {
		const controller = new AbortController();
		controller.abort();
		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				signal: controller.signal,
				fetch: fetchReturning(async () => {
					throw new Error("aborted");
				}),
			}),
		);
		expect(message.stopReason).toBe("aborted");
	});
});

describe("streamSimple", () => {
	it("translates reasoning into reasoning_effort", async () => {
		const calls: RequestInit[] = [];
		await collect(
			streamSimple({ ...MODEL, reasoning: true }, EMPTY_CONTEXT, {
				apiKey: "k",
				reasoning: "high",
				fetch: fetchReturning(sseResponse([chunk({ content: "ok" })]), calls),
			}),
		);
		expect(JSON.parse(String(calls[0].body)).reasoning_effort).toBe("high");
	});

	it("sends thinking for deepseek models", async () => {
		const calls: RequestInit[] = [];
		const deepseek: Model<"openai-completions"> = {
			...MODEL,
			provider: "deepseek",
			reasoning: true,
			compat: { thinkingFormat: "deepseek", supportsStore: false, maxTokensField: "max_tokens" },
		};
		await collect(
			streamSimple(deepseek, EMPTY_CONTEXT, {
				apiKey: "k",
				reasoning: "low",
				fetch: fetchReturning(sseResponse([chunk({ content: "ok" })]), calls),
			}),
		);
		const body = JSON.parse(String(calls[0].body));
		expect(body.thinking).toEqual({ type: "enabled" });
		expect(body.max_tokens).toBe(4096);
	});
});
