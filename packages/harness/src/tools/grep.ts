import { spawn } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool } from "@pipi/agent";
import { Type } from "typebox";
import { type ToolDefinition, wrapToolDefinition } from "./definition.ts";
import { ensureTool } from "./support/binary-manager.ts";
import { resolveToCwd } from "./support/path-utils.ts";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateKeepHead,
	truncateLine,
} from "./support/truncate.ts";

const grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string (default: false)" })),
	context: Type.Optional(Type.Number({ description: "Lines of context around each match (default: 0)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

const DEFAULT_LIMIT = 100;

export type GrepToolInput = {
	pattern: string;
	path?: string;
	glob?: string;
	ignoreCase?: boolean;
	literal?: boolean;
	context?: number;
	limit?: number;
};

export interface GrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
}

export interface GrepToolOptions {
	cwd?: string;
}

interface Match {
	filePath: string;
	lineNumber: number;
	lineText?: string;
}

export function createGrepToolDefinition(
	cwd: string,
	options?: GrepToolOptions,
): ToolDefinition<GrepToolInput, GrepToolDetails> {
	const root = options?.cwd ?? cwd;

	return {
		name: "grep",
		label: "grep",
		description:
			"Search file contents with ripgrep (respects .gitignore). Returns matching lines with file and line numbers.",
		promptSnippet: "Search file contents for patterns (respects .gitignore)",
		promptGuidelines: [],
		parameters: grepSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		execute: async (_toolCallId, input, signal) => {
			const rgPath = await ensureTool("rg");
			if (!rgPath) throw new Error("ripgrep is not available and could not be downloaded");

			const searchPath = resolveToCwd(input.path ?? ".", root);
			const limit = input.limit ?? DEFAULT_LIMIT;
			const contextValue = input.context ?? 0;

			const args = ["--json", "--line-number", "--color=never", "--hidden"];
			if (input.ignoreCase) args.push("--ignore-case");
			if (input.literal) args.push("--fixed-strings");
			if (input.glob) args.push("--glob", input.glob);
			args.push("--", input.pattern, searchPath);

			const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
			const matches: Match[] = [];
			let matchLimitReached = false;
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
				if (!line.trim() || matches.length >= limit) return;
				let event: {
					type?: string;
					data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
				};
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}
				if (event.type !== "match") return;
				const filePath = event.data?.path?.text;
				const lineNumber = event.data?.line_number;
				if (!filePath || typeof lineNumber !== "number") return;
				matches.push({ filePath, lineNumber, lineText: event.data?.lines?.text });
				if (matches.length >= limit) {
					matchLimitReached = true;
					stopChild(true);
				}
			});

			const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
				child.once("error", (error) => rejectExit(new Error(`Failed to run ripgrep: ${error.message}`)));
				child.once("close", (code) => resolveExit(code));
			}).finally(() => {
				reader.close();
				signal?.removeEventListener("abort", onAbort);
			});

			if (aborted) throw new Error("Operation aborted");
			if (!killedDueToLimit && exitCode !== 0 && exitCode !== 1) {
				throw new Error(stderr.trim() || `ripgrep exited with code ${exitCode}`);
			}
			if (matches.length === 0) return { content: [{ type: "text", text: "No matches found" }], details: undefined };

			const formatPath = (filePath: string): string => {
				const relativePath = relative(searchPath, filePath);
				return relativePath && !relativePath.startsWith("..")
					? relativePath.replace(/\\/g, "/")
					: basename(filePath);
			};

			const fileCache = new Map<string, string[]>();
			const linesOf = async (filePath: string): Promise<string[]> => {
				const cached = fileCache.get(filePath);
				if (cached) return cached;
				try {
					const content = await fsReadFile(filePath, "utf-8");
					const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
					fileCache.set(filePath, lines);
					return lines;
				} catch {
					return [];
				}
			};

			const outputLines: string[] = [];
			let linesTruncated = false;
			for (const match of matches) {
				const relativePath = formatPath(match.filePath);
				if (contextValue === 0 && match.lineText !== undefined) {
					const sanitized = match.lineText.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
					const { text, wasTruncated } = truncateLine(sanitized);
					if (wasTruncated) linesTruncated = true;
					outputLines.push(`${relativePath}:${match.lineNumber}: ${text}`);
					continue;
				}

				const lines = await linesOf(match.filePath);
				if (lines.length === 0) {
					outputLines.push(`${relativePath}:${match.lineNumber}: (unable to read file)`);
					continue;
				}
				const start = Math.max(1, match.lineNumber - contextValue);
				const end = Math.min(lines.length, match.lineNumber + contextValue);
				for (let current = start; current <= end; current++) {
					const { text, wasTruncated } = truncateLine((lines[current - 1] ?? "").replace(/\r/g, ""));
					if (wasTruncated) linesTruncated = true;
					const separator = current === match.lineNumber ? ":" : "-";
					outputLines.push(`${relativePath}${separator}${current}${separator} ${text}`);
				}
			}

			const truncation = truncateKeepHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
			const details: GrepToolDetails = {};
			const notices: string[] = [];
			let output = truncation.content;
			if (matchLimitReached) {
				notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`);
				details.matchLimitReached = limit;
			}
			if (truncation.truncated) {
				notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
				details.truncation = truncation;
			}
			if (linesTruncated) {
				notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
				details.linesTruncated = true;
			}
			if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

			return {
				content: [{ type: "text", text: output }],
				details: Object.keys(details).length > 0 ? details : undefined,
			};
		},
	};
}

export function createGrepTool(
	cwd: string,
	options?: GrepToolOptions,
): AgentTool<Record<string, unknown>, GrepToolDetails> {
	return wrapToolDefinition(createGrepToolDefinition(cwd, options));
}
