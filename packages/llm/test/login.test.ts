import { describe, expect, it } from "vitest";
import {
	type AuthContext,
	type AuthInteraction,
	createModels,
	createProvider,
	deepseekProvider,
	type ModelsError,
} from "../src/index.ts";

const authContext: AuthContext = {
	env: async (name) => ({ DEEPSEEK_API_KEY: "env-key" })[name],
	fileExists: async () => false,
};

function interaction(key: string, signal?: AbortSignal): AuthInteraction {
	return {
		signal,
		prompt: async (prompt) => {
			expect(prompt.type).toBe("secret");
			return key;
		},
	};
}

function setup() {
	const models = createModels({ authContext });
	models.setProvider(deepseekProvider());
	return models;
}

describe("Models.login", () => {
	it("stores the entered key and uses it for requests", async () => {
		const models = setup();
		const credential = await models.login("deepseek", interaction("sk-login"));

		expect(credential).toEqual({ type: "api_key", key: "sk-login" });
		const result = await models.getAuth("deepseek");
		expect(result?.auth.apiKey).toBe("sk-login");
		expect(result?.source).toBe("stored credential");
	});

	it("rejects an empty key", async () => {
		const models = setup();
		await expect(models.login("deepseek", interaction("   "))).rejects.toThrow(/cannot be empty/);
		expect((await models.getAuth("deepseek"))?.source).toBe("DEEPSEEK_API_KEY");
	});

	it("keeps the old credential when login fails", async () => {
		const models = setup();
		await models.login("deepseek", interaction("sk-first"));

		const failing: AuthInteraction = {
			prompt: async () => {
				throw new Error("cancelled");
			},
		};
		await expect(models.login("deepseek", failing)).rejects.toThrow("cancelled");
		expect((await models.getAuth("deepseek"))?.auth.apiKey).toBe("sk-first");
	});

	it("rejects an unknown provider", async () => {
		const models = setup();
		await expect(models.login("missing", interaction("sk"))).rejects.toMatchObject({
			name: "ModelsError",
			code: "provider",
		} satisfies Partial<ModelsError>);
	});

	it("rejects providers without a login flow", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "ambient-only",
				auth: {
					apiKey: {
						name: "Ambient",
						resolve: async () => ({ auth: { apiKey: "ambient" } }),
					},
				},
				models: [],
				api: {
					stream: () => {
						throw new Error("unused");
					},
					streamSimple: () => {
						throw new Error("unused");
					},
				},
			}),
		);

		await expect(models.login("ambient-only", interaction("sk"))).rejects.toThrow(/does not support login/);
	});

	it("does not write when the interaction is aborted", async () => {
		const models = setup();
		const controller = new AbortController();
		controller.abort();

		await expect(models.login("deepseek", interaction("sk-login", controller.signal))).rejects.toThrow();
		expect((await models.getAuth("deepseek"))?.source).toBe("DEEPSEEK_API_KEY");
	});
});

describe("Models.logout", () => {
	it("removes the stored credential so env is used again", async () => {
		const models = setup();
		await models.login("deepseek", interaction("sk-login"));

		await models.logout("deepseek");
		const result = await models.getAuth("deepseek");
		expect(result?.auth.apiKey).toBe("env-key");
		expect(result?.source).toBe("DEEPSEEK_API_KEY");
	});

	it("treats logging out an unknown provider as success", async () => {
		const models = setup();
		await expect(models.logout("missing")).resolves.toBeUndefined();
	});
});
