import type { ProviderStreams } from "../models.ts";
import { lazyApi } from "./lazy.ts";

/** 按需加载 OpenAI Chat Completions 实现。 */
export const openAICompletionsApi = (): ProviderStreams => lazyApi(() => import("./openai-completions.ts"));
