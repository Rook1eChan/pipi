import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { envApiKeyAuth } from "../auth/helpers.ts";
import { createProvider, type Provider } from "../models.ts";
import { OPENAI_MODELS } from "./catalog/openai.ts";

/** OpenAI provider：使用官方 Chat Completions 端点。 */
export function openaiProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "openai",
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		auth: { apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]) },
		models: OPENAI_MODELS,
		api: openAICompletionsApi(), //
	});
}
