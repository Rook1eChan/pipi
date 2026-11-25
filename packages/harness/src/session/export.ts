import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SessionManager } from "./manager.ts";

/**
 * 把当前分支导出成新JSONL。
 * parentId 会按路径重新串成一条完整链
 */
export function exportSessionToJsonl(manager: SessionManager, outputPath?: string): string {
	// 定路径
	const filePath = resolve(outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
	mkdirSync(dirname(filePath), { recursive: true });

	// 创建新header
	const header = {
		type: "session" as const,
		id: manager.getSessionId(),
		timestamp: new Date().toISOString(),
		cwd: manager.getCwd(),
	};
	const lines = [JSON.stringify(header)];
	let parentId: string | null = null;

	// 把当前分支的内容依次加入并重新构建parentId
	for (const entry of manager.getEntryPath()) {
		lines.push(JSON.stringify({ ...entry, parentId }));
		parentId = entry.id;
	}

	// 写文件
	writeFileSync(filePath, `${lines.join("\n")}\n`);
	return filePath;
}
