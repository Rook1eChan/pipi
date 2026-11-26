import type { AgentMessage } from "@pipi/agent";
import type { ImageContent, TextContent, Usage } from "@pipi/llm";

/** 会话文件第一行的头部。 */
export interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string; // fork出的会话的父指针
}

/** 所有条目的公共字段；id 与 parentId 组成树。 */
export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

/** 一条对话消息。 */
export interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

/** 模型切换。 */
export interface ModelChangeEntry extends SessionEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

/** 思考级别切换。 */
export interface ThinkingLevelChangeEntry extends SessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

/** 上下文压缩：用摘要替代 firstKeptEntryId 之前的内容。 */
export interface CompactionEntry<T = unknown> extends SessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	usage?: Usage;
	/** 是否由扩展生成；扩展摘要不继承文件清单。 */
	fromHook?: boolean;
}

/** 扩展私有数据，不进入 LLM 上下文。 */
export interface CustomEntry<T = unknown> extends SessionEntryBase {
	type: "custom";
	customType: string;
	data?: T;
}

/** 扩展注入的消息，会进入 LLM 上下文。 */
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: T;
	display: boolean;
}

/** 会话元信息，例如显示名。 */
export interface SessionInfoEntry extends SessionEntryBase {
	type: "session_info";
	name?: string;
}

/** 离开一条分支时生成的摘要，挂在导航目标之后。 */
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
	type: "branch_summary";
	/** 旧分支的末端。 */
	fromId: string;
	summary: string;
	details?: T;
	usage?: Usage;
	/** 是否由扩展生成；扩展摘要不继承文件清单。 */
	fromHook?: boolean;
}

export type SessionEntry =
	| SessionMessageEntry
	| ModelChangeEntry
	| ThinkingLevelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

/** 会话树的节点：条目 + 子节点。 */
export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
}

/** 会话列表项：用于恢复选择器。 */
export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	name?: string;
	parentSessionPath?: string;
}
