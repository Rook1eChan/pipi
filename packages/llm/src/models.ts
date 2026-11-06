import { lazyStream } from "./api/lazy.ts";
import { type AuthResolutionOverrides, defaultAuthContext, ModelsError, resolveProviderAuth } from "./auth/resolve.ts";
import {
	type AuthContext,
	type AuthResult,
	type Credential,
	type CredentialStore,
	InMemoryCredentialStore,
	type ProviderAuth,
} from "./auth/types.ts";
import { InMemoryModelsStore, type ModelsStore, type ModelsStoreEntry } from "./models-store.ts";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ModelCostRates,
	ModelThinkingLevel,
	ProviderHeaders,
	SimpleStreamOptions,
	StreamOptions,
	Usage,
} from "./types.ts";
import type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export interface ModelsPublication {
	/** 持久化目录；null 表示删除。 */
	persist?: ModelsStoreEntry | null;
	/** 持久化成功后同步更新内存状态。 */
	update?: () => void;
}

export interface RefreshModelsContext {
	credential?: Credential;
	stored?: Readonly<ModelsStoreEntry>;
	allowNetwork: boolean;
	force?: boolean;
	signal: AbortSignal;
	publish(publication: ModelsPublication): Promise<boolean>;
}

export interface ModelsRefreshOptions {
	allowNetwork?: boolean;
	providers?: readonly string[];
	force?: boolean;
	signal?: AbortSignal;
}

export interface ModelsRefreshResult {
	aborted: boolean;
	errors: ReadonlyMap<string, Error>;
}

/** 一个 API 实现模块的统一形状。 */
export interface ProviderStreams {
	stream(model: Model<Api>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

/** 一个 provider 的完整运行时描述。 */
export interface Provider<TApi extends Api = Api> {
	readonly id: string;
	readonly name: string;
	readonly baseUrl?: string;
	readonly headers?: ProviderHeaders;
	readonly auth: ProviderAuth;

	getModels(): readonly Model<TApi>[];

	refreshModels?(context: RefreshModelsContext): Promise<void>;

	filterModels?(models: readonly Model<TApi>[], credential: Credential | undefined): readonly Model<TApi>[];

	stream<T extends TApi>(model: Model<T>, context: Context, options?: StreamOptions): AssistantMessageEventStream;

	streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

/** provider 集合与请求入口。 */
export interface Models {
	getProviders(): readonly Provider[];
	getProvider(id: string): Provider | undefined;
	getModels(provider?: string): readonly Model<Api>[];
	getModel(provider: string, id: string): Model<Api> | undefined;
	getAvailable(providerId?: string): Promise<readonly Model<Api>[]>;
	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	stream<TApi extends Api>(model: Model<TApi>, context: Context, options?: StreamOptions): AssistantMessageEventStream;
	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
	complete<TApi extends Api>(model: Model<TApi>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
	completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;
	refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
}

export interface MutableModels extends Models {
	setProvider(provider: Provider): void;
	deleteProvider(id: string): void;
	clearProviders(): void;
}

export interface CreateModelsOptions {
	credentials?: CredentialStore;
	modelsStore?: ModelsStore;
	authContext?: AuthContext;
}

export interface CreateProviderOptions<TApi extends Api = Api> {
	id: string;
	name?: string;
	baseUrl?: string;
	headers?: ProviderHeaders;
	auth: ProviderAuth;
	models: readonly Model<TApi>[];
	fetchModels?: (context: RefreshModelsContext) => Promise<readonly Model<TApi>[]>;
	filterModels?: (models: readonly Model<TApi>[], credential: Credential | undefined) => readonly Model<TApi>[];
	/** 单一 API 实现，或按 model.api 分派的映射。 */
	api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}

function mergeHeaders(
	base: ProviderHeaders | undefined,
	override: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
	if (!base && !override) return undefined;
	const merged: ProviderHeaders = { ...base };
	for (const [name, value] of Object.entries(override ?? {})) {
		const lower = name.toLowerCase();
		for (const existing of Object.keys(merged)) {
			if (existing.toLowerCase() === lower) delete merged[existing];
		}
		merged[name] = value;
	}
	return merged;
}

class ModelsImpl implements MutableModels {
	private readonly providers = new Map<string, Provider>();
	private readonly credentials: CredentialStore;
	private readonly modelsStore: ModelsStore;
	private readonly authContext: AuthContext;

	constructor(options?: CreateModelsOptions) {
		this.credentials = options?.credentials ?? new InMemoryCredentialStore();
		this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
		this.authContext = options?.authContext ?? defaultAuthContext();
	}

	setProvider(provider: Provider): void {
		this.providers.set(provider.id, provider);
	}

	deleteProvider(id: string): void {
		this.providers.delete(id);
	}

	clearProviders(): void {
		this.providers.clear();
	}

	getProviders(): readonly Provider[] {
		return Array.from(this.providers.values());
	}

	getProvider(id: string): Provider | undefined {
		return this.providers.get(id);
	}

	getModels(provider?: string): readonly Model[] {
		if (provider !== undefined) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try {
				return entry.getModels();
			} catch {
				return [];
			}
		}
		const models: Model[] = [];
		for (const entry of this.providers.values()) {
			try {
				models.push(...entry.getModels());
			} catch {
				// 单个 provider 的坏实现不应破坏整个集合。
			}
		}
		return models;
	}

	getModel(provider: string, id: string): Model | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}

	async getAvailable(providerId?: string): Promise<readonly Model[]> {
		const selected = providerId
			? [this.providers.get(providerId)].filter((entry): entry is Provider => entry !== undefined)
			: this.getProviders();
		const signal = new AbortController().signal;
		const checks = await Promise.all(
			selected.map(async (provider) => {
				try {
					const credential = await this.credentials.read(provider.id, { signal });
					const auth = await resolveProviderAuth(provider, this.credentials, this.authContext, { signal });
					if (!auth) return [];
					const models = provider.getModels();
					return provider.filterModels?.(models, credential) ?? models;
				} catch {
					return [];
				}
			}),
		);
		return checks.flat();
	}

	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
	async getAuth(
		providerOrModel: string | Model<Api>,
		overrides?: AuthResolutionOverrides,
	): Promise<AuthResult | undefined> {
		const providerId = typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
		const provider = this.providers.get(providerId);
		if (!provider) return undefined;
		const result = await resolveProviderAuth(provider, this.credentials, this.authContext, overrides);
		if (!result || typeof providerOrModel === "string" || !providerOrModel.headers) return result;
		return {
			...result,
			auth: {
				...result.auth,
				headers: mergeHeaders(result.auth.headers, providerOrModel.headers),
			},
		};
	}

	stream<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: StreamOptions,
	): AssistantMessageEventStream {
		return lazyStream(model, async () => {
			const provider = this.requireProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.stream(requestModel as Model<TApi>, context, requestOptions);
		});
	}

	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
		return lazyStream(model, async () => {
			const provider = this.requireProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.streamSimple(requestModel, context, requestOptions as SimpleStreamOptions);
		});
	}

	async complete<TApi extends Api>(
		model: Model<TApi>,
		context: Context,
		options?: StreamOptions,
	): Promise<AssistantMessage> {
		return this.stream(model, context, options).result();
	}

	async completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage> {
		return this.streamSimple(model, context, options).result();
	}

	async refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
		const signal = options.signal ?? new AbortController().signal;
		const allowNetwork = options.allowNetwork ?? true;
		const selected = options.providers ? new Set(options.providers) : undefined;
		const errors = new Map<string, Error>();
		const providers = this.getProviders().filter(
			(provider): provider is Provider & Required<Pick<Provider, "refreshModels">> =>
				provider.refreshModels !== undefined && (!selected || selected.has(provider.id)),
		);

		await Promise.all(
			providers.map(async (provider) => {
				try {
					const stored = await this.modelsStore.read(provider.id, { signal });
					const credential = await this.credentials.read(provider.id, { signal });
					await provider.refreshModels({
						credential,
						stored,
						allowNetwork,
						force: allowNetwork ? options.force : undefined,
						signal,
						publish: async (publication) => {
							if (publication.persist === null) {
								await this.modelsStore.delete(provider.id, { signal });
							} else if (publication.persist !== undefined) {
								await this.modelsStore.write(provider.id, publication.persist, { signal });
							}
							publication.update?.();
							return true;
						},
					});
				} catch (error) {
					if (!signal.aborted) {
						errors.set(provider.id, error instanceof Error ? error : new Error(String(error)));
					}
				}
			}),
		);

		return { aborted: signal.aborted, errors };
	}

	private requireProvider(model: Model<Api>): Provider {
		const provider = this.providers.get(model.provider);
		if (!provider) {
			throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
		}
		return provider;
	}

	private async applyAuth(
		model: Model<Api>,
		options?: StreamOptions,
	): Promise<{ requestModel: Model<Api>; requestOptions: StreamOptions }> {
		this.requireProvider(model);
		const resolution = await this.getAuth(model, {
			apiKey: options?.apiKey,
			env: options?.env,
			signal: options?.signal,
		});
		if (!resolution) {
			throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
		}
		const auth = resolution.auth;
		const apiKey = options?.apiKey ?? auth.apiKey;
		const headers = mergeHeaders(auth.headers, options?.headers);
		const env = resolution.env || options?.env ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) } : undefined;
		const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
		return {
			requestModel,
			requestOptions: { ...options, apiKey, headers, env },
		};
	}
}

export function createModels(options?: CreateModelsOptions): MutableModels {
	return new ModelsImpl(options);
}

/** 从部件构造 provider。支持静态模型、动态覆盖与按 API 分派。 */
export function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi> {
	const baselineModels = input.models;
	let dynamicModels: readonly Model<TApi>[] = [];
	const fetchModels = input.fetchModels;
	const currentModels = (): readonly Model<TApi>[] => {
		const merged = [...baselineModels];
		for (const model of dynamicModels) {
			const index = merged.findIndex((entry) => entry.id === model.id);
			if (index >= 0) merged[index] = model;
			else merged.push(model);
		}
		return merged;
	};
	const candidate = input.api as ProviderStreams;
	const single = typeof candidate.stream === "function" ? candidate : undefined;
	const byApi = single ? undefined : (input.api as Partial<Record<string, ProviderStreams>>);
	const apiFor = (model: Model<Api>): ProviderStreams | undefined => single ?? byApi?.[model.api];

	const dispatch = (
		model: Model<Api>,
		run: (streams: ProviderStreams) => AssistantMessageEventStream,
	): AssistantMessageEventStream => {
		const streams = apiFor(model);
		if (!streams) {
			return lazyStream(model, async () => {
				throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
			});
		}
		return run(streams);
	};

	const provider: Provider<TApi> = {
		id: input.id,
		name: input.name ?? input.id,
		baseUrl: input.baseUrl,
		headers: input.headers,
		auth: input.auth,
		getModels: currentModels,
		refreshModels: fetchModels
			? async (context) => {
					if (context.stored) {
						const restored = context.stored.models
							.filter((model) => model.provider === input.id)
							.map((model) => model as Model<TApi>);
						if (
							!(await context.publish({
								update: () => {
									dynamicModels = restored;
								},
							}))
						) {
							return;
						}
					}
					if (!context.allowNetwork || context.signal.aborted) return;
					const refreshed = await fetchModels(context);
					if (context.signal.aborted) return;
					await context.publish({
						persist: { models: refreshed, checkedAt: Date.now() },
						update: () => {
							dynamicModels = refreshed;
						},
					});
				}
			: undefined,
		filterModels: input.filterModels,
		stream: (model, context, options) =>
			dispatch(model as Model<Api>, (streams) => streams.stream(model as Model<Api>, context, options)),
		streamSimple: (model, context, options) =>
			dispatch(model as Model<Api>, (streams) => streams.streamSimple(model as Model<Api>, context, options)),
	};

	return provider;
}

/** 运行时收窄：按 model.api 判断模型属于哪个 API 家族。 */
export function hasApi<TApi extends Api>(model: Model<Api>, api: TApi): model is Model<TApi> {
	return model.api === api;
}

export function calculateCost(model: Model<Api>, usage: Usage): Usage["cost"] {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates: ModelCostRates = model.cost;
	let matchedThreshold = -1;
	for (const tier of model.cost.tiers ?? []) {
		if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
			rates = tier;
			matchedThreshold = tier.inputTokensAbove;
		}
	}
	const longWrite = usage.cacheWrite1h ?? 0;
	const shortWrite = usage.cacheWrite - longWrite;
	usage.cost.input = (rates.input / 1_000_000) * usage.input;
	usage.cost.output = (rates.output / 1_000_000) * usage.output;
	usage.cost.cacheRead = (rates.cacheRead / 1_000_000) * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1_000_000;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function getSupportedThinkingLevels(model: Model<Api>): ModelThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return EXTENDED_THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	});
}

export function clampThinkingLevel(model: Model<Api>, level: ModelThinkingLevel): ModelThinkingLevel {
	const available = getSupportedThinkingLevels(model);
	if (available.includes(level)) return level;
	const index = EXTENDED_THINKING_LEVELS.indexOf(level);
	if (index === -1) return available[0] ?? "off";
	for (let i = index; i < EXTENDED_THINKING_LEVELS.length; i++) {
		if (available.includes(EXTENDED_THINKING_LEVELS[i])) return EXTENDED_THINKING_LEVELS[i];
	}
	for (let i = index - 1; i >= 0; i--) {
		if (available.includes(EXTENDED_THINKING_LEVELS[i])) return EXTENDED_THINKING_LEVELS[i];
	}
	return available[0] ?? "off";
}

export function modelsAreEqual(a: Model<Api> | null | undefined, b: Model<Api> | null | undefined): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
