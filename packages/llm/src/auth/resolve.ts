import type { ProviderEnv } from "../types.ts";
import type { ApiKeyAuth, AuthContext, AuthResult, Credential, CredentialStore, ProviderAuth } from "./types.ts";

export type ModelsErrorCode = "model_source" | "model_validation" | "provider" | "stream" | "auth";

export class ModelsError extends Error {
	readonly code: ModelsErrorCode;

	constructor(code: ModelsErrorCode, message: string) {
		super(message);
		this.name = "ModelsError";
		this.code = code;
	}
}

// 临时认证信息。本次请求用临时覆盖默认信息
export interface AuthResolutionOverrides {
	apiKey?: string;
	env?: ProviderEnv;
	signal?: AbortSignal;
}

// 防止调用方忘记传signal。始终使用signal
/** 调用方没传 signal 时补一个不会中止的信号，后续代码可以统一调用 throwIfAborted。 */
function operationSignal(signal?: AbortSignal): AbortSignal {
	return signal ?? new AbortController().signal;
}

/** 默认认证上下文：读取 process.env，不访问文件。 */
export function defaultAuthContext(): AuthContext {
	return {
		env: async (name) => process.env[name], // env是箭头函数，传入name，返回process.env[name]
		fileExists: async () => false,
	};
}

// overrides时覆盖env
/** 把请求级 ProviderEnv 叠加到 AuthContext 上：同名键优先于原环境。 */
function overlayEnv(base: AuthContext, env: ProviderEnv): AuthContext {
	return {
		env: async (name) => env[name] ?? base.env(name),
		fileExists: (path) => base.fileExists(path),
	};
}

/**
 * 解析一次请求使用的认证。
 *
 * 解析顺序：
 * 1. 调用方显式传入的 apiKey；
 * 2. provider 的存储凭据；
 * 3. provider 自己的 ambient 来源（通常是环境变量）。
 *
 * 传入 overrides.env 时，会先叠加到 AuthContext 上，让请求级环境变量优先于 process.env。
 * 存在存储记录时，解析进入存储分支；是否继续回退环境变量由 provider 的 resolve 决定。
 *
 * 返回 undefined 表示 provider 未配置；存储读取失败会抛出 ModelsError("auth")。
 */
export async function resolveProviderAuth(
	provider: { id: string; auth: ProviderAuth },
	credentials: CredentialStore,
	authContext: AuthContext,
	overrides?: AuthResolutionOverrides,
): Promise<AuthResult | undefined> {
	const signal = operationSignal(overrides?.signal);
	signal.throwIfAborted();
	// 临时环境变量overrides
	const ctx = overrides?.env ? overlayEnv(authContext, overrides.env) : authContext;

	// 显式 apiKey 优先级最高：合成一个临时凭据，不读取存储。
	if (overrides?.apiKey !== undefined && provider.auth.apiKey) {
		return provider.auth.apiKey.resolve({
			ctx,
			credential: { type: "api_key", key: overrides.apiKey },
			signal,
		});
	}

	// 读取存储凭据；存储失败属于认证基础设施错误，包装成 ModelsError("auth")。
	let stored: Credential | undefined;
	try {
		stored = await credentials.read(provider.id, { signal });
	} catch (error) {
		throw new ModelsError(
			"auth",
			`Credential store read failed for ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	// 有存储记录时交给 provider 自己的 resolve 处理。
	// provider 可以继续使用凭据里的 env，或按自己的规则回退环境变量。
	if (stored) {
		const apiKey: ApiKeyAuth | undefined = provider.auth.apiKey;
		if (!apiKey) return undefined;
		return apiKey.resolve({ ctx, credential: stored, signal });
	}

	// 没有存储记录时走 ambient 解析，通常是环境变量。
	if (!provider.auth.apiKey) return undefined;
	return provider.auth.apiKey.resolve({ ctx, signal });
}
