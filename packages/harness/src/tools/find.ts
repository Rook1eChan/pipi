import { spawn } from "node:child_process";
import { relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool } from "@pipi/agent";
import { Type } from "typebox";
import { type ToolDefinition, wrapToolDefinition } from "./definition.ts";
import { ensureTool } from "./support/binary-manager.ts";
import { pathExists, resolveToCwd } from "./support/path-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize, type TruncationResult, truncateKeepHead } from "./support/truncate.ts";

const findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

const DEFAULT_LIMIT = 1000;

export type FindToolInput = { pattern: string; path?: string; limit?: number };

export interface FindToolDetails {
	truncation?: TruncationResult;
	resultLimitReached?: number;
}

/** 把绝对结果路径变成相对搜索根目录的 posix 路径。 */
export function relativizeFindResultPath(resultPath: string, searchPath: string): string {
	const hadTrailingSeparator = resultPath.endsWith(sep);
	const relativePath = relative(searchPath, resultPath);
	const posix = relativePath.split(sep).join("/");
	return hadTrailingSeparator && !posix.endsWith("/") ? `${posix}/` : posix;
}

export function createFindToolDefinition(cwd: string): ToolDefinition<FindToolInput, FindToolDetails> {
	return {
		name: "find",
		label: "find",
		description:
			"Find files by glob pattern with fd (respects .gitignore). Returns paths relative to the search root.",
		promptSnippet: "Find files by glob pattern (respects .gitignore)",
		promptGuidelines: [],
		parameters: findSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		execute: async (_toolCallId, input, signal) => {
			const fdPath = await ensureTool("fd");
			if (!fdPath) throw new Error("fd is not available and could not be downloaded");

			const searchPath = resolveToCwd(input.path ?? ".", cwd);
			if (!(await pathExists(searchPath))) throw new Error(`Path not found: ${searchPath}`);
			const limit = input.limit ?? DEFAULT_LIMIT;

			const child = spawn(
				fdPath,
				["--color", "never", "--hidden", "--exclude", ".git", "--glob", input.pattern, searchPath],
				{ stdio: ["ignore", "pipe", "pipe"] },
			);

			const results: string[] = [];
			let resultLimitReached = false;
			let aborted = false;
			let killedDueToLimit = false;
			let stderr = "";

			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			const stopChild = (dueToLimit = false) => {
				if (child.killed) return;
				killedDueToLimit = dueToLimit;
				child.kill();
			};
			const onAbort = () => {
				aborted = true;
				stopChild();
			};
			signal?.addEventListener("abort", onAbort, { once: true });

			const reader = createInterface({ input: child.stdout });
			reader.on("line", (line) => {
				if (!line.trim() || results.length >= limit) return;
				results.push(relativizeFindResultPath(line, searchPath));
				if (results.length >= limit) {
					resultLimitReached = true;
					stopChild(true);
				}
			});

			const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
				child.once("error", (error) => rejectExit(new Error(`Failed to run fd: ${error.message}`)));
				child.once("close", (code) => resolveExit(code));
			}).finally(() => {
				reader.close();
				signal?.removeEventListener("abort", onAbort);
			});

			if (aborted) throw new Error("Operation aborted");
			if (!killedDueToLimit && exitCode !== 0) {
				throw new Error(stderr.trim() || `fd exited with code ${exitCode}`);
			}
			if (results.length === 0) {
				return { content: [{ type: "text", text: "No files found matching pattern" }], details: undefined };
			}

			const truncation = truncateKeepHead(results.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
			const details: FindToolDetails = {};
			const notices: string[] = [];
			let output = truncation.content;
			if (resultLimitReached) {
				notices.push(`${limit} results limit reached`);
				details.resultLimitReached = limit;
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

export function createFindTool(cwd: string): AgentTool<Record<string, unknown>, FindToolDetails> {
	return wrapToolDefinition(createFindToolDefinition(cwd));
}
