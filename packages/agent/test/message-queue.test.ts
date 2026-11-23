import type { Message } from "@pipi/llm";
import { describe, expect, it } from "vitest";
import { PendingMessageQueue } from "../src/index.ts";

function message(text: string): Message {
	return { role: "user", content: text, timestamp: 1 };
}

describe("PendingMessageQueue", () => {
	it("defaults to single", () => {
		const queue = new PendingMessageQueue();
		expect(queue.mode).toBe("single");
	});

	it("drains one message per call in single mode", () => {
		const queue = new PendingMessageQueue();
		const first = message("first");
		const second = message("second");
		queue.enqueue(first);
		queue.enqueue(second);

		expect(queue.drain()).toEqual([first]);
		expect(queue.drain()).toEqual([second]);
		expect(queue.drain()).toEqual([]);
	});

	it("drains everything in all mode", () => {
		const queue = new PendingMessageQueue("all");
		const messages = [message("a"), message("b"), message("c")];
		for (const item of messages) queue.enqueue(item);

		expect(queue.drain()).toEqual(messages);
		expect(queue.hasItems()).toBe(false);
	});

	it("returns an empty array when drained while empty", () => {
		const queue = new PendingMessageQueue("all");
		expect(queue.drain()).toEqual([]);
	});

	it("reports whether messages are queued", () => {
		const queue = new PendingMessageQueue();
		expect(queue.hasItems()).toBe(false);
		queue.enqueue(message("a"));
		expect(queue.hasItems()).toBe(true);
		queue.drain();
		expect(queue.hasItems()).toBe(false);
	});

	it("clears all queued messages", () => {
		const queue = new PendingMessageQueue("all");
		queue.enqueue(message("a"));
		queue.enqueue(message("b"));
		queue.clear();
		expect(queue.hasItems()).toBe(false);
		expect(queue.drain()).toEqual([]);
	});

	it("applies a mode change to the next drain", () => {
		const queue = new PendingMessageQueue();
		const messages = [message("a"), message("b")];
		for (const item of messages) queue.enqueue(item);

		expect(queue.drain()).toEqual([messages[0]]);
		queue.mode = "all";
		expect(queue.drain()).toEqual([messages[1]]);
	});
});
