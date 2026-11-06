import {
	type AssistantMessage,
	AssistantMessageEventStream,
	type AuthContext,
	type Context,
	createModels,
	createProvider,
	envApiKeyAuth,
	fauxProvider,
	InMemoryCredentialStore,
	type Model,
	type ProviderStreams,
	type StreamOptions,
} from "@pipi/llm";
import { describe, expect, it } from "vitest";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function model(overrides: Partial<Model> = {}): Model {
	return {
		id: "model-a",
		name: "Model A",
		api: "openai-completions",
		provider: "demo",
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
		...overrides,
	};
}

const context: Context = {
	messages: [{ role: "user", content: "hello", timestamp: 1 }],
};

function doneStream(target: Model): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: target.api,
		provider: target.provider,
		model: target.id,
		usage,
		stopReason: "stop",
		timestamp: 1,
	};
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

function keylessAuth() {
	return {
		apiKey: {
			name: "Keyless",
			resolve: async () => ({ auth: {} }),
		},
	};
}

function capturingApi(records: Array<{ model: Model; options?: StreamOptions }>): ProviderStreams {
	return {
		stream: (target, _context, options) => {
			records.push({ model: target, options });
			return doneStream(target);
		},
		streamSimple: (target, _context, options) => {
			records.push({ model: target, options });
			return doneStream(target);
		},
	};
}

describe("Models registry", () => {
	it("registers providers and finds models by exact provider and id", () => {
		const models = createModels();
		models.setProvider(
			createProvider({
				id: "demo",
				name: "Demo",
				auth: keylessAuth(),
				models: [model({ id: "a" }), model({ id: "b" })],
				api: capturingApi([]),
			}),
		);

		expect(models.getProvider("demo")?.name).toBe("Demo");
		expect(models.getModel("demo", "a")?.id).toBe("a");
		expect(models.getModel("demo", "A")).toBeUndefined();
		expect(models.getModel("missing", "a")).toBeUndefined();
		expect(models.getModels("missing")).toEqual([]);
	});

	it("replaces a provider with the same id and deletes it", () => {
		const models = createModels();
		models.setProvider(
			createProvider({ id: "demo", name: "First", auth: keylessAuth(), models: [], api: capturingApi([]) }),
		);
		models.setProvider(
			createProvider({ id: "demo", name: "Second", auth: keylessAuth(), models: [], api: capturingApi([]) }),
		);
		expect(models.getProvider("demo")?.name).toBe("Second");
		models.deleteProvider("demo");
		expect(models.getProvider("demo")).toBeUndefined();
	});
});

describe("createProvider dispatch", () => {
	it("dispatches by model.api when given an API map", async () => {
		const records: Array<{ model: Model; options?: StreamOptions }> = [];
		const models = createModels();
		models.setProvider(
			createProvider({
				id: "demo",
				auth: keylessAuth(),
				models: [model({ id: "a", api: "openai-completions" }), model({ id: "b", api: "anthropic-messages" })],
				api: {
					"openai-completions": capturingApi(records),
					"anthropic-messages": capturingApi(records),
				},
			}),
		);

		await models.streamSimple(models.getModel("demo", "a")!, context).result();
		await models.streamSimple(models.getModel("demo", "b")!, context).result();
		expect(records.map((entry) => entry.model.api)).toEqual(["openai-completions", "anthropic-messages"]);
	});

	it("returns an error stream when the API implementation is missing", async () => {
		const models = createModels();
		models.setProvider(
			createProvider({
				id: "demo",
				auth: keylessAuth(),
				models: [model({ id: "a", api: "custom-api" })],
				api: { "openai-completions": capturingApi([]) },
			}),
		);

		const result = await models.streamSimple(models.getModel("demo", "a")!, context).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("no API implementation");
	});
});

describe("authentication", () => {
	const authContext: AuthContext = {
		env: async (name) => (name === "DEMO_API_KEY" ? "env-key" : undefined),
		fileExists: async () => false,
	};

	it("prefers a stored credential over the environment", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.write("demo", { type: "api_key", key: "stored-key" });
		const models = createModels({ credentials, authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: { apiKey: envApiKeyAuth("Demo", ["DEMO_API_KEY"]) },
				models: [model()],
				api: capturingApi([]),
			}),
		);

		const result = await models.getAuth("demo");
		expect(result?.auth.apiKey).toBe("stored-key");
		expect(result?.source).toBe("stored credential");
	});

	it("falls back to the environment and reports a missing auth error", async () => {
		const models = createModels({ authContext });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: { apiKey: envApiKeyAuth("Demo", ["DEMO_API_KEY"]) },
				models: [model()],
				api: capturingApi([]),
			}),
		);

		expect((await models.getAuth("demo"))?.auth.apiKey).toBe("env-key");

		const missingModels = createModels({
			authContext: { env: async () => undefined, fileExists: async () => false },
		});
		missingModels.setProvider(
			createProvider({
				id: "demo",
				auth: { apiKey: envApiKeyAuth("Demo", ["DEMO_API_KEY"]) },
				models: [model()],
				api: capturingApi([]),
			}),
		);
		const result = await missingModels.streamSimple(missingModels.getModel("demo", "model-a")!, context).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("not configured");
	});
});

describe("applyAuth", () => {
	it("merges apiKey, model headers, request headers, env and baseUrl", async () => {
		const records: Array<{ model: Model; options?: StreamOptions }> = [];
		const models = createModels();
		models.setProvider(
			createProvider({
				id: "demo",
				auth: {
					apiKey: {
						name: "Demo",
						resolve: async () => ({
							auth: { apiKey: "auth-key", headers: { "X-Auth": "auth" }, baseUrl: "https://auth.test" },
							env: { A: "auth", SAME: "auth" },
							source: "test",
						}),
					},
				},
				models: [model({ headers: { "X-Model": "model" } })],
				api: capturingApi(records),
			}),
		);

		await models
			.streamSimple(models.getModel("demo", "model-a")!, context, {
				apiKey: "request-key",
				headers: { "X-Request": "request", "x-auth": "request-auth" },
				env: { B: "request", SAME: "request" },
			})
			.result();

		expect(records[0].options?.apiKey).toBe("request-key");
		expect(records[0].options?.headers).toMatchObject({
			"X-Request": "request",
			"x-auth": "request-auth",
			"X-Model": "model",
		});
		expect(records[0].options?.env).toEqual({ A: "auth", B: "request", SAME: "request" });
		expect(records[0].model.baseUrl).toBe("https://auth.test");
	});
});

describe("faux provider", () => {
	it("streams a fixed assistant message", async () => {
		const models = createModels();
		models.setProvider(fauxProvider("hello from faux"));
		const target = models.getModel("faux", "faux-1")!;
		const stream = models.streamSimple(target, context);
		const events: string[] = [];
		for await (const event of stream) events.push(event.type);
		const result = await stream.result();
		expect(events).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(result.content).toEqual([{ type: "text", text: "hello from faux" }]);
	});
});
