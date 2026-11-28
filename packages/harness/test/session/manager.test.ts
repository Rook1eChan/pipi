import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message } from "@pipi/llm";
import { afterEach, describe, expect, it } from "vitest";
import { assertValidSessionId, loadEntriesFromFile, SessionManager } from "../../src/session/manager.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-session-"));
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

describe("SessionManager persistence", () => {
	it("defers file creation until the first assistant message", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir });
		const file = manager.getSessionFile() as string;

		manager.appendMessage(user("hi"));
		expect(existsSync(file)).toBe(false);

		manager.appendMessage(assistant("hello"));
		expect(existsSync(file)).toBe(true);

		const lines = (await readFile(file, "utf-8")).trim().split("\n");
		expect(lines).toHaveLength(3);
		expect(JSON.parse(lines[0])).toMatchObject({ type: "session", projectDir: dir });
		expect(JSON.parse(lines[0])).not.toHaveProperty("version");
	});

	it("reloads entries from the file", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir });
		manager.appendMessage(user("hi"));
		manager.appendMessage(assistant("hello"));
		const file = manager.getSessionFile() as string;

		const reopened = SessionManager.open(dir, file, { sessionDir: dir });

		expect(reopened.getSessionId()).toBe(manager.getSessionId());
		expect(reopened.getEntries()).toHaveLength(2);
		expect(reopened.getEntries()[1]).toMatchObject({ type: "message", parentId: manager.getEntries()[0].id });
	});

	it("round-trips custom entries, custom messages and session info", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir });
		manager.appendMessage(user("hi"));
		manager.appendMessage(assistant("hello"));
		manager.appendCustomEntry("notes", { count: 2 });
		manager.appendCustomMessageEntry("injected", "remember this", true);
		manager.appendSessionInfo("my session");
		const file = manager.getSessionFile() as string;

		const reopened = SessionManager.open(dir, file, { sessionDir: dir });
		const entries = reopened.getEntries();

		expect(entries.map((entry) => entry.type)).toEqual([
			"message",
			"message",
			"custom",
			"custom_message",
			"session_info",
		]);
		expect(entries[2]).toMatchObject({ customType: "notes", data: { count: 2 } });
		expect(entries[3]).toMatchObject({ customType: "injected", display: true });
		expect(entries[4]).toMatchObject({ name: "my session" });
	});
});

describe("loadEntriesFromFile", () => {
	it("skips malformed lines", async () => {
		const dir = await tempDir();
		const file = join(dir, "session.jsonl");
		await writeFile(
			file,
			[
				JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "t", projectDir: dir }),
				"{not json",
				JSON.stringify({ type: "message", id: "e1", parentId: null, timestamp: "t", message: user("hi") }),
				"",
			].join("\n"),
		);

		const entries = loadEntriesFromFile(file);

		expect(entries).toHaveLength(2);
		expect(entries[1]).toMatchObject({ type: "message", id: "e1" });
	});

	it("rejects files that are not sessions", async () => {
		const dir = await tempDir();
		const file = join(dir, "session.jsonl");
		await writeFile(file, "hello\n");

		expect(() => SessionManager.open(dir, file, { sessionDir: dir })).toThrowError(/not a valid session/);
	});

	it("initializes an empty file with a header", async () => {
		const dir = await tempDir();
		const file = join(dir, "session.jsonl");
		await writeFile(file, "");

		const manager = SessionManager.open(dir, file, { sessionDir: dir });

		expect(manager.getEntries()).toHaveLength(0);
		const header = JSON.parse((await readFile(file, "utf-8")).trim());
		expect(header).toMatchObject({ type: "session" });
	});
});

describe("format tolerance", () => {
	it("keeps unknown entry types instead of failing", async () => {
		const dir = await tempDir();
		const file = join(dir, "session.jsonl");
		await writeFile(
			file,
			[
				JSON.stringify({ type: "session", id: "abc", timestamp: "t", projectDir: dir }),
				JSON.stringify({ type: "future_entry", id: "f1", parentId: null, timestamp: "t" }),
			].join("\n"),
		);

		const manager = SessionManager.open(dir, file, { sessionDir: dir });

		expect(manager.getEntries()).toHaveLength(1);
		expect(manager.getEntries()[0]).toMatchObject({ type: "future_entry", id: "f1" });
	});
});

describe("session name", () => {
	it("sanitizes newlines and trims", () => {
		const manager = SessionManager.inMemory("/tmp");
		manager.appendSessionInfo("  first\nsecond  ");

		expect(manager.getSessionName()).toBe("first second");
	});

	it("uses the latest name and treats an empty name as cleared", () => {
		const manager = SessionManager.inMemory("/tmp");
		manager.appendSessionInfo("old");
		manager.appendSessionInfo("new");
		expect(manager.getSessionName()).toBe("new");

		manager.appendSessionInfo("   ");
		expect(manager.getSessionName()).toBeUndefined();
	});
});

describe("assertValidSessionId", () => {
	it("accepts safe ids and rejects others", () => {
		expect(() => assertValidSessionId("abc-123")).not.toThrow();
		expect(() => assertValidSessionId("")).toThrow();
		expect(() => assertValidSessionId("../etc")).toThrow();
	});
});
