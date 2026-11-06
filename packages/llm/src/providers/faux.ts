import { createProvider, type Provider, type ProviderStreams } from "../models.ts";
import type { AssistantMessage, Model, SimpleStreamOptions, StreamOptions, Usage } from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";

const FAUX_MODEL: Model<"faux"> = {
	id: "faux-1",
	name: "Faux Model",
	api: "faux",
	provider: "faux",
	baseUrl: "http://localhost:0",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_192,
	maxTokens: 1_024,
};

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function streamFaux(text: string, model: Model<"faux">): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const output: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
		stopReason: "pending",
		timestamp: Date.now(),
	};

	stream.push({ type: "start", partial: output });
	const block = { type: "text" as const, text: "" };
	output.content.push(block);
	stream.push({ type: "text_start", contentIndex: 0, partial: output });
	block.text = text;
	stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
	stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
	output.stopReason = "stop";
	stream.push({ type: "done", reason: "stop", message: output });
	stream.end(output);
	return stream;
}

/** 测试用 provider：不访问网络，返回固定文本。 */
export function fauxProvider(text = "faux response"): Provider {
	const api: ProviderStreams = {
		stream: (model, _context, _options: StreamOptions) => streamFaux(text, model as Model<"faux">),
		streamSimple: (model, _context, _options: SimpleStreamOptions) => streamFaux(text, model as Model<"faux">),
	};
	return createProvider({
		id: "faux",
		name: "Faux",
		auth: {
			apiKey: {
				name: "Faux",
				resolve: async () => ({ auth: {} }),
			},
		},
		models: [FAUX_MODEL],
		api,
	});
}

export { FAUX_MODEL };
