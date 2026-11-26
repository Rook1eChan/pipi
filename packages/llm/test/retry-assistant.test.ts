import { describe, expect, it } from "vitest";
import type { AssistantMessage, Usage } from "../src/types.ts";
import {
	isRetryableAssistantError,
	type RetryCallbacks,
	type RetryPolicy,
	retryAssistantCall,
} from "../src/utils/retry.ts";

const usage: Usage = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(stopReason: AssistantMessage["stopReason"], errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai-completions",
		provider: "faux",
		model: "faux",
		usage,
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	};
}

const policy: RetryPolicy = { enabled: true, maxRetries: 1, baseDelayMs: 1 };

describe("isRetryableAssistantError", () => {
	it("classifies transient and quota errors", () => {
		expect(isRetryableAssistantError(assistant("error", "503 service unavailable"))).toBe(true);
		expect(isRetryableAssistantError(assistant("error", "insufficient_quota"))).toBe(false);
		expect(isRetryableAssistantError(assistant("stop"))).toBe(false);
	});
});

describe("retryAssistantCall", () => {
	it("returns a successful response without retrying", async () => {
		let calls = 0;
		const result = await retryAssistantCall(
			async () => {
				calls++;
				return assistant("stop");
			},
			policy,
			undefined,
		);

		expect(result.stopReason).toBe("stop");
		expect(calls).toBe(1);
	});

	it("retries a transient error and reports callbacks", async () => {
		let calls = 0;
		const events: string[] = [];
		const callbacks: RetryCallbacks = {
			onRetryScheduled: (attempt) => {
				events.push(`scheduled:${attempt}`);
			},
			onRetryAttemptStart: () => {
				events.push("start");
			},
			onRetryFinished: (success) => {
				events.push(`finished:${success}`);
			},
		};

		const result = await retryAssistantCall(
			async () => {
				calls++;
				return calls === 1 ? assistant("error", "503 service unavailable") : assistant("stop");
			},
			policy,
			undefined,
			callbacks,
		);

		expect(result.stopReason).toBe("stop");
		expect(calls).toBe(2);
		expect(events).toEqual(["scheduled:1", "start", "finished:true"]);
	});

	it("does not retry deterministic or aborted responses", async () => {
		let calls = 0;
		const nonRetryable = await retryAssistantCall(
			async () => {
				calls++;
				return assistant("error", "invalid api key");
			},
			policy,
			undefined,
		);
		expect(nonRetryable.stopReason).toBe("error");
		expect(calls).toBe(1);

		calls = 0;
		const aborted = await retryAssistantCall(
			async () => {
				calls++;
				return assistant("aborted");
			},
			policy,
			undefined,
		);
		expect(aborted.stopReason).toBe("aborted");
		expect(calls).toBe(1);
	});

	it("returns the last error when retries are exhausted", async () => {
		let calls = 0;
		const result = await retryAssistantCall(
			async () => {
				calls++;
				return assistant("error", "timeout");
			},
			policy,
			undefined,
		);

		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("timeout");
		expect(calls).toBe(2);
	});
});
