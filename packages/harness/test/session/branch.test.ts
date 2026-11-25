import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message } from "@pipi/llm";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/session/manager.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-branch-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "faux",
		model: "m",
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

describe("branching", () => {
	it("moves the leaf so the next entry becomes a sibling", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir, persist: false });
		const root = manager.appendMessage(user("hi"));
		const first = manager.appendMessage(assistant("first"));
		manager.appendMessage(user("more"));
		manager.branch(first);

		const second = manager.appendMessage(assistant("second"));

		expect(manager.getChildren(root).map((entry) => entry.id)).toEqual([first]);
		expect(manager.getChildren(first).map((entry) => entry.id)).toContain(second);
		expect(manager.getEntryPath().map((entry) => entry.id)).toEqual([root, first, second]);
	});

	it("doubles as a new root after resetLeaf", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir, persist: false });
		manager.appendMessage(user("hi"));
		manager.resetLeaf();

		const root = manager.appendMessage(user("again"));

		expect(manager.getEntry(root)?.parentId).toBeNull();
	});

	it("extracts a single path into a new session file", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir });
		const root = manager.appendMessage(user("hi"));
		const first = manager.appendMessage(assistant("first"));
		manager.branch(root);
		const second = manager.appendMessage(assistant("second"));

		const newFile = manager.createBranchedSession(second) as string;
		const lines = (await readFile(newFile, "utf-8")).trim().split("\n");

		expect(JSON.parse(lines[0])).toMatchObject({ type: "session", parentSession: expect.any(String) });
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[1]).id).toBe(root);
		expect(JSON.parse(lines[2]).id).toBe(second);
		expect(first).not.toBe(second);
	});
});
