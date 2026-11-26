import type { AgentMessage } from "@pipi/agent";
import type { Usage } from "@pipi/llm";
import type { FileOperations } from "./utils.ts";

/** 压缩设置；课程 16 起由 SettingsManager 提供。 */
export interface CompactionSettings {
	enabled: boolean;
	/** 预留给下一次请求与摘要输出的 token。 */
	reserveTokens: number;
	/** 压缩后希望保留的最近原文 token 预算。 */
	keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,
	keepRecentTokens: 20000,
};

/** 压缩条目携带的文件清单。 */
export interface CompactionDetails {
	readFiles: string[];
	modifiedFiles: string[];
}

/** 一次压缩的结果；SessionManager 负责写入 uuid 与父节点。 */
export interface CompactionResult<T = unknown> {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	usage?: Usage;
	/** 扩展私有数据，例如文件清单或结构化压缩信息。 */
	details?: T;
}

/** 压缩前的准备结果。 */
export interface CompactionPreparation {
	/** 从这里开始的条目保留原文。 */
	firstKeptEntryId: string;
	/** 将被摘要并丢弃的历史消息。 */
	messagesToSummarize: AgentMessage[];
	/** split turn 时，这一轮前半段的消息。 */
	turnPrefixMessages: AgentMessage[];
	/** 切点是否落在一轮中间。 */
	isSplitTurn: boolean;
	tokensBefore: number;
	/** 上一次压缩的摘要，用于更新而不是重写。 */
	previousSummary?: string;
	fileOps: FileOperations;
	settings: CompactionSettings;
}

/** 消息列表的 token 估算结果。 */
export interface ContextUsageEstimate {
	tokens: number;
	usageTokens: number;
	trailingTokens: number;
	lastUsageIndex: number | null;
}

/** 切点计算结果。 */
export interface CutPointResult {
	/** 第一个保留条目的下标。 */
	firstKeptEntryIndex: number;
	/** 切点所在轮次的起点，-1 表示没有切开一轮。 */
	turnStartIndex: number;
	isSplitTurn: boolean;
}
