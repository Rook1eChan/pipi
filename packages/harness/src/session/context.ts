import type { AgentMessage } from "@pipi/agent";
import type { ModelThinkingLevel } from "@pipi/llm";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage } from "./messages.ts";
import type { CompactionEntry, SessionEntry } from "./types.ts";

export interface SessionContext {
	messages: AgentMessage[];
	thinkingLevel: ModelThinkingLevel;
	model: { provider: string; modelId: string } | null;
}

/** 顺序过一遍消息路径，得到该路径最终的模型与思考级别 */
export function getSessionContextSettings(path: SessionEntry[]): Pick<SessionContext, "thinkingLevel" | "model"> {
	let thinkingLevel: ModelThinkingLevel = "off";
	let model: SessionContext["model"] = null;

	for (const entry of path) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel as ModelThinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		}
	}

	return { thinkingLevel, model };
}

/** 把条目转成上下文消息；不参与上下文的条目返回空数组。 */
export function entryToContextMessages(entry: SessionEntry): AgentMessage[] {
	if (entry.type === "message") return [entry.message];
	if (entry.type === "custom_message") {
		return [
			createCustomMessage(entry.customType, entry.content ?? [], entry.display, entry.details, entry.timestamp),
		];
	}
	if (entry.type === "compaction" && entry.summary) {
		return [createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)];
	}
	if (entry.type === "branch_summary" && entry.summary) {
		return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
	}
	return [];
}

/**
 * 按压缩裁剪路径：最新压缩条目排在最前，被它替代的旧条目省略，
 * firstKeptEntryId 之后的条目保留。
 */
export function selectContextEntries(path: SessionEntry[]): SessionEntry[] {
	let compaction: CompactionEntry | null = null;
	for (const entry of path) {
		if (entry.type === "compaction") compaction = entry;
	}
	if (!compaction) return path;

	const compactionIndex = path.findIndex((entry) => entry.id === compaction?.id);
	if (compactionIndex < 0) return path;

	const result: SessionEntry[] = [compaction];
	let foundFirstKept = false;
	for (let index = 0; index < compactionIndex; index++) {
		const entry = path[index];
		if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
		if (foundFirstKept) result.push(entry);
	}
	result.push(...path.slice(compactionIndex + 1));
	return result;
}

/** 物理路径 → 可发送给模型的上下文。 */
export function buildSessionContext(path: SessionEntry[]): SessionContext {
	const { thinkingLevel, model } = getSessionContextSettings(path);
	const messages = selectContextEntries(path).flatMap(entryToContextMessages);
	return { messages, thinkingLevel, model };
}
