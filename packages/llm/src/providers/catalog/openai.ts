import type { Model } from "../../types.ts";

export const OPENAI_MODELS: readonly Model<"openai-completions">[] = [
	{
		id: "gpt-4.1-mini",
		name: "GPT-4.1 mini",
		api: "openai-completions",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1_047_576,
		maxTokens: 32_768,
	},
];
