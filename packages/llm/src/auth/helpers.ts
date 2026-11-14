import type { ApiKeyAuth } from "./types.ts";

/** 标准 API key 认证：存储的 key 优先，否则第一个已设置的环境变量生效。 */
export function envApiKeyAuth(name: string, envVars: readonly string[]): ApiKeyAuth {
	return {
		name,
		login: async (interaction) => {
			interaction.signal.throwIfAborted();
			const key = await interaction.prompt({ type: "secret", message: `Enter ${name}` });
			interaction.signal.throwIfAborted();
			const trimmed = key.trim();
			if (trimmed.length === 0) throw new Error(`${name} cannot be empty`);
			return { type: "api_key", key: trimmed };
		},
		resolve: async ({ ctx, credential, signal }) => {
			signal.throwIfAborted();
			// 先检查存储有没有key
			if (credential?.key) {
				return {
					auth: { apiKey: credential.key },
					env: credential.env,
					source: "stored credential",
				};
			}
			// 查环境变量
			for (const envVar of envVars) {
				const value = await ctx.env(envVar);
				signal.throwIfAborted();
				if (value) {
					return { auth: { apiKey: value }, source: envVar };
				}
			}
			return undefined;
		},
	};
}
