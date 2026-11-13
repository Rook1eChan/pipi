import { describe, expect, it } from "vitest";
import { type AuthContext, createModels, deepseekProvider, openaiProvider } from "../src/index.ts";
import type { AssistantMessageEvent, Context } from "../src/types.ts";

const EMPTY_CONTEXT: Context = { messages: [] };

const authContext: AuthContext = {
	env: async (name) => ({ OPENAI_API_KEY: "env-openai", DEEPSEEK_API_KEY: "env-deepseek" })[name],
	fileExists: async () => false,
};

function sseResponse(text: string): Response {
	const frames = [
		{ id: "chatcmpl-1", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
		{ id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
	];
	const body = `${frames.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("")}data: [DONE]\n\n`;
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function fetchCapture(calls: Array<{ url: string; body: Record<string, unknown> }>): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
		return sseResponse("ok");
	}) as typeof fetch;
}

describe("built-in providers", () => {
	it("exposes the OpenAI catalog", () => {
		const provider = openaiProvider();
		expect(provider.id).toBe("openai");
		expect(provider.baseUrl).toBe("https://api.openai.com/v1");
		expect(provider.getModels().map((model) => model.id)).toContain("gpt-4.1-mini");
	});

	it("exposes the DeepSeek catalog", () => {
		const provider = deepseekProvider();
		expect(provider.id).toBe("deepseek");
		expect(provider.getModels().map((model) => model.id)).toContain("deepseek-v4-flash");
	});
});

describe("Models with built-in providers", () => {
	it("registers and finds models by provider and id", () => {
		const models = createModels({ authContext });
		models.setProvider(openaiProvider());
		models.setProvider(deepseekProvider());

		expect(models.getModel("openai", "gpt-4.1-mini")?.provider).toBe("openai");
		expect(models.getModel("deepseek", "deepseek-v4-flash")?.provider).toBe("deepseek");
	});

	it("resolves API keys from environment", async () => {
		const models = createModels({ authContext });
		models.setProvider(openaiProvider());
		models.setProvider(deepseekProvider());

		expect((await models.getAuth("openai"))?.auth.apiKey).toBe("env-openai");
		expect((await models.getAuth("deepseek"))?.auth.apiKey).toBe("env-deepseek");
	});
});

describe("streaming through built-in providers", () => {
	it("streams through the OpenAI provider", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		const models = createModels({ authContext });
		models.setProvider(openaiProvider());
		const model = models.getModel("openai", "gpt-4.1-mini");
		if (!model) throw new Error("model missing");

		const events: AssistantMessageEvent[] = [];
		const stream = models.streamSimple(model, EMPTY_CONTEXT, { fetch: fetchCapture(calls) });
		for await (const event of stream) events.push(event);
		const message = await stream.result();

		expect(message.content).toEqual([{ type: "text", text: "ok" }]);
		expect(events.at(-1)?.type).toBe("done");
		expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
		expect(calls[0].body.max_completion_tokens).toBe(model.maxTokens);
	});

	it("streams through the DeepSeek provider with its compat", async () => {
		const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
		const models = createModels({ authContext });
		models.setProvider(deepseekProvider());
		const model = models.getModel("deepseek", "deepseek-v4-flash");
		if (!model) throw new Error("model missing");

		const stream = models.streamSimple(model, EMPTY_CONTEXT, {
			reasoning: "high",
			fetch: fetchCapture(calls),
		});
		const message = await stream.result();

		expect(message.stopReason).toBe("stop");
		expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
		expect(calls[0].body.max_tokens).toBe(model.maxTokens);
		expect(calls[0].body.thinking).toEqual({ type: "enabled" });
	});
});
