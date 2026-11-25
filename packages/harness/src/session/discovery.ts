import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDefaultSessionDir, loadEntriesFromFile, SessionManager, type SessionManagerOptions } from "./manager.ts";
import { resolveSessionName } from "./name.ts";
import type { SessionEntry, SessionHeader, SessionInfo } from "./types.ts";

const HEADER_SCAN_BYTES = 8192;

/** 只读第一行，快速拿到会话头部。 */
export function readSessionHeader(filePath: string): SessionHeader | null {
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return null;
	}
	try {
		const buffer = Buffer.allocUnsafe(HEADER_SCAN_BYTES);
		const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
		const text = buffer.subarray(0, bytesRead).toString("utf-8");
		const line = text.split("\n")[0];
		if (!line) return null;
		const parsed = JSON.parse(line) as SessionHeader;
		return parsed.type === "session" && typeof parsed.id === "string" ? parsed : null;
	} catch {
		return null;
	} finally {
		closeSync(fd);
	}
}

function sameCwd(a: string | undefined, b: string): boolean {
	return a !== undefined && resolve(a) === resolve(b);
}

function firstUserText(entries: SessionEntry[]): string {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		for (const block of message.content) {
			if (block.type === "text") return block.text;
		}
	}
	return "";
}

export interface SessionFile {
	path: string;
	header: SessionHeader;
	modified: Date;
}

/** 列出目录里的会话文件，按修改时间倒序。 */
export function listSessionFiles(sessionDir: string): SessionFile[] {
	let names: string[];
	try {
		names = readdirSync(sessionDir);
	} catch {
		return [];
	}

	const files: SessionFile[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(sessionDir, name);
		const header = readSessionHeader(path);
		if (!header) continue;
		try {
			files.push({ path, header, modified: statSync(path).mtime });
		} catch {
			// 文件在扫描期间被删除
		}
	}
	return files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** 最近一次会话；传 cwd 时只考虑同一工作目录。 */
export function findMostRecentSession(sessionDir: string, cwd?: string): string | null {
	const files = listSessionFiles(sessionDir).filter((file) => cwd === undefined || sameCwd(file.header.cwd, cwd));
	return files[0]?.path ?? null;
}

/** 会话摘要列表，供恢复选择器使用。 */
export function listSessions(sessionDir: string, cwd?: string): SessionInfo[] {
	const files = listSessionFiles(sessionDir).filter((file) => cwd === undefined || sameCwd(file.header.cwd, cwd));

	return files.map((file) => {
		const fileEntries = loadEntriesFromFile(file.path);
		const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
		const messageCount = entries.filter((entry) => entry.type === "message").length;
		return {
			path: file.path,
			id: file.header.id,
			cwd: file.header.cwd,
			created: new Date(file.header.timestamp),
			modified: file.modified,
			messageCount,
			firstMessage: firstUserText(entries),
			name: resolveSessionName(entries),
			parentSessionPath: file.header.parentSession,
		};
	});
}

/** 打开当前目录最近一次会话；没有则新建。 */
export function openMostRecentSession(cwd: string, options: SessionManagerOptions = {}): SessionManager {
	const sessionDir = options.sessionDir ?? getDefaultSessionDir(cwd);
	const manager = new SessionManager(cwd, { ...options, sessionDir });
	const file = findMostRecentSession(sessionDir, cwd);
	if (file) manager.load(file);
	return manager;
}
