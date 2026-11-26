import { randomUUID } from "node:crypto";
import type { AgentMessage, StreamFn } from "@pipi/agent";
import type {
	AssistantMessage,
	Context,
	Model,
	ProviderHeaders,
	SimpleStreamOptions,
	ThinkingLevel,
	Usage,
} from "@pipi/llm";
import { type RetryCallbacks, type RetryPolicy, retryAssistantCall } from "@pipi/llm";
import { entryToContextMessages, selectContextEntries } from "../session/context.ts";
import { convertToLlm } from "../session/messages.ts";
import type { CompactionEntry, SessionEntry } from "../session/types.ts";
import { estimateContextTokens, estimateTokens } from "./estimate.ts";
import type { CompactionPreparation, CompactionResult, CompactionSettings, CutPointResult } from "./types.ts";
import {
	computeFileLists,
	contentText,
	createFileOps,
	extractFileOpsFromMessage,
	extractFileOpsFromSummary,
	formatFileOperations,
	SUMMARIZATION_SYSTEM_PROMPT,
	serializeConversation,
} from "./utils.ts";

export type CompleteSimpleFn = (
	model: Model,
	context: Context,
	options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

// ============================================================================
// Message extraction
// ============================================================================

function getMessageFromEntryForCompaction(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "compaction") return undefined;
	return entryToContextMessages(entry)[0];
}

function combineUsage(first: Usage, second: Usage): Usage {
	return {
		input: first.input + second.input,
		output: first.output + second.output,
		cacheRead: first.cacheRead + second.cacheRead,
		cacheWrite: first.cacheWrite + second.cacheWrite,
		...(first.cacheWrite1h !== undefined || second.cacheWrite1h !== undefined
			? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (second.cacheWrite1h ?? 0) }
			: {}),
		...(first.reasoning !== undefined || second.reasoning !== undefined
			? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
			: {}),
		totalTokens: first.totalTokens + second.totalTokens,
		cost: {
			input: first.cost.input + second.cost.input,
			output: first.cost.output + second.cost.output,
			cacheRead: first.cost.cacheRead + second.cost.cacheRead,
			cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
			total: first.cost.total + second.cost.total,
		},
	};
}

// ============================================================================
// Cut point detection
// ============================================================================

function isCutPointMessage(message: AgentMessage): boolean {
	switch (message.role) {
		case "user":
		case "assistant":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return true;
		case "toolResult":
			return false;
	}
	return false;
}

function isTurnStartMessage(message: AgentMessage): boolean {
	switch (message.role) {
		case "user":
		case "custom":
		case "branchSummary":
		case "compactionSummary":
			return true;
		case "assistant":
		case "toolResult":
			return false;
	}
	return false;
}

function isTurnStartEntry(entry: SessionEntry): boolean {
	if (entry.type === "compaction") return false;
	return entryToContextMessages(entry).some(isTurnStartMessage);
}

function firstCutPointFrom(entries: SessionEntry[], fromIndex: number, endIndex: number): number {
	for (let index = fromIndex; index < endIndex; index++) {
		const entry = entries[index];
		if (entry.type === "compaction") continue;
		if (entryToContextMessages(entry).some(isCutPointMessage)) return index;
	}
	return -1;
}

export function findTurnStartIndex(entries: SessionEntry[], entryIndex: number, startIndex: number): number {
	for (let index = entryIndex; index >= startIndex; index--) {
		if (isTurnStartEntry(entries[index])) return index;
	}
	return -1;
}

/** 在 [startIndex, endIndex) 内找保留最近 `keepRecentTokens` 的切点。 */
export function findCutPoint(
	entries: SessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number,
): CutPointResult {
	let cutIndex = firstCutPointFrom(entries, startIndex, endIndex);
	if (cutIndex < 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	}

	let accumulatedTokens = 0;
	for (let index = endIndex - 1; index >= startIndex; index--) {
		const messageTokens = entryToContextMessages(entries[index]).reduce(
			(sum, message) => sum + estimateTokens(message),
			0,
		);
		if (messageTokens === 0) continue;
		accumulatedTokens += messageTokens;

		if (accumulatedTokens >= keepRecentTokens) {
			const nearest = firstCutPointFrom(entries, index, endIndex);
			if (nearest >= 0) cutIndex = nearest;
			break;
		}
	}

	while (cutIndex > startIndex) {
		const previous = entries[cutIndex - 1];
		if (previous.type === "compaction" || entryToContextMessages(previous).length > 0) break;
		cutIndex--;
	}

	const cutEntry = entries[cutIndex];
	const startsTurn = isTurnStartEntry(cutEntry);
	const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !startsTurn && turnStartIndex !== -1,
	};
}

// ============================================================================
// Preparation
// ============================================================================

/** 计算压缩边界、切点与要摘要的消息。 */
export function prepareCompaction(
	pathEntries: SessionEntry[],
	settings: CompactionSettings,
): CompactionPreparation | undefined {
	if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === "compaction") {
		return undefined;
	}

	let previousCompactionIndex = -1;
	for (let index = pathEntries.length - 1; index >= 0; index--) {
		if (pathEntries[index].type === "compaction") {
			previousCompactionIndex = index;
			break;
		}
	}

	let previousSummary: string | undefined;
	let boundaryStart = 0;
	if (previousCompactionIndex >= 0) {
		const previous = pathEntries[previousCompactionIndex] as CompactionEntry;
		previousSummary = previous.summary;
		const firstKeptEntryIndex = pathEntries.findIndex((entry) => entry.id === previous.firstKeptEntryId);
		boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : previousCompactionIndex + 1;
	}
	const boundaryEnd = pathEntries.length;

	const tokensBefore = estimateContextTokens(selectContextEntries(pathEntries).flatMap(entryToContextMessages)).tokens;

	const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);
	const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
	if (!firstKeptEntry?.id) return undefined;
	const firstKeptEntryId = firstKeptEntry.id;

	const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

	const messagesToSummarize: AgentMessage[] = [];
	for (let index = boundaryStart; index < historyEnd; index++) {
		const message = getMessageFromEntryForCompaction(pathEntries[index]);
		if (message) messagesToSummarize.push(message);
	}

	const turnPrefixMessages: AgentMessage[] = [];
	if (cutPoint.isSplitTurn) {
		for (let index = cutPoint.turnStartIndex; index < cutPoint.firstKeptEntryIndex; index++) {
			const message = getMessageFromEntryForCompaction(pathEntries[index]);
			if (message) turnPrefixMessages.push(message);
		}
	}

	if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

	const fileOps = createFileOps();
	if (previousCompactionIndex >= 0) {
		extractFileOpsFromSummary(pathEntries[previousCompactionIndex] as CompactionEntry, fileOps);
	}
	for (const message of messagesToSummarize) extractFileOpsFromMessage(message, fileOps);
	for (const message of turnPrefixMessages) extractFileOpsFromMessage(message, fileOps);

	return {
		firstKeptEntryId,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn: cutPoint.isSplitTurn,
		tokensBefore,
		previousSummary,
		fileOps,
		settings,
	};
}

// ============================================================================
// Summarization
// ============================================================================

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

/** 摘要失败时返回错误文本；成功返回 undefined。 */
export function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined {
	if (response.stopReason === "error") {
		return `${label} failed: ${response.errorMessage || "Unknown error"}`;
	}
	if (response.stopReason === "length") {
		return `${label} failed: generation hit the token cap and the summary is incomplete`;
	}
	return undefined;
}

function createSummarizationOptions(
	model: Model,
	maxTokens: number,
	options: {
		apiKey?: string;
		headers?: ProviderHeaders;
		env?: Record<string, string>;
		signal?: AbortSignal;
		thinkingLevel?: ThinkingLevel;
		sessionId?: string;
	},
): SimpleStreamOptions {
	const result: SimpleStreamOptions = {
		maxTokens,
		signal: options.signal,
		apiKey: options.apiKey,
		headers: options.headers,
		env: options.env,
		sessionId: options.sessionId,
	};
	if (model.reasoning && options.thinkingLevel) {
		result.reasoning = options.thinkingLevel;
	}
	return result;
}

/** 所有摘要调用的统一入口；带重试与失败检查。 */
export async function completeSummarization(
	model: Model,
	context: Context,
	options: SimpleStreamOptions,
	streamFn?: StreamFn,
	completeSimple?: CompleteSimpleFn,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
	const requestOptions: SimpleStreamOptions = {
		...options,
		cacheRetention: "none",
		sessionId: options.sessionId ?? randomUUID(),
	};
	const produce = async (): Promise<AssistantMessage> => {
		if (streamFn) return (await streamFn(model, context, requestOptions)).result();
		if (completeSimple) return completeSimple(model, context, requestOptions);
		throw new Error("Summarization requires a streamFn or completeSimple callback");
	};
	return retryAssistantCall(produce, retry, requestOptions.signal, callbacks);
}

function buildSummarizationContext(promptText: string): Context {
	return {
		systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
		messages: [{ role: "user", content: [{ type: "text", text: promptText }], timestamp: Date.now() }],
	};
}

export interface SummaryGenerationOptions {
	model: Model;
	reserveTokens: number;
	streamFn?: StreamFn;
	completeSimple?: CompleteSimpleFn;
	customInstructions?: string;
	previousSummary?: string;
	thinkingLevel?: ThinkingLevel;
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: Record<string, string>;
	signal?: AbortSignal;
	retry?: RetryPolicy;
	retryCallbacks?: RetryCallbacks;
	sessionId?: string;
}

/** 生成或更新摘要，并返回本次调用的 usage。 */
export async function generateSummaryWithUsage(
	currentMessages: AgentMessage[],
	options: SummaryGenerationOptions,
): Promise<{ text: string; usage: Usage }> {
	const { model, reserveTokens } = options;
	const maxTokens = Math.min(
		Math.floor(0.8 * reserveTokens),
		model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
	);

	let basePrompt = options.previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
	if (options.customInstructions) {
		basePrompt = `${basePrompt}\n\nAdditional focus: ${options.customInstructions}`;
	}

	const llmMessages = convertToLlm(currentMessages);
	const conversationText = serializeConversation(llmMessages);

	let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (options.previousSummary) {
		promptText += `<previous-summary>\n${options.previousSummary}\n</previous-summary>\n\n`;
	}
	promptText += basePrompt;

	const completionOptions = createSummarizationOptions(model, maxTokens, options);
	const response = await completeSummarization(
		model,
		buildSummarizationContext(promptText),
		completionOptions,
		options.streamFn,
		options.completeSimple,
		options.retry,
		options.retryCallbacks,
	);

	const failure = getSummarizationFailure(response, "Summarization");
	if (failure) throw new Error(failure);
	if (response.content.some((block) => block.type === "toolCall")) {
		throw new Error("Summarization attempted to call a tool");
	}

	return { text: contentText(response.content), usage: response.usage };
}

/** 只返回摘要文本的便捷封装。 */
export async function generateSummary(
	currentMessages: AgentMessage[],
	options: SummaryGenerationOptions,
): Promise<string> {
	return (await generateSummaryWithUsage(currentMessages, options)).text;
}

async function generateTurnPrefixSummary(
	messages: AgentMessage[],
	options: SummaryGenerationOptions,
): Promise<{ text: string; usage: Usage }> {
	const conversationText = serializeConversation(convertToLlm(messages));
	const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
	const maxTokens = Math.min(
		Math.floor(0.8 * options.reserveTokens),
		options.model.maxTokens > 0 ? options.model.maxTokens : Number.POSITIVE_INFINITY,
	);
	const response = await completeSummarization(
		options.model,
		buildSummarizationContext(promptText),
		createSummarizationOptions(options.model, maxTokens, options),
		options.streamFn,
		options.completeSimple,
		options.retry,
		options.retryCallbacks,
	);

	const failure = getSummarizationFailure(response, "Turn prefix summarization");
	if (failure) throw new Error(failure);
	if (response.content.some((block) => block.type === "toolCall")) {
		throw new Error("Turn prefix summarization attempted to call a tool");
	}
	return { text: contentText(response.content), usage: response.usage };
}

export type CompactOptions = Omit<SummaryGenerationOptions, "reserveTokens" | "previousSummary">;

/** 执行一次压缩，返回可写入会话的摘要结果。 */
export async function compact(preparation: CompactionPreparation, options: CompactOptions): Promise<CompactionResult> {
	const {
		firstKeptEntryId,
		messagesToSummarize,
		turnPrefixMessages,
		isSplitTurn,
		tokensBefore,
		previousSummary,
		fileOps,
		settings,
	} = preparation;

	let summary: string;
	let summaryUsage: Usage;

	if (isSplitTurn && turnPrefixMessages.length > 0) {
		let historyText = "No prior history.";
		let historyUsage: Usage | undefined;
		if (messagesToSummarize.length > 0) {
			const historyResult = await generateSummaryWithUsage(messagesToSummarize, {
				...options,
				reserveTokens: settings.reserveTokens,
				previousSummary,
			});
			historyText = historyResult.text;
			historyUsage = historyResult.usage;
		}
		const turnPrefixResult = await generateTurnPrefixSummary(turnPrefixMessages, {
			...options,
			reserveTokens: settings.reserveTokens,
		});
		summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.text}`;
		summaryUsage = historyUsage ? combineUsage(historyUsage, turnPrefixResult.usage) : turnPrefixResult.usage;
	} else {
		const result = await generateSummaryWithUsage(messagesToSummarize, {
			...options,
			reserveTokens: settings.reserveTokens,
			previousSummary,
		});
		summary = result.text;
		summaryUsage = result.usage;
	}

	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);

	return {
		summary,
		firstKeptEntryId,
		tokensBefore,
		usage: summaryUsage,
		details: { readFiles, modifiedFiles },
	};
}
