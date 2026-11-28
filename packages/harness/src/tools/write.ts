import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool } from "@pipi/agent";
import { Type } from "typebox";
import { type ToolDefinition, wrapToolDefinition } from "./definition.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToProjectDir } from "./support/path-utils.ts";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = { path: string; content: string };

export interface WriteOperations {
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	mkdir: (dir: string) => Promise<void>;
}

const defaultOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
	operations?: WriteOperations;
}

export function createWriteToolDefinition(
	projectDir: string,
	options?: WriteToolOptions,
): ToolDefinition<WriteToolInput, undefined> {
	const ops = options?.operations ?? defaultOperations;

	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: "Create or overwrite files",
		promptGuidelines: ["Use write only for new files or complete rewrites."],
		parameters: writeSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		execute: async (_toolCallId, input, signal) => {
			const absolutePath = resolveToProjectDir(input.path, projectDir);
			const dir = dirname(absolutePath);

			return withFileMutationQueue(absolutePath, async () => {
				// 不从中止事件里 reject：那会在文件操作完成前释放队列锁
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();
				await ops.mkdir(dir);
				throwIfAborted();
				await ops.writeFile(absolutePath, input.content);
				throwIfAborted();

				return {
					content: [{ type: "text" as const, text: `Successfully wrote to ${input.path}` }],
					details: undefined,
				};
			});
		},
	};
}

export function createWriteTool(
	projectDir: string,
	options?: WriteToolOptions,
): AgentTool<Record<string, unknown>, undefined> {
	return wrapToolDefinition(createWriteToolDefinition(projectDir, options));
}
