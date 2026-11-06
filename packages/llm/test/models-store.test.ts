import {
	type AssistantMessage,
	AssistantMessageEventStream,
	createModels,
	createProvider,
	InMemoryModelsStore,
	type Model,
	type ModelsStoreEntry,
	type ProviderStreams,
} from "@pipi/llm";
import { describe, expect, it } from "vitest";

function model(id: string): Model {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: "demo",
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	};
}

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function doneStream(target: Model): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
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

const api: ProviderStreams = {
	stream: (target) => doneStream(target),
	streamSimple: (target) => doneStream(target),
};

function keylessAuth() {
	return {
		apiKey: {
			name: "Keyless",
			resolve: async () => ({ auth: {} }),
		},
	};
}

describe("ModelsStore", () => {
	it("reads, writes and deletes entries", async () => {
		const store = new InMemoryModelsStore();
		const entry: ModelsStoreEntry = { models: [model("a")], checkedAt: 1, etag: "x" };
		await store.write("demo", entry);
		expect(await store.read("demo")).toEqual(entry);
		await store.delete("demo");
		expect(await store.read("demo")).toBeUndefined();
	});
});

describe("refresh", () => {
	it("restores cached dynamic models without network", async () => {
		const store = new InMemoryModelsStore();
		await store.write("demo", { models: [model("cached")], checkedAt: 1 });
		let fetchCount = 0;
		const models = createModels({ modelsStore: store });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: keylessAuth(),
				models: [model("baseline")],
				api,
				fetchModels: async () => {
					fetchCount++;
					return [model("remote")];
				},
			}),
		);

		await models.refresh({ allowNetwork: false });
		expect(fetchCount).toBe(0);
		expect(models.getModels("demo").map((item) => item.id)).toContain("cached");
	});

	it("fetches and persists dynamic models when network is allowed", async () => {
		const store = new InMemoryModelsStore();
		let fetchCount = 0;
		const models = createModels({ modelsStore: store });
		models.setProvider(
			createProvider({
				id: "demo",
				auth: keylessAuth(),
				models: [model("baseline")],
				api,
				fetchModels: async () => {
					fetchCount++;
					return [model("remote")];
				},
			}),
		);

		const result = await models.refresh({ allowNetwork: true });
		expect(result.errors.size).toBe(0);
		expect(fetchCount).toBe(1);
		expect(models.getModels("demo").map((item) => item.id)).toEqual(["baseline", "remote"]);
		expect((await store.read("demo"))?.models.map((item) => item.id)).toEqual(["remote"]);
	});

	it("does not touch the network for static providers", async () => {
		const models = createModels();
		models.setProvider(
			createProvider({
				id: "demo",
				auth: keylessAuth(),
				models: [model("a")],
				api,
			}),
		);
		const result = await models.refresh();
		expect(result.errors.size).toBe(0);
		expect(models.getModels("demo").map((item) => item.id)).toEqual(["a"]);
	});
});
