import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileCredentialStore } from "../src/auth/file-credential-store.ts";

const paths: string[] = [];

async function makeStore(): Promise<{ store: FileCredentialStore; path: string; dir: string }> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-auth-"));
	paths.push(dir);
	const path = join(dir, "auth.json");
	return { store: new FileCredentialStore(path), path, dir };
}

afterEach(async () => {
	await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("FileCredentialStore", () => {
	it("persists a credential across instances", async () => {
		const { store, path } = await makeStore();
		await store.write("deepseek", { type: "api_key", key: "sk-1" });

		const reopened = new FileCredentialStore(path);
		expect(await reopened.read("deepseek")).toEqual({ type: "api_key", key: "sk-1" });
	});

	it("returns undefined for unknown providers", async () => {
		const { store } = await makeStore();
		expect(await store.read("missing")).toBeUndefined();
	});

	it("lists provider ids without exposing keys", async () => {
		const { store } = await makeStore();
		await store.write("openai", { type: "api_key", key: "sk-1" });
		await store.write("deepseek", { type: "api_key", key: "sk-2" });

		expect(await store.list()).toEqual([
			{ providerId: "openai", type: "api_key" },
			{ providerId: "deepseek", type: "api_key" },
		]);
	});

	it("deletes a provider and keeps the others", async () => {
		const { store } = await makeStore();
		await store.write("openai", { type: "api_key", key: "sk-1" });
		await store.write("deepseek", { type: "api_key", key: "sk-2" });

		await store.delete("openai");
		expect(await store.read("openai")).toBeUndefined();
		expect(await store.read("deepseek")).toEqual({ type: "api_key", key: "sk-2" });
	});

	it("treats deleting a missing provider as success", async () => {
		const { store } = await makeStore();
		await expect(store.delete("missing")).resolves.toBeUndefined();
	});

	it("creates the file with mode 0600", async () => {
		if (process.platform === "win32") return;
		const { store, path } = await makeStore();
		await store.write("deepseek", { type: "api_key", key: "sk-1" });
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it("keeps concurrent writes for different providers", async () => {
		const { store, path } = await makeStore();
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				store.write(`provider-${index}`, { type: "api_key", key: `sk-${index}` }),
			),
		);

		const text = await readFile(path, "utf-8");
		expect(Object.keys(JSON.parse(text))).toHaveLength(20);
		expect(await store.read("provider-19")).toEqual({ type: "api_key", key: "sk-19" });
	});

	it("leaves no temporary files behind", async () => {
		const { store, dir } = await makeStore();
		await store.write("deepseek", { type: "api_key", key: "sk-1" });
		expect((await readdir(dir)).sort()).toEqual(["auth.json"]);
	});

	it("rejects invalid existing files instead of overwriting them", async () => {
		const { store, path } = await makeStore();
		await writeFile(path, "not json", "utf-8");
		await expect(store.read("deepseek")).rejects.toThrow();
		await expect(store.write("deepseek", { type: "api_key", key: "sk-1" })).rejects.toThrow();
		expect(await readFile(path, "utf-8")).toBe("not json");
	});

	it("does not write when the signal is already aborted", async () => {
		const { store, dir } = await makeStore();
		const controller = new AbortController();
		controller.abort();

		await expect(
			store.write("deepseek", { type: "api_key", key: "sk-1" }, { signal: controller.signal }),
		).rejects.toThrow();
		expect(await readdir(dir)).toEqual([]);
	});

	it("keeps the old content when the signal aborts before rename", async () => {
		const { store, path } = await makeStore();
		await store.write("deepseek", { type: "api_key", key: "old" });

		const before = await readFile(path, "utf-8");
		const controller = new AbortController();
		controller.abort();

		await expect(
			store.write("deepseek", { type: "api_key", key: "new" }, { signal: controller.signal }),
		).rejects.toThrow();
		expect(await readFile(path, "utf-8")).toBe(before);
	});
});
