import { describe, expect, it } from "vitest";
import {
	estimateContextTokens,
	estimateTokens,
	getLastAssistantUsage,
	shouldCompact,
} from "../../src/compaction/estimate.ts";
import { DEFAULT_COMPACTION_SETTINGS } from "../../src/compaction/types.ts";
import { assistantMessage, messageEntry, usage, userMessage } from "./fixtures.ts";

describe("estimateTokens", () => {
	it("uses four characters per token", () => {
		expect(estimateTokens(userMessage("abcd"))).toBe(1);
		expect(estimateTokens(userMessage("a".repeat(400)))).toBe(100);
	});

	it("counts text, thinking and tool call arguments", () => {
		const message = assistantMessage("abcd", {
			toolCalls: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "a.ts" } }],
		});
		expect(estimateTokens(message)).toBeGreaterThan(2);
	});

	it("counts images as a fixed size", () => {
		const message: Parameters<typeof estimateTokens>[0] = {
			role: "user",
			content: [{ type: "image", data: "x", mimeType: "image/png" }],
			timestamp: 1,
		};
		expect(estimateTokens(message)).toBe(1200);
	});
});

describe("estimateContextTokens", () => {
	it("estimates all messages without a usage baseline", () => {
		const result = estimateContextTokens([userMessage("a".repeat(400))]);
		expect(result.tokens).toBe(100);
		expect(result.lastUsageIndex).toBeNull();
	});

	it("reuses the last assistant usage and estimates only trailing messages", () => {
		const result = estimateContextTokens([
			userMessage("ignored"),
			assistantMessage("done", { usage: usage(1000) }),
			userMessage("a".repeat(400)),
		]);
		expect(result.usageTokens).toBe(1000);
		expect(result.trailingTokens).toBe(100);
		expect(result.tokens).toBe(1100);
	});

	it("ignores aborted and errored assistant usage", () => {
		const result = estimateContextTokens([
			assistantMessage("x", { usage: usage(1000), stopReason: "aborted" }),
			userMessage("abcd"),
		]);
		expect(result.lastUsageIndex).toBeNull();
		expect(result.tokens).toBe(2);
	});
});

describe("getLastAssistantUsage", () => {
	it("reads usage from the newest valid assistant entry", () => {
		const path = [
			messageEntry("a", userMessage("hi"), null),
			messageEntry("b", assistantMessage("ok", { usage: usage(42) }), "a"),
		];
		expect(getLastAssistantUsage(path)?.totalTokens).toBe(42);
	});
});

describe("shouldCompact", () => {
	it("respects enabled and reserve tokens", () => {
		expect(shouldCompact(9001, 10000, { ...DEFAULT_COMPACTION_SETTINGS, reserveTokens: 1000 })).toBe(true);
		expect(shouldCompact(8999, 10000, { ...DEFAULT_COMPACTION_SETTINGS, reserveTokens: 1000 })).toBe(false);
		expect(shouldCompact(9999, 10000, { ...DEFAULT_COMPACTION_SETTINGS, enabled: false, reserveTokens: 1000 })).toBe(
			false,
		);
	});
});
