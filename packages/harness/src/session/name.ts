import type { SessionEntry } from "./types.ts";

/** 名称写入前的清洗：换行折叠为空格，去掉首尾空白。 */
export function sanitizeSessionName(name: string): string {
	return name.replace(/[\r\n]+/g, " ").trim();
}

/**
 * 取会话名称：倒序找最后一条 session_info。
 * 空字符串表示清除名称，返回 undefined，由界面回退到首条消息。
 */
export function resolveSessionName(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type === "session_info") return entry.name?.trim() || undefined;
	}
	return undefined;
}
