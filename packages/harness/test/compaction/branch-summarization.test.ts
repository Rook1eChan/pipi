import { describe, expect, it } from "vitest";
import {
	collectEntriesForBranchSummary,
	generateBranchSummary,
	prepareBranchEntries,
} from "../../src/compaction/branch-summarization.ts";
import { SessionManager } from "../../src/session/manager.ts";
import { assistantMessage, messageEntry, model, streamFrom, usage, userMessage } from "./fixtures.ts";

describe("collectEntriesForBranchSummary", () => {
	it("collects entries from the old leaf back to the common ancestor", () => {
		const session = SessionManager.inMemory("/tmp/branch-test");
		const u1 = session.appendMessage(userMessage("first"));
		const a1 = session.appendMessage(assistantMessage("answer"));
		const u2 = session.appendMessage(userMessage("second"));
		session.appendMessage(assistantMessage("done"));

		const result = collectEntriesForBranchSummary(session, session.getLeafId(), u2);

		expect(result.commonAncestorId).toBe(u2);
		expect(result.entries.map((entry) => entry.id)).toEqual([session.getLeafId()]);
		expect(result.entries[0].parentId).toBe(u2);
		expect(a1).toBeTruthy();
		expect(u1).toBeTruthy();
	});

	it("returns nothing when there is no old position", () => {
		const session = SessionManager.inMemory("/tmp/branch-test");
		const target = session.appendMessage(userMessage("only"));

		expect(collectEntriesForBranchSummary(session, null, target)).toEqual({
			entries: [],
			commonAncestorId: null,
		});
	});
});

describe("prepareBranchEntries", () => {
	it("keeps the newest messages when the budget is tight", () => {
		const entries = [
			messageEntry("u1", userMessage("a".repeat(400)), null),
			messageEntry("a1", assistantMessage("b".repeat(400)), "u1"),
			messageEntry("u2", userMessage("c".repeat(400)), "a1"),
		];

		const prepared = prepareBranchEntries(entries, 150);

		expect(prepared.messages).toHaveLength(1);
		expect(prepared.messages[0].role).toBe("user");
		expect(prepared.totalTokens).toBeLessThanOrEqual(150);
	});
});

describe("generateBranchSummary", () => {
	it("summarizes a branch and appends file lists", async () => {
		const entries = [
			messageEntry("u1", userMessage("fix the bug"), null),
			messageEntry(
				"a1",
				assistantMessage("read file", {
					toolCalls: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "/tmp/a.ts" } }],
				}),
				"u1",
			),
		];

		const result = await generateBranchSummary(entries, {
			model: model(),
			signal: new AbortController().signal,
			streamFn: streamFrom([assistantMessage("branch work", { usage: usage(9) })]),
		});

		expect(result.summary).toContain("different conversation branch");
		expect(result.summary).toContain("branch work");
		expect(result.summary).toContain("/tmp/a.ts");
		expect(result.usage?.totalTokens).toBe(9);
	});

	it("returns an error for a tool-calling summary", async () => {
		const entries = [messageEntry("u1", userMessage("work"), null)];

		const result = await generateBranchSummary(entries, {
			model: model(),
			signal: new AbortController().signal,
			streamFn: streamFrom([
				assistantMessage("bad", {
					toolCalls: [{ type: "toolCall", id: "1", name: "read", arguments: {} }],
				}),
			]),
		});

		expect(result.error).toContain("attempted to call a tool");
	});

	it("reports aborted responses", async () => {
		const entries = [messageEntry("u1", userMessage("work"), null)];

		const result = await generateBranchSummary(entries, {
			model: model(),
			signal: new AbortController().signal,
			streamFn: streamFrom([assistantMessage("stop", { stopReason: "aborted" })]),
		});

		expect(result.aborted).toBe(true);
	});
});
