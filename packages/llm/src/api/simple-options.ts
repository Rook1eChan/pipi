import type {
	Api,
	Context,
	Model,
	SimpleStreamOptions,
	StreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
} from "../types.ts";
import { estimateContextTokens } from "../utils/estimate.ts";

const CONTEXT_SAFETY_TOKENS = 4096;
// 最大token的下限
const MIN_MAX_TOKENS = 1;

/** 计算本轮可生成的最大token数。即请求中的max_tokens的值。
 * 根据本次指定的 maxTokens，和模型自带的 model.contextWindow
 */
export function clampMaxTokensToContext(model: Model<Api>, context: Context, maxTokens: number): number {
	// 模型窗口大小未指定时，最大值由传入的maxTokens来定
	if (model.contextWindow <= 0) return Math.max(MIN_MAX_TOKENS, maxTokens);
	// 模型窗口-现有context长度-保留长度
	const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
	return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
}

/** 把 SimpleStreamOptions 转换成 StreamOptions */
export function buildBaseOptions(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
	apiKey?: string,
): StreamOptions {
	const samplingParams =
		model.samplingParams || options?.samplingParams
			? { ...model.samplingParams, ...options?.samplingParams }
			: undefined;
	return {
		temperature: options?.temperature,
		samplingParams,
		maxTokens: clampMaxTokensToContext(model, context, options?.maxTokens ?? model.maxTokens),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		fetch: options?.fetch,
		transport: options?.transport,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		onResponse: options?.onResponse,
		timeoutMs: options?.timeoutMs,
		maxRetries: options?.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		env: options?.env,
	};
}

/** 思考预算与回复共享同一个上限时，始终留给回复的 token。 */
export const MIN_ANSWER_TOKENS = 1024;

/** 各思考档位的默认 token 预算。 */
export const DEFAULT_THINKING_BUDGETS = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
} satisfies ThinkingBudgets;

/** 把 provider 不支持的档位收窄到最近的支持档位。 */
export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh" | "max"> | undefined {
	return effort === "xhigh" || effort === "max" ? "high" : effort;
}

/** 取某个思考档位的 token 预算。 */
export function thinkingBudgetForLevel(reasoningLevel: ThinkingLevel, customBudgets?: ThinkingBudgets): number {
	const level = clampReasoning(reasoningLevel) ?? "minimal";
	return { ...DEFAULT_THINKING_BUDGETS, ...customBudgets }[level] ?? DEFAULT_THINKING_BUDGETS[level];
}

/** 收窄思考预算，保证同一上限下至少留下 MIN_ANSWER_TOKENS 给回复。 */
export function clampThinkingBudgetToAnswerRoom(thinkingBudget: number, ceiling: number): number {
	return Math.min(thinkingBudget, Math.max(0, ceiling - MIN_ANSWER_TOKENS));
}

/**
 * Anthropic专用，max_tokens thinkingBudgetTokens两个字段
 * 计算请求的输出的最大token与思考的最大token。
 * 推理模型的thinking和正文共享输出上限，需要加以区分，避免thinking把空间占完
 */
export function adjustMaxTokensForThinking(
	baseMaxTokens: number | undefined, // 调用方希望留给正文的上限
	modelMaxTokens: number, // model自身的maxtokens
	reasoningLevel: ThinkingLevel, // 推理档位
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	let thinkingBudget = thinkingBudgetForLevel(reasoningLevel, customBudgets);
	const maxTokens =
		baseMaxTokens === undefined ? modelMaxTokens : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

	if (maxTokens <= thinkingBudget) {
		thinkingBudget = clampThinkingBudgetToAnswerRoom(thinkingBudget, maxTokens);
	}

	return { maxTokens, thinkingBudget };
}
