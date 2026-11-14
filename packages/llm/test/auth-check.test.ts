import { describe, expect, it } from "vitest";
import {
	type AuthContext,
	type CredentialStore,
	createModels,
	createProvider,
	type ModelsError,
} from "../src/index.ts";

const authContext: AuthContext = {
	env: async (name) => ({ TEST_API_KEY: "env-key" })[name],
	fileExists: async () => false,
};

const dummyApi = {
	stream: () => {
		throw new Error("unused");
	},
	streamSimple: () => {
		throw new Error("unused");
	},
};

function model() {
	return {
		id: "model-a",
		name: "Model A",
		api: "openai-completions" as const,
		provider: "demo",
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	};
}

describe("Models.checkAuth", () => {
	it("uses check when provided and does not resolve", async () => {
		let resolved = 0;
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: {
					apiKey: {
						name: "Demo",
						check: async () => ({ type: "api_key", source: "check" }),
						resolve: async () => {
							resolved++;
							return { auth: { apiKey: "k" } };
						},
					},
				},
				models: [model()],
				api: dummyApi,
			}),
		);

		expect(await models.checkAuth("demo")).toEqual({ type: "api_key", source: "check" });
		expect(resolved).toBe(0);
	});

	it("falls back to resolve when check is absent", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: {
					apiKey: {
						name: "Demo",
						resolve: async () => ({ auth: { apiKey: "k" }, source: "TEST_API_KEY" }),
					},
				},
				models: [model()],
				api: dummyApi,
			}),
		);

		expect(await models.checkAuth("demo")).toEqual({ type: "api_key", source: "TEST_API_KEY" });
	});

	it("returns undefined when the provider is not configured", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: { apiKey: { name: "Demo", resolve: async () => undefined } },
				models: [model()],
				api: dummyApi,
			}),
		);

		expect(await models.checkAuth("demo")).toBeUndefined();
	});

	it("returns undefined for unknown providers", async () => {
		const models = createModels({ authContext });
		expect(await models.checkAuth("missing")).toBeUndefined();
	});

	it("wraps check failures as auth errors", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: {
					apiKey: {
						name: "Demo",
						check: async () => {
							throw new Error("check failed");
						},
						resolve: async () => ({ auth: { apiKey: "k" } }),
					},
				},
				models: [model()],
				api: dummyApi,
			}),
		);

		await expect(models.checkAuth("demo")).rejects.toMatchObject({
			name: "ModelsError",
			code: "auth",
			message: expect.stringContaining("check failed"),
		} satisfies Partial<ModelsError>);
	});
});

describe("auth error wrapping", () => {
	it("wraps resolve failures in getAuth", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: {
					apiKey: {
						name: "Demo",
						resolve: async () => {
							throw new Error("boom");
						},
					},
				},
				models: [model()],
				api: dummyApi,
			}),
		);

		await expect(models.getAuth("demo")).rejects.toMatchObject({
			code: "auth",
			message: expect.stringContaining("boom"),
		});
	});

	it("wraps credential store failures", async () => {
		const failingStore: CredentialStore = {
			read: async () => {
				throw new Error("disk error");
			},
			list: async () => [],
			write: async () => undefined,
			delete: async () => undefined,
		};
		const models = createModels({ authContext, credentials: failingStore });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: { apiKey: { name: "Demo", resolve: async () => ({ auth: { apiKey: "k" } }) } },
				models: [model()],
				api: dummyApi,
			}),
		);

		await expect(models.getAuth("demo")).rejects.toMatchObject({
			code: "auth",
			message: expect.stringContaining("disk error"),
		});
		await expect(models.checkAuth("demo")).rejects.toMatchObject({ code: "auth" });
	});
});

describe("getAvailable", () => {
	it("excludes providers without configured auth", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "configured",
				auth: { apiKey: { name: "Configured", resolve: async () => ({ auth: { apiKey: "k" } }) } },
				models: [{ ...model(), provider: "configured" }],
				api: dummyApi,
			}),
		);
		models.setProvider(
			createProvider({
				id: "unconfigured",
				auth: { apiKey: { name: "Unconfigured", resolve: async () => undefined } },
				models: [{ ...model(), id: "model-b", provider: "unconfigured" }],
				api: dummyApi,
			}),
		);

		const available = await models.getAvailable();
		expect(available.map((entry) => entry.provider)).toEqual(["configured"]);
	});
});
