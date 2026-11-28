import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectTrusted } from "../../src/settings/project-trust.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../../src/settings/trust.ts";

const dirs: string[] = [];

async function tempDir(prefix = "pipi-trust-"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ProjectTrustStore", () => {
	it("stores decisions and finds the nearest ancestor", async () => {
		const agentDir = await tempDir();
		const parent = await tempDir();
		const child = join(parent, "nested");
		await mkdir(child);
		const store = new ProjectTrustStore(agentDir);

		store.set(parent, true);
		expect(store.get(child)).toBe(true);
		expect(store.getEntry(child)?.path).toBe(parent);
	});

	it("removes a decision with null", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const store = new ProjectTrustStore(agentDir);

		store.set(projectDir, false);
		store.set(projectDir, null);

		expect(store.get(projectDir)).toBeNull();
	});

	it("writes sorted, stable JSON", async () => {
		const agentDir = await tempDir();
		const a = join(agentDir, "b");
		const b = join(agentDir, "a");
		const store = new ProjectTrustStore(agentDir);

		store.setMany([
			{ path: a, decision: true },
			{ path: b, decision: false },
		]);

		const saved = JSON.parse(await readFile(join(agentDir, "trust.json"), "utf-8"));
		expect(Object.keys(saved)).toEqual([...Object.keys(saved)].sort());
	});
});

describe("hasTrustRequiringProjectResources", () => {
	it("returns false for an empty project", async () => {
		const projectDir = await tempDir();
		expect(hasTrustRequiringProjectResources(projectDir)).toBe(false);
	});

	it("detects project config resources", async () => {
		for (const entry of ["settings.json", "extensions", "skills", "prompts", "SYSTEM.md", "APPEND_SYSTEM.md"]) {
			const projectDir = await tempDir();
			await mkdir(join(projectDir, ".pipi"), { recursive: true });
			if (entry.endsWith(".json") || entry.endsWith(".md")) {
				await writeFile(join(projectDir, ".pipi", entry), "{}");
			} else {
				await mkdir(join(projectDir, ".pipi", entry));
			}
			expect(hasTrustRequiringProjectResources(projectDir), entry).toBe(true);
		}
	});

	it("detects ancestor .agents/skills", async () => {
		const root = await tempDir();
		const projectDir = join(root, "app");
		await mkdir(join(root, ".agents", "skills", "demo"), { recursive: true });
		await mkdir(projectDir, { recursive: true });

		expect(hasTrustRequiringProjectResources(projectDir)).toBe(true);
	});
});

describe("resolveProjectTrusted", () => {
	it("honors CLI overrides", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const trustStore = new ProjectTrustStore(agentDir);

		await expect(resolveProjectTrusted({ projectDir, trustStore, trustOverride: true, hasUI: false })).resolves.toBe(
			true,
		);
		await expect(resolveProjectTrusted({ projectDir, trustStore, trustOverride: false, hasUI: false })).resolves.toBe(
			false,
		);
	});

	it("trusts projects without trust-requiring resources", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const trustStore = new ProjectTrustStore(agentDir);

		await expect(resolveProjectTrusted({ projectDir, trustStore, hasUI: false })).resolves.toBe(true);
	});

	it("uses the trust store, then default policy", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		const trustStore = new ProjectTrustStore(agentDir);

		trustStore.set(projectDir, false);
		await expect(resolveProjectTrusted({ projectDir, trustStore, hasUI: false })).resolves.toBe(false);

		await expect(
			resolveProjectTrusted({ projectDir, trustStore, defaultProjectTrust: "always", hasUI: false }),
		).resolves.toBe(false);
	});

	it("returns false for ask without UI", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		const trustStore = new ProjectTrustStore(agentDir);

		await expect(resolveProjectTrusted({ projectDir, trustStore, hasUI: false })).resolves.toBe(false);
	});

	it("asks the UI and saves the decision", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		const trustStore = new ProjectTrustStore(agentDir);

		const trusted = await resolveProjectTrusted({
			projectDir,
			trustStore,
			hasUI: true,
			select: async (_prompt, options) => options.find((option) => option.label === "Trust")?.label,
		});

		expect(trusted).toBe(true);
		expect(trustStore.get(projectDir)).toBe(true);
	});

	it("does not save session-only decisions", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		const trustStore = new ProjectTrustStore(agentDir);

		const trusted = await resolveProjectTrusted({
			projectDir,
			trustStore,
			hasUI: true,
			select: async (_prompt, options) =>
				options.find((option) => option.label === "Trust (this session only)")?.label,
		});

		expect(trusted).toBe(true);
		expect(trustStore.get(projectDir)).toBeNull();
	});

	it("trusts and clears the current entry when choosing the parent", async () => {
		const agentDir = await tempDir();
		const parent = await tempDir();
		const projectDir = join(parent, "app");
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		const trustStore = new ProjectTrustStore(agentDir);

		const trusted = await resolveProjectTrusted({
			projectDir,
			trustStore,
			hasUI: true,
			select: async (_prompt, options) =>
				options.find((option) => option.label.startsWith("Trust parent folder"))?.label,
		});

		expect(trusted).toBe(true);
		expect(trustStore.getEntry(projectDir)?.path).toBe(parent);
	});

	it("lets the extension hook decide first", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		const trustStore = new ProjectTrustStore(agentDir);

		await expect(
			resolveProjectTrusted({
				projectDir,
				trustStore,
				hasUI: false,
				extensionDecision: async () => true,
			}),
		).resolves.toBe(true);
	});
});
