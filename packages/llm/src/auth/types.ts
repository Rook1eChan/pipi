import type { ProviderEnv, ProviderHeaders } from "../types.ts";

/** 一次请求所需的认证信息。 */
export interface ModelAuth {
	apiKey?: string;
	headers?: ProviderHeaders;
	baseUrl?: string;
}

/** API key 格式的 credential。 */
export interface ApiKeyCredential {
	type: "api_key";
	key?: string;
	env?: ProviderEnv;
}

/** 当前只支持 API key；OAuth 后置。 */
export type Credential = ApiKeyCredential;

export interface CredentialInfo {
	providerId: string;
	type: Credential["type"];
}

export interface AuthOperationOptions {
	signal?: AbortSignal;
}

/** 用于管理各 provider 的 credential。 */
export interface CredentialStore {
	read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined>;
	write(providerId: string, credential: Credential, options?: AuthOperationOptions): Promise<void>;
	delete(providerId: string, options?: AuthOperationOptions): Promise<void>;
	list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]>;
}

/** 进程内的凭据存储，不保存到本地，用于默认配置和测试。 */
export class InMemoryCredentialStore implements CredentialStore {
	private readonly entries = new Map<string, Credential>();

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		return this.entries.get(providerId);
	}

	async write(providerId: string, credential: Credential, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.entries.set(providerId, credential);
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.entries.delete(providerId);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		return Array.from(this.entries.keys()).map((providerId) => ({ providerId, type: "api_key" as const }));
	}
}

/** 认证解析所需的环境访问接口。 */
export interface AuthContext {
	env(name: string): Promise<string | undefined>;
	fileExists(path: string): Promise<boolean>;
}

/** 认证解析结果；只用于当前请求，不持久化。 */
export interface AuthResult {
	auth: ModelAuth;
	env?: ProviderEnv;
	source?: string;
}

export interface AuthCheck {
	source?: string;
	type: "api_key";
}

/** API key 认证方式。 */
export interface ApiKeyAuth {
	name: string;
	check?(input: {
		ctx: AuthContext;
		credential?: ApiKeyCredential;
		signal: AbortSignal;
	}): Promise<AuthCheck | undefined>;
	resolve(input: {
		ctx: AuthContext;
		credential?: ApiKeyCredential;
		signal: AbortSignal;
	}): Promise<AuthResult | undefined>;
}

/** provider 的认证声明。当前只有 API key。 */
export interface ProviderAuth {
	apiKey?: ApiKeyAuth;
}
