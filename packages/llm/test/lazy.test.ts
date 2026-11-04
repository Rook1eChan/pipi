import type { AssistantMessage, AssistantMessageEvent, Model } from "@pipi/llm";
import { describe, expect, it } from "vitest";
import { lazyStream } from "../src/api/lazy.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const model: Model = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

function createMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: 0,
		...overrides,
	};
}

describe("lazyStream", () => {
	it("returns synchronously and forwards events after setup resolves", async () => {
		const message = createMessage({ stopReason: "stop" });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = () => resolve();
		});

		const stream = lazyStream(model, async () => {
			await gate;
			const inner = new AssistantMessageEventStream();
			inner.push({ type: "start", partial: message });
			inner.push({ type: "text_start", contentIndex: 0, partial: message });
			inner.push({ type: "text_delta", contentIndex: 0, delta: "hi", partial: message });
			inner.push({ type: "text_end", contentIndex: 0, content: "hi", partial: message });
			inner.push({ type: "done", reason: "stop", message });
			return inner;
		});

		expect(stream).toBeInstanceOf(AssistantMessageEventStream);

		release();

		const types: string[] = [];
		for await (const event of stream) {
			types.push(event.type);
		}
		expect(types).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(await stream.result()).toBe(message);
	});

	it("turns setup failure into a single error event", async () => {
		const stream = lazyStream(model, async () => {
			throw new Error("missing api key");
		});

		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("error");

		const result = await stream.result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("missing api key");
		expect(result.provider).toBe("openai");
		expect(result.model).toBe("test-model");
	});

	it("stringifies non-Error rejections", async () => {
		const stream = lazyStream(model, () => Promise.reject("boom"));

		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect((await stream.result()).errorMessage).toBe("boom");
	});

	it("forwards a plain async iterable without result()", async () => {
		const message = createMessage({ stopReason: "stop" });
		const stream = lazyStream(model, async () => {
			async function* source(): AsyncGenerator<AssistantMessageEvent> {
				yield { type: "start", partial: message };
				yield { type: "done", reason: "stop", message };
			}
			return source();
		});

		const types: string[] = [];
		for await (const event of stream) {
			types.push(event.type);
		}
		expect(types).toEqual(["start", "done"]);
		expect(await stream.result()).toBe(message);
	});

	it("resolves the result without consuming events", async () => {
		const message = createMessage({ stopReason: "stop" });
		const inner = new AssistantMessageEventStream();
		const stream = lazyStream(model, async () => inner);

		inner.push({ type: "done", reason: "stop", message });

		expect(await stream.result()).toBe(message);
	});
});
