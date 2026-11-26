import type { AgentMessage, StreamFn } from "@pipi/agent";
import { describe, expect, it } from "vitest";
import { compact, findCutPoint, generateSummaryWithUsage, prepareCompaction } from "../../src/compaction/compaction.ts";
import { type CompactionPreparation, DEFAULT_COMPACTION_SETTINGS } from "../../src/compaction/types.ts";
import { contentText, createFileOps } from "../../src/compaction/utils.ts";
import { assistantMessage, messageEntry, model, streamFrom, usage, userMessage } from "./fixtures.ts";

function toolResult(id: string, text: string, timestamp = 3) {
	return {
		role: "toolResult" as const,
		toolCallId: id,
		toolName: "read",
		content: [{ type: "text" as const, text }],
		isError: false,
		timestamp,
	};
}

function basePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
	return {
		firstKeptEntryId: "keep",
		messagesToSummarize: [userMessage("a".repeat(400))],
		turnPrefixMessages: [],
		isSplitTurn: false,
		tokensBefore: 100,
		fileOps: createFileOps(),
		settings: { ...DEFAULT_COMPACTION_SETTINGS, reserveTokens: 1000 },
		...overrides,
	};
}

describe("findCutPoint", () => {
	it("never cuts at a tool result", () => {
		const entries = [
			messageEntry("u1", userMessage("first"), null),
			messageEntry(
				"a1",
				assistantMessage("call", {
					toolCalls: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "a" } }],
				}),
				"u1",
			),
			messageEntry("t1", toolResult("1", "result"), "a1"),
			messageEntry("u2", userMessage("second"), "t1"),
			messageEntry("a2", assistantMessage("done"), "u2"),
		];

		const result = findCutPoint(entries, 0, entries.length, 2);

		expect(entries[result.firstKeptEntryIndex].type).toBe("message");
		expect((entries[result.firstKeptEntryIndex] as { message: AgentMessage }).message.role).not.toBe("toolResult");
	});

	it("detects a split turn", () => {
		const entries = [
			messageEntry("u1", userMessage("request"), null),
			messageEntry(
				"a1",
				assistantMessage("call", {
					toolCalls: [{ type: "toolCall", id: "1", name: "read", arguments: { path: "a" } }],
				}),
				"u1",
			),
			messageEntry("t1", toolResult("1", "result"), "a1"),
			messageEntry("a2", assistantMessage("done"), "t1"),
		];

		const result = findCutPoint(entries, 0, entries.length, 3);

		expect(result.isSplitTurn).toBe(true);
		expect(result.turnStartIndex).toBe(0);
		expect((entries[result.firstKeptEntryIndex] as { message: AgentMessage }).message.role).toBe("assistant");
	});
});

describe("prepareCompaction", () => {
	it("returns undefined when the last entry is already compacted", () => {
		const entries = [
			messageEntry("u1", userMessage("hello"), null),
			{
				type: "compaction" as const,
				id: "c1",
				parentId: "u1",
				timestamp: "2026-01-01T00:00:00.000Z",
				summary: "done",
				firstKeptEntryId: "u1",
				tokensBefore: 1,
			},
		];
		expect(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS)).toBeUndefined();
	});

	it("collects messages before the cut point", () => {
		const entries = Array.from({ length: 8 }, (_, index) =>
			messageEntry(
				`e${index}`,
				index % 2 === 0
					? userMessage(`request ${index}`, index)
					: assistantMessage(`answer ${index}`, { timestamp: index }),
				index === 0 ? null : `e${index - 1}`,
			),
		);

		const preparation = prepareCompaction(entries, {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 2,
		});

		expect(preparation).toBeDefined();
		expect(preparation?.messagesToSummarize.length).toBeGreaterThan(0);
		expect(entries.some((entry) => entry.id === preparation?.firstKeptEntryId)).toBe(true);
	});
});

describe("compact", () => {
	it("returns a summary and usage", async () => {
		const result = await compact(basePreparation(), {
			model: model(),
			streamFn: streamFrom([assistantMessage("checkpoint summary", { usage: usage(7) })]),
		});

		expect(result.summary).toBe("checkpoint summary");
		expect(result.usage?.totalTokens).toBe(7);
		expect(result.firstKeptEntryId).toBe("keep");
		expect(result.details).toEqual({ readFiles: [], modifiedFiles: [] });
	});

	it("combines history and turn prefix summaries for a split turn", async () => {
		const result = await compact(
			basePreparation({
				isSplitTurn: true,
				messagesToSummarize: [userMessage("history")],
				turnPrefixMessages: [assistantMessage("prefix")],
			}),
			{
				model: model(),
				streamFn: streamFrom([assistantMessage("history summary"), assistantMessage("prefix summary")]),
			},
		);

		expect(result.summary).toContain("history summary");
		expect(result.summary).toContain("Turn Context (split turn)");
		expect(result.summary).toContain("prefix summary");
	});

	it("appends the file list", async () => {
		const fileOps = createFileOps();
		fileOps.written.add("/tmp/changed.ts");
		fileOps.read.add("/tmp/read.ts");

		const result = await compact(basePreparation({ fileOps }), {
			model: model(),
			streamFn: streamFrom([assistantMessage("summary")]),
		});

		expect(result.summary).toContain("<modified-files>\n/tmp/changed.ts\n</modified-files>");
		expect(result.summary).toContain("<read-files>\n/tmp/read.ts\n</read-files>");
	});

	it("rejects a length-truncated summary", async () => {
		await expect(
			compact(basePreparation(), {
				model: model(),
				streamFn: streamFrom([assistantMessage("partial", { stopReason: "length" })]),
			}),
		).rejects.toThrow("token cap");
	});

	it("rejects a summary that calls a tool", async () => {
		await expect(
			compact(basePreparation(), {
				model: model(),
				streamFn: streamFrom([
					assistantMessage("summary", {
						toolCalls: [{ type: "toolCall", id: "1", name: "read", arguments: {} }],
					}),
				]),
			}),
		).rejects.toThrow("attempted to call a tool");
	});
});

describe("generateSummaryWithUsage", () => {
	it("uses the update prompt when a previous summary exists", async () => {
		let captured = "";
		const streamFn: StreamFn = (_model, context, _options) => {
			const content = context.messages[0].content;
			captured = typeof content === "string" ? content : contentText(content);
			return streamFrom([assistantMessage("updated")])(_model, context, _options);
		};

		const result = await generateSummaryWithUsage([userMessage("new work")], {
			model: model(),
			reserveTokens: 1000,
			previousSummary: "old summary",
			streamFn,
		});

		expect(result.text).toBe("updated");
		expect(captured).toContain("<previous-summary>");
		expect(captured).toContain("old summary");
	});
});
