import { describe, expect, it } from "vitest";
import { getLatestCompactionEntry, SessionManager } from "../../src/session/manager.ts";
import { assistantMessage, usage, userMessage } from "../compaction/fixtures.ts";

describe("branch summary entries", () => {
	it("writes a branch summary at the target position", () => {
		const session = SessionManager.inMemory("/tmp/branch-summary");
		const first = session.appendMessage(userMessage("start"));
		const oldLeaf = session.appendMessage(assistantMessage("old work"));

		const summaryId = session.branchWithSummary(
			first,
			"abandoned branch summary",
			{ readFiles: ["/tmp/a.ts"], modifiedFiles: [] },
			false,
			usage(12),
		);

		const entry = session.getEntry(summaryId);
		expect(entry).toMatchObject({
			type: "branch_summary",
			parentId: first,
			fromId: oldLeaf,
			summary: "abandoned branch summary",
			usage: { totalTokens: 12 },
		});
		expect(session.getEntryPath().map((item) => item.id)).toEqual([first, summaryId]);
	});

	it("turns a branch summary into a context message", () => {
		const session = SessionManager.inMemory("/tmp/branch-summary");
		const first = session.appendMessage(userMessage("start"));
		session.appendMessage(assistantMessage("old work"));
		session.branchWithSummary(first, "summary text");

		const context = session.getSessionContext();

		expect(context.messages.at(-1)).toMatchObject({
			role: "branchSummary",
			summary: "summary text",
			fromId: expect.any(String),
		});
	});
});

describe("compaction entries", () => {
	it("stores details, usage and fromHook", () => {
		const session = SessionManager.inMemory("/tmp/compaction-entry");
		const first = session.appendMessage(userMessage("start"));

		const id = session.appendCompaction(
			"summary",
			first,
			123,
			{ readFiles: [], modifiedFiles: ["/tmp/a.ts"] },
			false,
			usage(5),
		);

		expect(session.getEntry(id)).toMatchObject({
			type: "compaction",
			firstKeptEntryId: first,
			tokensBefore: 123,
			details: { modifiedFiles: ["/tmp/a.ts"] },
			usage: { totalTokens: 5 },
			fromHook: false,
		});
	});

	it("finds the latest compaction entry", () => {
		const session = SessionManager.inMemory("/tmp/compaction-entry");
		const first = session.appendMessage(userMessage("start"));
		session.appendCompaction("first", first, 10);
		const second = session.appendMessage(assistantMessage("after"));
		session.appendCompaction("second", second, 20);

		const latest = getLatestCompactionEntry(session.getEntryPath());

		expect(latest?.summary).toBe("second");
		expect(getLatestCompactionEntry([session.getEntry(first)!])).toBeNull();
	});
});
