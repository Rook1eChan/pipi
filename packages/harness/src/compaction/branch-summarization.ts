import type { AgentMessage, StreamFn } from "@pipi/agent";
import type {
	Model,
	ProviderHeaders,
	RetryCallbacks,
	RetryPolicy,
	SimpleStreamOptions,
	ThinkingLevel,
	Usage,
} from "@pipi/llm";
import { entryToContextMessages } from "../session/context.ts";
import { convertToLlm } from "../session/messages.ts";
import type { SessionEntry } from "../session/types.ts";
import { type CompleteSimpleFn, completeSummarization, getSummarizationFailure } from "./compaction.ts";
import { estimateTokens } from "./estimate.ts";
import {
	computeFileLists,
	contentText,
	createFileOps,
	extractFileOpsFromMessage,
	extractFileOpsFromSummary,
	type FileOperations,
	formatFileOperations,
	SUMMARIZATION_SYSTEM_PROMPT,
	serializeConversation,
} from "./utils.ts";

/** 分支摘要的生成结果。 */
export interface BranchSummaryResult {
	summary?: string;
	usage?: Usage;
	readFiles?: string[];
	modifiedFiles?: string[];
	aborted?: boolean;
	error?: string;
}

export interface BranchPreparation {
	messages: AgentMessage[];
	fileOps: FileOperations;
	totalTokens: number;
}

export interface CollectEntriesResult {
	entries: SessionEntry[];
	commonAncestorId: string | null;
}

export interface GenerateBranchSummaryOptions {
	model: Model;
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: Record<string, string>;
	signal: AbortSignal;
	customInstructions?: string;
	replaceInstructions?: boolean;
	reserveTokens?: number;
	streamFn?: StreamFn;
	completeSimple?: CompleteSimpleFn;
	thinkingLevel?: ThinkingLevel;
	retry?: RetryPolicy;
	retryCallbacks?: RetryCallbacks;
}

/** 只读的会话访问接口，避免依赖具体 SessionManager 实现。 */
export interface BranchSessionReader {
	getEntryPath(fromId?: string): SessionEntry[];
	getEntry(id: string): SessionEntry | undefined;
}

/**
 * 收集从旧位置回到公共祖先之间的条目，按时间正序。
 * 压缩条目会保留，摘要内容本身成为上下文。
 */
export function collectEntriesForBranchSummary(
	session: BranchSessionReader,
	oldLeafId: string | null,
	targetId: string,
): CollectEntriesResult {
	if (!oldLeafId) return { entries: [], commonAncestorId: null };

	const oldPath = new Set(session.getEntryPath(oldLeafId).map((entry) => entry.id));
	const targetPath = session.getEntryPath(targetId);

	let commonAncestorId: string | null = null;
	for (let index = targetPath.length - 1; index >= 0; index--) {
		if (oldPath.has(targetPath[index].id)) {
			commonAncestorId = targetPath[index].id;
			break;
		}
	}

	const entries: SessionEntry[] = [];
	let current: string | null = oldLeafId;
	while (current && current !== commonAncestorId) {
		const entry = session.getEntry(current);
		if (!entry) break;
		entries.push(entry);
		current = entry.parentId;
	}
	entries.reverse();

	return { entries, commonAncestorId };
}

function getMessageFromEntry(entry: SessionEntry): AgentMessage | undefined {
	const message = entryToContextMessages(entry)[0];
	if (!message) return undefined;
	if (message.role === "toolResult") return undefined;
	return message;
}

/** 从新到旧按预算收集消息；摘要条目在接近预算时仍尽量保留。 */
export function prepareBranchEntries(entries: SessionEntry[], tokenBudget = 0): BranchPreparation {
	const messages: AgentMessage[] = [];
	const fileOps = createFileOps();
	let totalTokens = 0;

	for (const entry of entries) {
		if (entry.type === "branch_summary") {
			extractFileOpsFromSummary(entry, fileOps);
		}
	}

	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		const message = getMessageFromEntry(entry);
		if (!message) continue;

		extractFileOpsFromMessage(message, fileOps);
		const tokens = estimateTokens(message);

		if (tokenBudget > 0 && totalTokens + tokens > tokenBudget) {
			if (entry.type === "compaction" || entry.type === "branch_summary") {
				if (totalTokens < tokenBudget * 0.9) {
					messages.unshift(message);
					totalTokens += tokens;
				}
			}
			break;
		}

		messages.unshift(message);
		totalTokens += tokens;
	}

	return { messages, fileOps, totalTokens };
}

const BRANCH_SUMMARY_PREAMBLE = `The user explored a different conversation branch before returning here.
Summary of that exploration:

`;

const BRANCH_SUMMARY_PROMPT = `Create a structured summary of this conversation branch for context when returning later.

Use this EXACT format:

## Goal
[What was the user trying to accomplish in this branch?]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Work that was started but not finished]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [What should happen next to continue this work]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

/** 生成被放弃分支的摘要。 */
export async function generateBranchSummary(
	entries: SessionEntry[],
	options: GenerateBranchSummaryOptions,
): Promise<BranchSummaryResult> {
	const reserveTokens = options.reserveTokens ?? 16384;
	const contextWindow = options.model.contextWindow || 128000;
	const tokenBudget = contextWindow - reserveTokens;

	const { messages, fileOps } = prepareBranchEntries(entries, tokenBudget);
	if (messages.length === 0) return { summary: "No content to summarize" };

	const conversationText = serializeConversation(convertToLlm(messages));

	let instructions: string;
	if (options.replaceInstructions && options.customInstructions) {
		instructions = options.customInstructions;
	} else if (options.customInstructions) {
		instructions = `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${options.customInstructions}`;
	} else {
		instructions = BRANCH_SUMMARY_PROMPT;
	}
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${instructions}`;
	const summarizationMessages: AgentMessage[] = [
		{
			role: "user",
			content: [{ type: "text", text: promptText }],
			timestamp: Date.now(),
		},
	];

	const maxTokens = Math.min(4096, options.model.maxTokens > 0 ? options.model.maxTokens : Number.POSITIVE_INFINITY);
	const requestOptions: SimpleStreamOptions = {
		apiKey: options.apiKey,
		headers: options.headers,
		env: options.env,
		signal: options.signal,
		maxTokens,
		...(options.model.reasoning && options.thinkingLevel ? { reasoning: options.thinkingLevel } : {}),
	};
	const response = await completeSummarization(
		options.model,
		{ systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: convertToLlm(summarizationMessages) },
		requestOptions,
		options.streamFn,
		options.completeSimple,
		options.retry,
		options.retryCallbacks,
	);

	if (response.stopReason === "aborted") return { aborted: true };
	const failure = getSummarizationFailure(response, "Branch summarization");
	if (failure) return { error: failure };
	if (response.content.some((block) => block.type === "toolCall")) {
		return { error: "Branch summarization attempted to call a tool" };
	}

	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	const summary =
		BRANCH_SUMMARY_PREAMBLE + contentText(response.content) + formatFileOperations(readFiles, modifiedFiles);

	return {
		summary: summary || "No summary generated",
		usage: response.usage,
		readFiles,
		modifiedFiles,
	};
}
