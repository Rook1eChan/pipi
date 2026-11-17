import { lazyStream } from "./api/lazy.ts";
import { InMemoryCredentialStore } from "./auth/in-memory-credential-store.ts";
import {
	type AuthResolutionOverrides,
	checkProviderAuth,
	defaultAuthContext,
	ModelsError,
	resolveProviderAuth,
} from "./auth/resolve.ts";
import type {
	AuthCheck,
	AuthContext,
	AuthInteraction,
	AuthOperationOptions,
	AuthResult,
	Credential,
	CredentialStore,
	ProviderAuth,
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

/**
 * 一个 provider 的完整描述：元数据、认证、模型目录与请求入口。
 *
 * 由 `createProvider` 生成，不是类。provider 决定“怎么拿 credential”和
 * “用哪个 API 实现”，但不负责 credential 的存储；存储统一由 `Models` 持有的
 * `CredentialStore` 处理。
 */
export interface Provider<TApi extends Api = Api> {
	/** provider 唯一标识；模型的 `provider` 字段与此对应。 */
	readonly id: string;

	/** 展示名称；省略时由 `createProvider` 取 `id`。 */
	readonly name: string;

	/** provider 的默认端点信息；请求实际使用 `model.baseUrl`，可被 `auth.baseUrl` 覆盖。 */
	readonly baseUrl?: string;

	/** provider 的默认请求头信息；请求时合并的是 `auth.headers` 与 `options.headers`。 */
	readonly headers?: ProviderHeaders;

	/** 认证配置：负责解析 credential，可选提供交互式登录。 */
	readonly auth: ProviderAuth;

	/** 当前模型目录；实现抛错时调用方视为没有模型。 */
	getModels(): readonly Model<TApi>[];

	/** 动态 provider 的目录刷新；省略表示目录是静态的。 */
	refreshModels?(context: RefreshModelsContext): Promise<void>;

	/** 按 credential 过滤模型；`getAvailable` 使用，省略时不过滤。 */
	filterModels?(models: readonly Model<TApi>[], credential: Credential | undefined): readonly Model<TApi>[];

	/** 用 provider 原生完整参数发起 streaming 请求。 */
	stream<T extends TApi>(model: Model<T>, context: Context, options?: StreamOptions): AssistantMessageEventStream;

	/** 用 provider 无关的统一参数发起 streaming 请求。 */
	streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
}

/** provider 集合与请求入口。 */
export interface Models {
	/** 列出所有已注册的 provider。 */
	getProviders(): readonly Provider[];

	/** 按 id 查找 provider。 */
	getProvider(id: string): Provider | undefined;

	/** 列出模型；传入 provider id 时只返回该 provider 的模型。 */
	getModels(provider?: string): readonly Model<Api>[];

	/** 按 provider id 与模型 id 查找模型。 */
	getModel(provider: string, id: string): Model<Api> | undefined;

	/** 列出可用模型：没有 credential 的 provider 返回空，其余经 `filterModels` 过滤。 */
	getAvailable(providerId?: string): Promise<readonly Model<Api>[]>;

	/** 解析某个 provider 要用的 credential。 */
	getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

	/** 解析某个模型所属 provider 要用的 credential。 */
	getAuth(model: Model<Api>, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

	/** 走 provider 的登录流程，成功后写入 credential 存储。 */
	login(providerId: string, interaction: AuthInteraction): Promise<Credential>;

	/** 删除 provider 的 credential；不存在也算成功。 */
	logout(providerId: string, options?: AuthOperationOptions): Promise<void>;

	/** 检查 provider 是否已配置；未知 provider 返回 undefined。 */
	checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined>;

	/** 用 provider 原生完整参数发起 streaming 请求。 */
	stream<TApi extends Api>(model: Model<TApi>, context: Context, options?: StreamOptions): AssistantMessageEventStream;

	/** 用 provider 无关的统一参数发起 streaming 请求。 */
	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;

	/** `stream` 的便捷封装：等整条回复结束后，只返回最终消息。 */
	complete<TApi extends Api>(model: Model<TApi>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;

	/** `streamSimple` 的便捷封装：等整条回复结束后，只返回最终消息。 */
	completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;

	/** 刷新声明了 `refreshModels` 的 provider；单个失败记入返回值的 errors，不抛出。 */
	refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;
}

export interface MutableModels extends Models {
	/** 按 provider id 新增或替换 provider。 */
	setProvider(provider: Provider): void;

	/** 移除指定 provider 及其模型。 */
	deleteProvider(id: string): void;

	/** 清空所有 provider。 */
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

	// 函数，负责联网拿模型列表
	fetchModels?: (context: RefreshModelsContext) => Promise<readonly Model<TApi>[]>;

	// 函数，负责回答当前能用什么模型
	filterModels?: (models: readonly Model<TApi>[], credential: Credential | undefined) => readonly Model<TApi>[];
	/** api的类型为单一 API 实现，或者一个映射。 */
	api: ProviderStreams | Partial<Record<TApi, ProviderStreams>>;
}

// 合并两个 headers 对象，override 优先
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
					const check = await this.checkAuth(provider.id, { signal });
					if (!check) return [];
					const models = provider.getModels();
					return provider.filterModels?.(models, credential) ?? models;
				} catch {
					return [];
				}
			}),
		);
		return checks.flat();
	}

	// 方法重载：实际只有一个实现，前两个签名只是看起来更清楚
	/**
	 * 按 provider id 解析 provider 范围内的认证；若传入的是 model，则解析 provider 认证并附加该 model 的静态 headers。结果包含一个 source 标签，供状态 UI 使用。
	 * 当 provider 未知或未配置时，解析为 undefined。
	 */
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
		//
		if (!result || typeof providerOrModel === "string" || !providerOrModel.headers) return result;
		return {
			...result,
			auth: {
				...result.auth,
				headers: mergeHeaders(result.auth.headers, providerOrModel.headers),
			},
		};
	}

	async login(providerId: string, interaction: AuthInteraction): Promise<Credential> {
		const provider = this.providers.get(providerId);
		if (!provider) throw new ModelsError("provider", `Unknown provider: ${providerId}`);

		const login = provider.auth.apiKey?.login;
		if (!login) throw new ModelsError("auth", `Provider ${providerId} does not support login`);

		const signal = interaction.signal ?? new AbortController().signal;
		signal.throwIfAborted();
		const credential = await login({ ...interaction, signal });
		await this.credentials.write(providerId, credential, { signal });
		return credential;
	}

	async logout(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		await this.credentials.delete(providerId, options);
	}

	async checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined> {
		const provider = this.providers.get(providerId);
		if (!provider) return undefined;
		return checkProviderAuth(provider, this.credentials, this.authContext, options);
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

	// 认证provider
	private async applyAuth(
		model: Model<Api>,
		options?: StreamOptions,
	): Promise<{ requestModel: Model<Api>; requestOptions: StreamOptions }> {
		this.requireProvider(model);
		// 认证provider
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

/**
 * 构造一个 provider：把元数据、认证、模型目录与 API 实现组装成普通对象。
 *
 * `input.api` 支持两种形态：单一实现（所有模型共用一个 API 家族），或按
 * `model.api` 索引的映射表（一个 provider 覆盖多个 API 家族）。
 */
export function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi> {
	const baselineModels = input.models; // 本地catalog写的models
	let dynamicModels: readonly Model<TApi>[] = []; // 刷新拿到的models
	const fetchModels = input.fetchModels;
	// currentModels由dynamicModels覆盖baselineModels得到
	const currentModels = (): readonly Model<TApi>[] => {
		const merged = [...baselineModels];
		for (const model of dynamicModels) {
			const index = merged.findIndex((entry) => entry.id === model.id);
			if (index >= 0) merged[index] = model;
			else merged.push(model);
		}
		return merged;
	};
	// api 可以是单一实现，也可以按 model.api 分派
	const apiInput = input.api;
	const streamsSingle =
		typeof (apiInput as ProviderStreams).stream === "function" ? (apiInput as ProviderStreams) : undefined;
	const streamsTable = streamsSingle ? undefined : (apiInput as Partial<Record<string, ProviderStreams>>);
	const apiFor = (model: Model<Api>) => streamsSingle ?? streamsTable?.[model.api];

	const dispatch = (
		model: Model<Api>,
		run: (streams: ProviderStreams) => AssistantMessageEventStream,
	): AssistantMessageEventStream => {
		const streams = apiFor(model);
		// 缺少对应实现时进入流的错误路径，避免调用方拿到同步异常。
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
		// 只有声明了 fetchModels 的 provider 才具备刷新能力。
		refreshModels: fetchModels
			? async (context) => {
					// 先恢复上次持久化的目录，离线启动也能看到模型。
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
					// 不联网或已中止时，只保留恢复结果，不发请求。
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
		// 两个入口都只负责把调用分派给对应的 API 实现。
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
