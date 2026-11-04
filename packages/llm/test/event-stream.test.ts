import type { AssistantMessage } from "@pipi/llm";
import { describe, expect, it } from "vitest";
import { AssistantMessageEventStream, EventStream } from "../src/utils/event-stream.ts";

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

describe("EventStream", () => {
	it("drains buffered events in order", async () => {
		const stream = new EventStream<number, number>(
			(event) => event === 3,
			(event) => event,
		);
		stream.push(1);
		stream.push(2);
		stream.push(3);
		stream.push(4);

		expect(await stream.result()).toBe(3);

		const events: number[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		expect(events).toEqual([1, 2, 3]);
	});

	it("delivers an event to a waiting consumer", async () => {
		const stream = new EventStream<number, number>(
			() => false,
			(event) => event,
		);
		const first = stream[Symbol.asyncIterator]().next();

		stream.push(7);

		expect(await first).toEqual({ value: 7, done: false });
	});

	it("drains buffered events after end", async () => {
		const stream = new EventStream<number, number>(
			() => false,
			(event) => event,
		);
		stream.push(1);
		stream.push(2);
		stream.end(99);

		expect(await stream.result()).toBe(99);

		const events: number[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		expect(events).toEqual([1, 2]);
	});

	it("wakes waiting consumers when ended", async () => {
		const stream = new EventStream<number, number>(
			() => false,
			(event) => event,
		);
		const first = stream[Symbol.asyncIterator]().next();
		const second = stream[Symbol.asyncIterator]().next();

		stream.end();

		expect(await first).toEqual({ value: undefined, done: true });
		expect(await second).toEqual({ value: undefined, done: true });
	});

	it("ignores events pushed after completion", async () => {
		const stream = new EventStream<number, number>(
			(event) => event === 1,
			(event) => event,
		);
		stream.push(1);
		stream.push(2);

		const events: number[] = [];
		for await (const event of stream) {
			events.push(event);
		}
		expect(events).toEqual([1]);
	});

	it("treats a second end call as a no-op", async () => {
		const stream = new EventStream<number, number>(
			() => false,
			(event) => event,
		);
		stream.end(1);
		stream.end(2);

		expect(await stream.result()).toBe(1);
	});
});

describe("AssistantMessageEventStream", () => {
	it("resolves the final message from done", async () => {
		const stream = new AssistantMessageEventStream();
		const message = createMessage({ stopReason: "stop" });

		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: "stop", message });

		expect(await stream.result()).toBe(message);
	});

	it("resolves the error message from error without rejecting", async () => {
		const stream = new AssistantMessageEventStream();
		const error = createMessage({ stopReason: "error", errorMessage: "boom" });

		stream.push({ type: "error", reason: "error", error });

		await expect(stream.result()).resolves.toBe(error);
	});

	it("keeps the aborted message", async () => {
		const stream = new AssistantMessageEventStream();
		const message = createMessage({ stopReason: "aborted" });

		stream.push({ type: "start", partial: message });
		stream.push({ type: "error", reason: "aborted", error: message });

		const result = await stream.result();
		expect(result.stopReason).toBe("aborted");
	});

	it("emits events in protocol order", async () => {
		const stream = new AssistantMessageEventStream();
		const partial = createMessage();

		stream.push({ type: "start", partial });
		stream.push({ type: "text_start", contentIndex: 0, partial });
		stream.push({ type: "text_delta", contentIndex: 0, delta: "a", partial });
		stream.push({ type: "text_delta", contentIndex: 0, delta: "b", partial });
		stream.push({ type: "text_end", contentIndex: 0, content: "ab", partial });
		stream.push({ type: "done", reason: "stop", message: partial });

		const types: string[] = [];
		for await (const event of stream) {
			types.push(event.type);
		}
		expect(types).toEqual(["start", "text_start", "text_delta", "text_delta", "text_end", "done"]);
	});

	it("shares the partial message reference with consumers", async () => {
		const stream = new AssistantMessageEventStream();
		const partial = createMessage();
		stream.push({ type: "start", partial });

		const iterator = stream[Symbol.asyncIterator]();
		const start = await iterator.next();
		partial.content.push({ type: "text", text: "hello" });
		stream.push({ type: "done", reason: "stop", message: partial });

		expect(start.value?.type).toBe("start");
		if (start.value?.type === "start") {
			expect(start.value.partial.content).toEqual([{ type: "text", text: "hello" }]);
		}
	});
});
