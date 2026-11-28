import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import type { AgentTool, AgentToolResult } from "@pipi/agent";
import type { ImageContent, TextContent } from "@pipi/llm";
import { Type } from "typebox";
import { detectSupportedImageMimeTypeFromFile } from "../utils/images/mime.ts";
import { processImage } from "../utils/images/process.ts";
import { type ToolDefinition, wrapToolDefinition } from "./definition.ts";
import { resolveReadPath } from "./support/path-utils.ts";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateKeepHead,
} from "./support/truncate.ts";

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = {
	path: string;
	offset?: number;
	limit?: number;
};

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

/** 可替换的底层操作，便于把读取委托给远程环境。 */
export interface ReadOperations {
	readFile: (absolutePath: string) => Promise<Buffer>;
	access: (absolutePath: string) => Promise<void>;
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

export interface ReadToolOptions {
	/** 是否自动压缩图片。默认 true。 */
	autoResizeImages?: boolean;
	/** 当前模型是否支持图片输入；false 时在结果里附一句说明。 */
	modelSupportsImages?: boolean;
	operations?: ReadOperations;
}

interface ReadOutput {
	content: (TextContent | ImageContent)[];
	details: ReadToolDetails | undefined;
}

const NO_IMAGE_NOTE = "[Current model does not support images. The image will be omitted from this request.]";

/** 文本文件的读取与截断。 */
function readText(buffer: Buffer, path: string, offset: number | undefined, limit: number | undefined): ReadOutput {
	const allLines = buffer.toString("utf-8").split("\n");
	const totalFileLines = allLines.length;
	// offset 是 1 起始，内部按 0 起始处理
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const startLineDisplay = startLine + 1;
	if (startLine >= allLines.length) {
		throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
	}

	let selected: string;
	let userLimitedLines: number | undefined;
	if (limit !== undefined) {
		const endLine = Math.min(startLine + limit, allLines.length);
		selected = allLines.slice(startLine, endLine).join("\n");
		userLimitedLines = endLine - startLine;
	} else {
		selected = allLines.slice(startLine).join("\n");
	}

	const truncation = truncateKeepHead(selected);
	if (truncation.firstLineExceedsLimit) {
		// 半行没有意义，给出可以直接执行的替代命令
		const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
		const text = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
		return { content: [{ type: "text", text }], details: { truncation } };
	}

	if (truncation.truncated) {
		const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
		const nextOffset = endLineDisplay + 1;
		const limitText = truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
		const text = `${truncation.content}\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}${limitText}. Use offset=${nextOffset} to continue.]`;
		return { content: [{ type: "text", text }], details: { truncation } };
	}

	if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
		const remaining = allLines.length - (startLine + userLimitedLines);
		const nextOffset = startLine + userLimitedLines + 1;
		const text = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
		return { content: [{ type: "text", text }], details: undefined };
	}

	return { content: [{ type: "text", text: truncation.content }], details: undefined };
}

export function createReadToolDefinition(
	projectDir: string,
	options?: ReadToolOptions,
): ToolDefinition<ReadToolInput, ReadToolDetails | undefined> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const modelSupportsImages = options?.modelSupportsImages ?? true;
	const ops = options?.operations ?? defaultReadOperations;

	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
		promptSnippet: "Read file contents",
		promptGuidelines: ["Use read to examine files instead of cat or sed."],
		parameters: readSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		execute: (_toolCallId, input, signal) =>
			new Promise<AgentToolResult<ReadToolDetails | undefined>>((resolve, reject) => {
				// 中止要立刻生效，不等文件 I/O 自然结束
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				let aborted = false;
				const onAbort = () => {
					aborted = true;
					reject(new Error("Operation aborted"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });

				void (async () => {
					try {
						const absolutePath = await resolveReadPath(input.path, projectDir);
						if (aborted) return;
						await ops.access(absolutePath);
						if (aborted) return;

						let output: ReadOutput;
						const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
						if (mimeType) {
							const buffer = await ops.readFile(absolutePath);
							const processed = await processImage(buffer, mimeType, { autoResizeImages });
							if (!processed.ok) {
								const text = [`Read image file [${mimeType}]`, processed.message];
								if (!modelSupportsImages) text.push(NO_IMAGE_NOTE);
								output = { content: [{ type: "text", text: text.join("\n") }], details: undefined };
							} else {
								const text = [`Read image file [${processed.mimeType}]`, ...processed.hints];
								if (!modelSupportsImages) text.push(NO_IMAGE_NOTE);
								output = {
									content: [
										{ type: "text", text: text.join("\n") },
										{ type: "image", data: processed.data, mimeType: processed.mimeType },
									],
									details: undefined,
								};
							}
						} else {
							output = readText(await ops.readFile(absolutePath), input.path, input.offset, input.limit);
						}

						if (aborted) return;
						signal?.removeEventListener("abort", onAbort);
						resolve({ content: output.content, details: output.details });
					} catch (error) {
						signal?.removeEventListener("abort", onAbort);
						if (!aborted) reject(error);
					}
				})();
			}),
	};
}

export function createReadTool(
	projectDir: string,
	options?: ReadToolOptions,
): AgentTool<Record<string, unknown>, ReadToolDetails | undefined> {
	return wrapToolDefinition(createReadToolDefinition(projectDir, options));
}
