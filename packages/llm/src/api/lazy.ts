import type { Api, AssistantMessage, AssistantMessageEvent, Model } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

/** 初始化失败时的错误消息，字段与正常回复保持一致。 */
function createSetupErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

type StreamWithResult = AsyncIterable<AssistantMessageEvent> & {
	result(): Promise<AssistantMessage>;
};

function hasResult(source: AsyncIterable<AssistantMessageEvent>): source is StreamWithResult {
	return typeof (source as { result?: unknown }).result === "function";
}

// 将一个管道里的东西push到另一个管道
async function forwardStream(
	target: AssistantMessageEventStream,
	source: AsyncIterable<AssistantMessageEvent>,
): Promise<void> {
	for await (const event of source) {
		target.push(event);
	}
	target.end(hasResult(source) ? await source.result() : undefined);
}

/**
 * 同步返回一个外层流，在后台执行初始化。
 *
 * 初始化包括认证解析、模块加载和建立请求。失败时把错误编码成 error 事件，而不是让
 * 调用点抛出异常，调用方始终只有“拿流、消费、检查 stopReason”一条路径。
 */
export function lazyStream(
	model: Model<Api>,
	setup: () => Promise<AsyncIterable<AssistantMessageEvent>>,
): AssistantMessageEventStream {
	const outer = new AssistantMessageEventStream();

	setup()
		// 如果 setup 成功（resolved），将内部产生的流（inner）push 到 outer 管道里
		.then((inner) => forwardStream(outer, inner))
		.catch((error) => {
			outer.push({ type: "error", reason: "error", error: createSetupErrorMessage(model, error) });
			outer.end();
		});

	return outer;
}
