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
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 4_096,
};

const EMPTY_CONTEXT: Context = { messages: [] };

function okResponse(text = "ok"): Response {
	const frames = [
		{ id: "chatcmpl-1", model: "test-model", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
		{ id: "chatcmpl-1", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
	];
	const body = `${frames.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`;
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function fetchSequence(
	steps: Array<Response | Error | (() => Promise<Response>)>,
	calls: RequestInit[] = [],
): typeof fetch {
	let index = 0;
	return (async (_input: string | URL | Request, init?: RequestInit) => {
		calls.push(init ?? {});
		const step = steps[Math.min(index, steps.length - 1)];
		index++;
		if (step instanceof Error) throw step;
		return typeof step === "function" ? step() : step;
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

describe("stream retry", () => {
	it("retries 500 and then succeeds", async () => {
		const calls: RequestInit[] = [];
		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				maxRetries: 1,
				fetch: fetchSequence([new Response("{}", { status: 500 }), okResponse()], calls),
			}),
		);

		expect(calls).toHaveLength(2);
		expect(message.stopReason).toBe("stop");
	});

	it("honors Retry-After on 429", async () => {
		const calls: RequestInit[] = [];
		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				maxRetries: 1,
				fetch: fetchSequence(
					[new Response("{}", { status: 429, headers: { "retry-after": "0" } }), okResponse()],
					calls,
				),
			}),
		);

		expect(calls).toHaveLength(2);
		expect(message.stopReason).toBe("stop");
	});

	it("retries network errors", async () => {
		const calls: RequestInit[] = [];
		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				maxRetries: 1,
				fetch: fetchSequence([new Error("fetch failed"), okResponse()], calls),
			}),
		);

		expect(calls).toHaveLength(2);
		expect(message.stopReason).toBe("stop");
	});

	it("does not retry 4xx and formats the error body", async () => {
		const calls: RequestInit[] = [];
		const { events, message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				maxRetries: 3,
				fetch: fetchSequence(
					[new Response('{"error":{"message":"bad key","code":"invalid_api_key"}}', { status: 401 })],
					calls,
				),
			}),
		);

		expect(calls).toHaveLength(1);
		expect(events.map((event) => event.type)).toEqual(["error"]);
		expect(message.errorMessage).toContain("bad key");
		expect(message.errorMessage).toContain("invalid_api_key");
	});

	it("stops after maxRetries", async () => {
		const calls: RequestInit[] = [];
		const { message } = await collect(
			stream(MODEL, EMPTY_CONTEXT, {
				apiKey: "k",
				maxRetries: 1,
				fetch: fetchSequence([() => Promise.resolve(new Response("{}", { status: 503 }))], calls),
			}),
		);

		expect(calls).toHaveLength(2);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("503");
	});

	it("aborts when timeoutMs elapses", async () => {
		const hanging = (async (_input: string | URL | Request, init?: RequestInit) => {
			await new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
			return okResponse();
		}) as typeof fetch;

		const { message } = await collect(stream(MODEL, EMPTY_CONTEXT, { apiKey: "k", timeoutMs: 20, fetch: hanging }));
		expect(message.stopReason).toBe("error");
	});
});
