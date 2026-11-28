import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import type { AgentTool } from "@pipi/agent";
import { Type } from "typebox";
import { type ToolDefinition, wrapToolDefinition } from "./definition.ts";
import {
	applyEditsToNormalizedContent,
	detectLineEnding,
	type Edit,
	generateDiffString,
	generateUnifiedPatch,
	normalizeToLF,
	restoreLineEndings,
	splitBom,
} from "./support/edit-diff.ts";
import { withFileMutationQueue } from "./support/file-mutation-queue.ts";
import { resolveToProjectDir } from "./support/path-utils.ts";

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	edits: Type.Array(
		Type.Object({
			oldText: Type.String({ description: "Exact text to replace. Must match a unique region of the file." }),
			newText: Type.String({ description: "Replacement text; use an empty string to delete." }),
		}),
		{ description: "One or more replacements to apply in order." },
	),
});

export type EditToolInput = { path: string; edits: Edit[] };

export interface EditToolDetails {
	diff: string;
	patch: string;
	firstChangedLine?: number;
}

export interface EditOperations {
	access: (absolutePath: string) => Promise<void>;
	readFile: (absolutePath: string) => Promise<Buffer>;
	writeFile: (absolutePath: string, content: string) => Promise<void>;
}

const defaultOperations: EditOperations = {
	access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
	readFile: (path) => fsReadFile(path),
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
};

// 历史输入兼容：edits 可能是 JSON 字符串、单个对象，或早期的 oldText/newText 平铺写法
function prepareEditArguments(input: unknown): EditToolInput {
	if (!input || typeof input !== "object") return input as EditToolInput;

	const args = input as Record<string, unknown>;
	if (typeof args.edits === "string") {
		try {
			const parsed = JSON.parse(args.edits);
			if (Array.isArray(parsed)) args.edits = parsed;
			else if (isSingleEdit(parsed)) args.edits = [parsed];
		} catch {
			// 解析失败时保留原值，交给校验报错
		}
	} else if (isSingleEdit(args.edits)) {
		args.edits = [args.edits];
	}

	if (typeof args.oldText !== "string" || typeof args.newText !== "string") return args as EditToolInput;

	const edits = Array.isArray(args.edits) ? [...(args.edits as Edit[])] : [];
	edits.push({ oldText: args.oldText, newText: args.newText });
	const { oldText: _oldText, newText: _newText, ...rest } = args;
	return { ...rest, edits } as EditToolInput;
}

function isSingleEdit(value: unknown): value is Edit {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Edit).oldText === "string" &&
		typeof (value as Edit).newText === "string"
	);
}

export interface EditToolOptions {
	operations?: EditOperations;
}

export function createEditToolDefinition(
	projectDir: string,
	options?: EditToolOptions,
): ToolDefinition<EditToolInput, EditToolDetails> {
	const ops = options?.operations ?? defaultOperations;

	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits.",
		promptSnippet: "Edit files by exact text replacement",
		promptGuidelines: [
			"Use edit for targeted changes; use write only for new files or complete rewrites.",
			"Include enough surrounding context in oldText so the match is unique.",
		],
		parameters: editSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		prepareArguments: prepareEditArguments as (args: unknown) => Record<string, unknown>,
		execute: async (_toolCallId, input, signal) => {
			const absolutePath = resolveToProjectDir(input.path, projectDir);

			return withFileMutationQueue(absolutePath, async () => {
				const throwIfAborted = () => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();
				try {
					await ops.access(absolutePath);
				} catch (error) {
					throwIfAborted();
					const code = error instanceof Error && "code" in error ? ` (${error.code})` : "";
					throw new Error(`Could not edit file: ${input.path}${code}.`);
				}

				throwIfAborted();
				const rawContent = (await ops.readFile(absolutePath)).toString("utf-8");
				throwIfAborted();

				// 模型不会在 oldText 里写不可见字符，先剥离再匹配
				const { bom, text } = splitBom(rawContent);
				const ending = detectLineEnding(text);
				const normalized = normalizeToLF(text);
				const { baseContent, newContent } = applyEditsToNormalizedContent(normalized, input.edits, input.path);
				if (newContent === baseContent) {
					return {
						content: [{ type: "text" as const, text: `No changes made to ${input.path}.` }],
						details: undefined,
					};
				}

				await ops.writeFile(absolutePath, bom + restoreLineEndings(newContent, ending));
				throwIfAborted();

				const diff = generateDiffString(baseContent, newContent);
				return {
					content: [
						{
							type: "text" as const,
							text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.`,
						},
					],
					details: {
						diff: diff.diff,
						patch: generateUnifiedPatch(input.path, baseContent, newContent),
						firstChangedLine: diff.firstChangedLine,
					},
				};
			});
		},
	};
}

export function createEditTool(
	projectDir: string,
	options?: EditToolOptions,
): AgentTool<Record<string, unknown>, EditToolDetails> {
	return wrapToolDefinition(createEditToolDefinition(projectDir, options));
}
