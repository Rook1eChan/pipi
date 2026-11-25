import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message } from "@pipi/llm";
import { afterEach, describe, expect, it } from "vitest";
import { findMostRecentSession, listSessions, openMostRecentSession } from "../../src/session/discovery.ts";
import { exportSessionToJsonl } from "../../src/session/export.ts";
import { SessionManager } from "../../src/session/manager.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-discovery-"));
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

describe("session discovery", () => {
	it("finds the most recent session for a cwd", async () => {
		const sessionDir = await tempDir();
		const cwd = await tempDir();
		const first = new SessionManager(cwd, { sessionDir });
		first.appendMessage(user("first"));
		first.appendMessage(assistant("ok"));

		// 文件系统 mtime 精度有限，隔开一点再建第二个会话
		await new Promise((resolve) => setTimeout(resolve, 20));

		const second = new SessionManager(cwd, { sessionDir });
		second.appendMessage(user("second"));
		second.appendMessage(assistant("ok"));

		expect(findMostRecentSession(sessionDir, cwd)).toBe(second.getSessionFile());
		expect(findMostRecentSession(sessionDir, join(cwd, "missing"))).toBeNull();
	});

	it("lists sessions with metadata and filters by cwd", async () => {
		const sessionDir = await tempDir();
		const cwd = await tempDir();
		const manager = new SessionManager(cwd, { sessionDir });
		manager.appendMessage(user("hello there"));
		manager.appendMessage(assistant("ok"));
		manager.appendSessionInfo("named session");

		const sessions = listSessions(sessionDir, cwd);

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ id: manager.getSessionId(), cwd, messageCount: 2, name: "named session" });
		expect(sessions[0].firstMessage).toBe("hello there");
		expect(listSessions(sessionDir, join(cwd, "other"))).toHaveLength(0);
	});

	it("returns no name when the latest session_info is empty", async () => {
		const sessionDir = await tempDir();
		const cwd = await tempDir();
		const manager = new SessionManager(cwd, { sessionDir });
		manager.appendMessage(user("hello"));
		manager.appendMessage(assistant("ok"));
		manager.appendSessionInfo("named");
		manager.appendSessionInfo("");

		const sessions = listSessions(sessionDir, cwd);

		expect(sessions[0].name).toBeUndefined();
		expect(sessions[0].firstMessage).toBe("hello");
	});

	it("reopens the most recent session", async () => {
		const sessionDir = await tempDir();
		const cwd = await tempDir();
		const manager = new SessionManager(cwd, { sessionDir });
		manager.appendMessage(user("hi"));
		manager.appendMessage(assistant("ok"));

		const reopened = openMostRecentSession(cwd, { sessionDir });

		expect(reopened.getSessionId()).toBe(manager.getSessionId());
		expect(reopened.getEntries()).toHaveLength(2);
	});
});

describe("export", () => {
	it("contains header, messages and a re-linked parent chain", async () => {
		const dir = await tempDir();
		const manager = new SessionManager(dir, { sessionDir: dir });
		manager.appendMessage(user("hi"));
		manager.appendMessage(assistant("ok"));
		const output = join(dir, "exported.jsonl");
		exportSessionToJsonl(manager, output);

		const lines = (await readFile(output, "utf-8")).trim().split("\n");
		const entries = lines.map((line) => JSON.parse(line));

		expect(entries[0]).toMatchObject({ type: "session" });
		expect(entries[1].parentId).toBeNull();
		expect(entries[2].parentId).toBe(entries[1].id);
	});
});
