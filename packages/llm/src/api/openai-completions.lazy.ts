import type { ProviderStreams } from "../models.ts";
import { lazyApi } from "./lazy.ts";

export const openAICompletionsApi = (): ProviderStreams => lazyApi(() => import("./openai-completions.ts"));
