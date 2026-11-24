import { readdir as fsReaddir, stat as fsStat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "@pipi/agent";
import { Type } from "typebox";
import { type ToolDefinition, wrapToolDefinition } from "./support/definition.ts";
import { pathExists, resolveToCwd } from "./support/path-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateKeepHead } from "./support/truncate.ts";

const lsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
});

const DEFAULT_LIMIT = 500;

export type LsToolInput = { path?: string; limit?: number };

export interface LsToolDetails {
	truncation?: TruncationResult;
	entryLimitReached?: number;
}

export interface LsOperations {
	exists: (absolutePath: string) => Promise<boolean>;
	stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
	readdir: (absolutePath: string) => Promise<string[]>;
}

const defaultOperations: LsOperations = {
	exists: pathExists,
	stat: (path) => fsStat(path),
	readdir: (path) => fsReaddir(path),
};

export interface LsToolOptions {
	operations?: LsOperations;
}

export function createLsToolDefinition(
	cwd: string,
	options?: LsToolOptions,
): ToolDefinition<LsToolInput, LsToolDetails> {
	const ops = options?.operations ?? defaultOperations;

	return {
		name: "ls",
		label: "ls",
		description: "List directory contents. Directories are marked with a trailing slash.",
		promptSnippet: "List directory contents",
		promptGuidelines: [],
		parameters: lsSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		execute: async (_toolCallId, input, signal) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const dirPath = resolveToCwd(input.path ?? ".", cwd);
			const limit = input.limit ?? DEFAULT_LIMIT;

			if (!(await ops.exists(dirPath))) throw new Error(`Path not found: ${dirPath}`);
			const info = await ops.stat(dirPath);
			if (!info.isDirectory()) throw new Error(`Not a directory: ${dirPath}`);
			if (signal?.aborted) throw new Error("Operation aborted");

			const entries = (await ops.readdir(dirPath)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

			const results: string[] = [];
			let entryLimitReached = false;
			for (const entry of entries) {
				if (results.length >= limit) {
					entryLimitReached = true;
					break;
				}
				try {
					const entryInfo = await ops.stat(join(dirPath, entry));
					results.push(entryInfo.isDirectory() ? `${entry}/` : entry);
				} catch {
					// 无法 stat 的条目直接跳过
				}
			}

			if (signal?.aborted) throw new Error("Operation aborted");
			if (results.length === 0) {
				return { content: [{ type: "text", text: "(empty directory)" }], details: undefined };
			}

			const truncation = truncateKeepHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
			const details: LsToolDetails = {};
			const notices: string[] = [];
			let output = truncation.content;
			if (entryLimitReached) {
				notices.push(`${limit} entries limit reached. Use limit=${limit * 2} for more`);
				details.entryLimitReached = limit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation;
			}
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

			return {
				content: [{ type: "text", text: output }],
				details: Object.keys(details).length > 0 ? details : undefined,
			};
		},
	};
}

export function createLsTool(cwd: string, options?: LsToolOptions): AgentTool<Record<string, unknown>, LsToolDetails> {
	return wrapToolDefinition(createLsToolDefinition(cwd, options));
}
