import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "./types.ts";

/** 进程内的 credential 存储，不保存到本地，用于默认配置和测试。 */
export class InMemoryCredentialStore implements CredentialStore {
	private readonly entries = new Map<string, Credential>();

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		return this.entries.get(providerId);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		return Array.from(this.entries.keys()).map((providerId) => ({ providerId, type: "api_key" as const }));
	}

	async write(providerId: string, credential: Credential, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.entries.set(providerId, credential);
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		this.entries.delete(providerId);
	}
}
