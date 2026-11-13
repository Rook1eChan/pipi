import { describe, expect, it } from "vitest";
import { lazyApi } from "../src/api/lazy.ts";
import type { ProviderStreams } from "../src/models.ts";
import type { AssistantMessage, Model, Usage } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const MODEL: Model = {
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

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function fakeStream(model: Model, text: string): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason: "stop",
		timestamp: 0,
	};
	stream.push({ type: "start", partial: message });
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

describe("lazyApi", () => {
	it("delegates stream to the loaded module", async () => {
		const api = lazyApi(async () => ({
			stream: (model) => fakeStream(model, "stream"),
			streamSimple: (model) => fakeStream(model, "simple"),
		}));

		const message = await api.stream(MODEL, { messages: [] }).result();
		expect(message.content).toEqual([{ type: "text", text: "stream" }]);
	});

	it("delegates streamSimple to the loaded module", async () => {
		const api = lazyApi(async () => ({
			stream: (model) => fakeStream(model, "stream"),
			streamSimple: (model) => fakeStream(model, "simple"),
		}));

		const message = await api.streamSimple(MODEL, { messages: [] }).result();
		expect(message.content).toEqual([{ type: "text", text: "simple" }]);
	});

	it("loads the module per call", async () => {
		let loads = 0;
		const implementation: ProviderStreams = {
			stream: (model) => fakeStream(model, "x"),
			streamSimple: (model) => fakeStream(model, "x"),
		};
		const api = lazyApi(async () => {
			loads++;
			return implementation;
		});

		await api.stream(MODEL, { messages: [] }).result();
		await api.streamSimple(MODEL, { messages: [] }).result();
		expect(loads).toBe(2);
	});

	it("turns load failures into an error event", async () => {
		const api = lazyApi(async () => {
			throw new Error("load failed");
		});

		const message = await api.stream(MODEL, { messages: [] }).result();
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toBe("load failed");
	});
});
