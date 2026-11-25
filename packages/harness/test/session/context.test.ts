import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message } from "@pipi/llm";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildSessionContext,
	entryToContextMessages,
	getSessionContextSettings,
	selectContextEntries,
} from "../../src/session/context.ts";
import { SessionManager } from "../../src/session/manager.ts";
import { convertToLlm } from "../../src/session/messages.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-context-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistant(text: string, provider = "faux", model = "m1"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider,
		model,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

describe("tree path", () => {
	it("walks from the leaf to the root", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir, persist: false });
		const first = manager.appendMessage(user("a"));
		const second = manager.appendMessage(assistant("b"));

		expect(manager.getEntryPath().map((entry) => entry.id)).toEqual([first, second]);
		expect(manager.getEntryPath(first).map((entry) => entry.id)).toEqual([first]);
		expect(manager.getTree()).toHaveLength(1);
		expect(manager.getTree()[0].children[0].entry.id).toBe(second);
	});

	it("follows a manual branch recorded in the file", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir, persist: false });
		const root = manager.appendMessage(user("a"));
		const firstBranch = manager.appendMessage(assistant("b"));
		// 模拟从 root 分叉出的第二条支路
		const secondBranch = manager.appendMessage(assistant("c"));
		(manager.getEntry(secondBranch) as { parentId: string | null }).parentId = root;

		expect(manager.getEntryPath(firstBranch).map((entry) => entry.id)).toEqual([root, firstBranch]);
		expect(manager.getEntryPath(secondBranch).map((entry) => entry.id)).toEqual([root, secondBranch]);
		expect(manager.getChildren(root).map((entry) => entry.id)).toEqual([firstBranch, secondBranch]);
	});
});

describe("compaction trimming", () => {
	it("keeps the summary and the entries after firstKeptEntryId", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir, persist: false });
		const m1 = manager.appendMessage(user("one"));
		const m2 = manager.appendMessage(assistant("two"));
		const m3 = manager.appendMessage(user("three"));
		const compaction = manager.appendCompaction("summary of one", m2, 100);
		const m4 = manager.appendMessage(assistant("four"));

		const selected = selectContextEntries(manager.getEntryPath());

		expect(selected.map((entry) => entry.id)).toEqual([compaction, m2, m3, m4]);
		expect(selected[0].id).toBe(compaction);
		expect(selected.map((entry) => entry.id)).not.toContain(m1);
		expect(manager.getSelectedEntryPath()[0].id).toBe(compaction);
	});
});

describe("context messages", () => {
	it("converts entries into messages and skips state entries", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir, persist: false });
		manager.appendMessage(user("hi"));
		manager.appendModelChange("faux", "m2");
		manager.appendThinkingLevelChange("high");
		manager.appendCustomEntry("notes", { a: 1 });
		manager.appendCustomMessageEntry("injected", "remember", true);

		const context = manager.getSessionContext();

		expect(context.messages.map((message) => message.role)).toEqual(["user", "custom"]);
		expect(context.model).toEqual({ provider: "faux", modelId: "m2" });
		expect(context.thinkingLevel).toBe("high");
	});

	it("replays the model from assistant messages", () => {
		const settings = getSessionContextSettings([
			{
				type: "message",
				id: "e1",
				parentId: null,
				timestamp: "t",
				message: assistant("hi", "deepseek", "chat"),
			},
		]);

		expect(settings.model).toEqual({ provider: "deepseek", modelId: "chat" });
	});

	it("maps custom and compaction messages to user messages for the model", () => {
		const entries = [
			{
				type: "custom_message",
				id: "e1",
				parentId: null,
				timestamp: "t",
				customType: "x",
				content: "note",
				display: true,
			},
			{
				type: "compaction",
				id: "e2",
				parentId: "e1",
				timestamp: "t",
				summary: "sum",
				firstKeptEntryId: "e1",
				tokensBefore: 10,
			},
		] as Parameters<typeof entryToContextMessages>[0][];

		const messages = entries.flatMap(entryToContextMessages);
		const llm = convertToLlm(messages);

		expect(llm[0]).toMatchObject({ role: "user", content: [{ type: "text", text: "note" }] });
		expect((llm[1].content as { text: string }[])[0].text).toContain("<summary>\nsum\n</summary>");
		expect(buildSessionContext([])).toEqual({ messages: [], thinkingLevel: "off", model: null });
	});
});
