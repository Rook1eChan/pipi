import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AgentMessage } from "@pipi/agent";
import type { ImageContent, TextContent, Usage } from "@pipi/llm";
import { getSessionsRoot } from "../config.ts";
import { buildSessionContext, type SessionContext, selectContextEntries } from "./context.ts";
import { resolveSessionName, sanitizeSessionName } from "./name.ts";
import type {
	BranchSummaryEntry,
	CompactionEntry,
	CustomEntry,
	CustomMessageEntry,
	FileEntry,
	ModelChangeEntry,
	SessionEntry,
	SessionHeader,
	SessionInfoEntry,
	SessionMessageEntry,
	SessionTreeNode,
	ThinkingLevelChangeEntry,
} from "./types.ts";

const READ_BUFFER_SIZE = 1024 * 1024;

/** 新建会话的选项。 */
export interface NewSessionOptions {
	id?: string;
	parentSession?: string;
}

/** 会话存储的选项。 */
export interface SessionManagerOptions {
	/** 会话目录；省略时按 projectDir 推导到 `~/.pipi/sessions/--projectDir--`。 */
	sessionDir?: string;
	/** 是否落盘。 */
	persist?: boolean;
}

export { getSessionsRoot } from "../config.ts";

/** 路径上最新的一条压缩条目；没有返回 null。 */
export function getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		if (entries[index].type === "compaction") return entries[index] as CompactionEntry;
	}
	return null;
}

/** 把 projectDir 转成安全的目录名。 */
export function getDefaultSessionDir(projectDir: string): string {
	const resolved = resolve(projectDir);
	const safe = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(getSessionsRoot(), safe);
}

// 校验session id是否合法。这一步是防止外部的会话文件名不合法
export function assertValidSessionId(id: string): void {
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
		throw new Error(
			"Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character",
		);
	}
}

function generateEntryId(byId: { has(id: string): boolean }): string {
	for (let attempt = 0; attempt < 100; attempt++) {
		const id = randomUUID().slice(0, 8);
		if (!byId.has(id)) return id;
	}
	return randomUUID();
}

function parseLine(line: string): FileEntry | null {
	if (!line.trim()) return null;
	try {
		return JSON.parse(line) as FileEntry;
	} catch {
		// 坏行直接跳过，保留其余内容
		return null;
	}
}

/** 逐行读取会话文件；坏行被忽略。 */
export function loadEntriesFromFile(filePath: string): FileEntry[] {
	const entries: FileEntry[] = [];
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return entries;
	}

	try {
		const decoder = new StringDecoder("utf8");
		const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE);
		let pending = "";
		while (true) {
			const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			pending += decoder.write(buffer.subarray(0, bytesRead));
			let lineStart = 0;
			for (let index = pending.indexOf("\n"); index !== -1; index = pending.indexOf("\n", lineStart)) {
				const entry = parseLine(pending.slice(lineStart, index));
				if (entry) entries.push(entry);
				lineStart = index + 1;
			}
			pending = pending.slice(lineStart);
		}
		pending += decoder.end();
		const last = parseLine(pending);
		if (last) entries.push(last);
	} finally {
		closeSync(fd);
	}

	// 头部校验：第一行必须是 session，否则视为非会话文件
	const header = entries[0];
	if (!header || header.type !== "session" || typeof header.id !== "string") return [];
	return entries;
}

/**
 * 会话存储：追加条目、延迟落盘、按文件恢复。
 * 追加只增不改；分支与上下文重建建立在 id/parentId 之上。
 */
export class SessionManager {
	private sessionId = ""; // 会话唯一标识
	private sessionFile: string | undefined; // 会话文件的路径
	private readonly sessionDir: string; // 会话文件夹
	private readonly projectDir: string; // 工作目录
	private readonly persist: boolean; // 是否持久化
	private flushed = false; // 内存里的内容是否全部写入文件
	private fileEntries: FileEntry[] = []; // 内存里的完整会话文件内容
	private byId = new Map<string, SessionEntry>(); // id-entry的索引
	private leafId: string | null = null; // 最后一个entry的id

	constructor(projectDir: string, options: SessionManagerOptions = {}) {
		this.projectDir = resolve(projectDir);
		this.persist = options.persist ?? true;
		// sessionDir指项目会话存储的位置，不指定通过projectDir推导
		this.sessionDir = options.sessionDir ?? getDefaultSessionDir(this.projectDir);
		if (this.persist) mkdirSync(this.sessionDir, { recursive: true });
		this.newSession();
	}

	// 打开已有会话
	static open(projectDir: string, filePath: string, options: SessionManagerOptions = {}): SessionManager {
		const manager = new SessionManager(projectDir, options);
		manager.load(filePath);
		return manager;
	}

	/** 只存在内存里，不写文件。 */
	static inMemory(projectDir: string): SessionManager {
		return new SessionManager(projectDir, { persist: false });
	}

	newSession(options: NewSessionOptions = {}): string | undefined {
		if (options.id !== undefined) assertValidSessionId(options.id);
		this.sessionId = options.id ?? randomUUID();
		const timestamp = new Date().toISOString();
		const header: SessionHeader = {
			type: "session",
			id: this.sessionId,
			timestamp,
			projectDir: this.projectDir,
			parentSession: options.parentSession,
		};
		this.fileEntries = [header];
		this.byId.clear();
		this.leafId = null;
		this.flushed = false;
		if (this.persist) {
			const fileTimestamp = timestamp.replace(/[:.]/g, "-");
			this.sessionFile = join(this.sessionDir, `${fileTimestamp}_${this.sessionId}.jsonl`);
		}
		return this.sessionFile;
	}

	// 载入一个会话文件
	load(filePath: string): void {
		this.sessionFile = resolve(filePath);
		// 文件不存在：在给定路径下新建一个会话
		if (!existsSync(this.sessionFile)) {
			this.newSession();
			this.sessionFile = resolve(filePath);
			return;
		}

		// 文件为空：补一个header
		if (statSync(this.sessionFile).size === 0) {
			this.newSession();
			this.sessionFile = resolve(filePath);
			this.rewriteFile();
			this.flushed = true;
			return;
		}

		// 存在内容，加载
		const entries = loadEntriesFromFile(this.sessionFile);
		const header = entries[0];
		if (!header || header.type !== "session") {
			throw new Error(`Session file is not a valid session: ${this.sessionFile}`);
		}
		this.sessionId = header.id;
		this.fileEntries = entries;
		this.buildIndex();
		this.flushed = true;
	}

	appendMessage(message: AgentMessage): string {
		const entry: SessionMessageEntry = {
			type: "message",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			message,
		};
		return this.appendEntry(entry);
	}

	appendModelChange(provider: string, modelId: string): string {
		const entry: ModelChangeEntry = {
			type: "model_change",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			provider,
			modelId,
		};
		return this.appendEntry(entry);
	}

	appendThinkingLevelChange(thinkingLevel: string): string {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			thinkingLevel,
		};
		return this.appendEntry(entry);
	}

	/** 扩展私有数据；不进入上下文。 */
	appendCustomEntry(customType: string, data?: unknown): string {
		const entry: CustomEntry = {
			type: "custom",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			customType,
			data,
		};
		return this.appendEntry(entry);
	}

	/** 扩展注入的消息；进入上下文。 */
	appendCustomMessageEntry(
		customType: string,
		content: string | (TextContent | ImageContent)[],
		display: boolean,
		details?: unknown,
	): string {
		const entry: CustomMessageEntry = {
			type: "custom_message",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			customType,
			content,
			display,
			details,
		};
		return this.appendEntry(entry);
	}

	/** 记录一次压缩；摘要文本由调用方生成。 */
	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
		usage?: Usage,
	): string {
		const entry: CompactionEntry<T> = {
			type: "compaction",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			summary,
			firstKeptEntryId,
			tokensBefore,
			details,
			fromHook,
			usage,
		};
		return this.appendEntry(entry);
	}

	appendSessionInfo(name: string): string {
		const entry: SessionInfoEntry = {
			type: "session_info",
			id: generateEntryId(this.byId),
			parentId: this.leafId,
			timestamp: new Date().toISOString(),
			name: sanitizeSessionName(name),
		};
		return this.appendEntry(entry);
	}

	/** 当前名称；空名称视为未命名。 */
	getSessionName(): string | undefined {
		return resolveSessionName(this.getEntries());
	}

	getSessionId(): string {
		return this.sessionId;
	}

	getSessionFile(): string | undefined {
		return this.sessionFile;
	}

	getSessionDir(): string {
		return this.sessionDir;
	}

	getProjectDir(): string {
		return this.projectDir;
	}

	getLeafId(): string | null {
		return this.leafId;
	}

	getHeader(): SessionHeader | null {
		const header = this.fileEntries.find((entry) => entry.type === "session");
		return header ? (header as SessionHeader) : null;
	}

	/** 返回条目的浅拷贝，按写入顺序。 */
	getEntries(): SessionEntry[] {
		return this.fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	}

	getEntry(id: string): SessionEntry | undefined {
		return this.byId.get(id);
	}

	/** 把叶指针指向指定条目；下一次的追加形成一个分支。 */
	branchWithSummary(
		branchFromId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
		usage?: Usage,
	): string {
		if (branchFromId !== null && !this.byId.has(branchFromId)) {
			throw new Error(`Entry ${branchFromId} not found`);
		}
		const fromId = this.leafId ?? "root";
		this.leafId = branchFromId;
		const entry: BranchSummaryEntry = {
			type: "branch_summary",
			id: generateEntryId(this.byId),
			parentId: branchFromId,
			timestamp: new Date().toISOString(),
			fromId,
			summary,
			details,
			usage,
			fromHook,
		};
		return this.appendEntry(entry);
	}

	branch(branchFromId: string): void {
		if (!this.byId.has(branchFromId)) throw new Error(`Entry ${branchFromId} not found`);
		this.leafId = branchFromId;
	}

	/** 叶指针回到起点之前，下一次追加成为新的根。 */
	resetLeaf(): void {
		this.leafId = null;
	}

	/**
	 * 把根到指定叶的路径抽成新会话文件；新头部的 parentSession 指向原文件。
	 * 原会话保持不变。
	 */
	createBranchedSession(leafId: string): string | undefined {
		const path = this.getEntryPath(leafId);
		if (path.length === 0) throw new Error(`Entry ${leafId} not found`);

		const previousFile = this.sessionFile;
		const newSessionId = randomUUID();
		const timestamp = new Date().toISOString();
		const fileTimestamp = timestamp.replace(/[:.]/g, "-");

		const header: SessionHeader = {
			type: "session",
			id: newSessionId,
			timestamp,
			projectDir: this.projectDir,
			parentSession: this.persist ? previousFile : undefined,
		};

		this.fileEntries = [header, ...path.map((entry) => ({ ...entry }))];
		this.sessionId = newSessionId;
		if (!this.persist) {
			this.buildIndex();
			return undefined;
		}

		this.sessionFile = join(this.sessionDir, `${fileTimestamp}_${newSessionId}.jsonl`);
		this.buildIndex();
		const hasAssistant = this.fileEntries.some(
			(candidate) => candidate.type === "message" && candidate.message.role === "assistant",
		);
		if (hasAssistant) {
			this.rewriteFile();
			this.flushed = true;
		} else {
			this.flushed = false;
		}
		return this.sessionFile;
	}

	getLeafEntry(): SessionEntry | undefined {
		return this.leafId ? this.byId.get(this.leafId) : undefined;
	}

	/** 直接子节点，按写入顺序。 */
	getChildren(parentId: string | null): SessionEntry[] {
		return this.getEntries().filter((entry) => entry.parentId === parentId);
	}

	/** 从指定条目（默认当前叶）沿 parentId 上溯到根，获得这一条完整路径 */
	getEntryPath(fromId?: string): SessionEntry[] {
		const path: SessionEntry[] = [];
		let current = fromId ? this.byId.get(fromId) : this.leafId ? this.byId.get(this.leafId) : undefined;
		while (current) {
			path.push(current);
			current = current.parentId ? this.byId.get(current.parentId) : undefined;
		}
		path.reverse();
		return path;
	}

	/** 物理路径按压缩裁剪后的结果。 */
	getSelectedEntryPath(): SessionEntry[] {
		return selectContextEntries(this.getEntryPath());
	}

	/** 可发送给模型的上下文：消息 + 模型 + 思考级别。 */
	getSessionContext(): SessionContext {
		return buildSessionContext(this.getEntryPath());
	}

	/** 整棵树；根是 parentId 为空或父节点不存在的条目。 */
	getTree(): SessionTreeNode[] {
		const nodes = new Map<string, SessionTreeNode>();
		for (const entry of this.getEntries()) nodes.set(entry.id, { entry, children: [] });

		const roots: SessionTreeNode[] = [];
		for (const entry of this.getEntries()) {
			const node = nodes.get(entry.id) as SessionTreeNode;
			const parent = entry.parentId ? nodes.get(entry.parentId) : undefined;
			if (parent) parent.children.push(node);
			else roots.push(node);
		}
		return roots;
	}

	private appendEntry(entry: SessionEntry): string {
		this.fileEntries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		this.persistEntry(entry);
		return entry.id;
	}

	private buildIndex(): void {
		this.byId.clear();
		this.leafId = null;
		for (const entry of this.fileEntries) {
			if (entry.type === "session") continue;
			this.byId.set(entry.id, entry);
			this.leafId = entry.id;
		}
	}

	private rewriteFile(): void {
		if (!this.persist || !this.sessionFile) return;
		const fd = openSync(this.sessionFile, "w");
		try {
			for (const entry of this.fileEntries) writeFileSync(fd, `${JSON.stringify(entry)}\n`);
		} finally {
			closeSync(fd);
		}
	}

	/**
	 * 延迟落盘：在出现第一条助手消息之前只保留在内存里，避免留下只有提问的残缺会话。
	 */
	private persistEntry(entry: SessionEntry): void {
		if (!this.persist || !this.sessionFile) return;
		const hasAssistant = this.fileEntries.some(
			(candidate) => candidate.type === "message" && candidate.message.role === "assistant",
		);
		if (!hasAssistant) {
			this.flushed = false;
			return;
		}
		if (!this.flushed) {
			const fd = openSync(this.sessionFile, "w");
			try {
				for (const candidate of this.fileEntries) writeFileSync(fd, `${JSON.stringify(candidate)}\n`);
			} finally {
				closeSync(fd);
			}
			this.flushed = true;
			return;
		}
		appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
	}
}
