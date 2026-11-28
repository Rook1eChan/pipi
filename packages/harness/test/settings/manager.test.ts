import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectSettingsDiagnostics } from "../../src/settings/diagnostics.ts";
import { SettingsManager } from "../../src/settings/manager.ts";
import { toResourceSettings } from "../../src/settings/resource-settings.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-settings-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeSettings(path: string, settings: unknown): Promise<void> {
	await mkdir(path, { recursive: true });
	await writeFile(join(path, "settings.json"), JSON.stringify(settings, null, 2));
}

describe("SettingsManager", () => {
	it("deep merges project settings over agent settings", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(agentDir, {
			defaultModel: "agent-model",
			compaction: { reserveTokens: 100, keepRecentTokens: 200 },
		});
		await writeSettings(join(projectDir, ".pipi"), {
			compaction: { reserveTokens: 50 },
		});

		const manager = SettingsManager.create(projectDir, agentDir);
		const settings = manager.getSettings();

		expect(settings.defaultModel).toBe("agent-model");
		expect(settings.compaction).toEqual({ reserveTokens: 50, keepRecentTokens: 200 });
	});

	it("does not read project settings before trust", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(join(projectDir, ".pipi"), { defaultModel: "project-model" });

		const manager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
		expect(manager.getSettings().defaultModel).toBeUndefined();

		manager.setProjectTrusted(true);
		expect(manager.getSettings().defaultModel).toBe("project-model");
	});

	it("records a parse error and keeps running", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeFile(join(agentDir, "settings.json"), "{ broken");

		const manager = SettingsManager.create(projectDir, agentDir);
		const errors = manager.drainErrors();

		expect(manager.getSettings()).toEqual({});
		expect(errors[0]).toMatchObject({ scope: "agent", path: join(agentDir, "settings.json") });
	});

	it("writes only modified fields and preserves unknown fields", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(agentDir, {
			defaultModel: "old",
			theme: "dark",
			unknownField: { keep: true },
		});

		const manager = SettingsManager.create(projectDir, agentDir);
		manager.setDefaultModel("new");
		await manager.flush();

		const saved = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"));
		expect(saved.defaultModel).toBe("new");
		expect(saved.theme).toBe("dark");
		expect(saved.unknownField).toEqual({ keep: true });
	});

	it("serializes concurrent writes", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		const manager = SettingsManager.create(projectDir, agentDir);

		manager.setDefaultModel("first");
		manager.setDefaultModel("second");
		await manager.flush();

		const saved = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"));
		expect(saved.defaultModel).toBe("second");
	});

	it("reloads external changes", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		const manager = SettingsManager.create(projectDir, agentDir);
		await writeSettings(agentDir, { defaultModel: "external" });

		await manager.reload();

		expect(manager.getSettings().defaultModel).toBe("external");
	});

	it("supports in-memory settings and overrides", () => {
		const manager = SettingsManager.inMemory({ defaultModel: "base" });
		manager.applyOverrides({ defaultModel: "override" });

		expect(manager.getSettings().defaultModel).toBe("override");
		expect(manager.getDefaultProjectTrust()).toBe("ask");
	});
});

describe("settings getters and setters", () => {
	it("returns defaults", () => {
		const manager = SettingsManager.inMemory();

		expect(manager.getCompactionSettings()).toEqual({
			enabled: true,
			reserveTokens: 16384,
			keepRecentTokens: 20000,
		});
		expect(manager.getBranchSummarySettings()).toEqual({ reserveTokens: 16384, skipPrompt: false });
		expect(manager.getRetrySettings()).toEqual({ enabled: true, maxRetries: 3, baseDelayMs: 2000 });
		expect(manager.getSteeringMode()).toBe("single");
		expect(manager.getEnableSkillCommands()).toBe(true);
		expect(manager.getDefaultProjectTrust()).toBe("ask");
	});

	it("merges nested settings from both layers", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(agentDir, {
			compaction: { reserveTokens: 100, keepRecentTokens: 200 },
			retry: { enabled: false, maxRetries: 5 },
		});
		await writeSettings(join(projectDir, ".pipi"), { compaction: { reserveTokens: 50 } });

		const manager = SettingsManager.create(projectDir, agentDir);

		expect(manager.getCompactionSettings()).toEqual({
			enabled: true,
			reserveTokens: 50,
			keepRecentTokens: 200,
		});
		expect(manager.getRetrySettings()).toEqual({ enabled: false, maxRetries: 5, baseDelayMs: 2000 });
	});

	it("writes nested fields without dropping siblings", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(agentDir, { compaction: { reserveTokens: 100, keepRecentTokens: 200 } });

		const manager = SettingsManager.create(projectDir, agentDir);
		manager.setCompactionEnabled(false);
		await manager.flush();

		const saved = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf-8"));
		expect(saved.compaction).toEqual({
			reserveTokens: 100,
			keepRecentTokens: 200,
			enabled: false,
		});
	});

	it("writes project settings when trusted and rejects writes when untrusted", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(join(projectDir, ".pipi"), { unknownField: "keep" });

		const manager = SettingsManager.create(projectDir, agentDir);
		manager.setProjectSkillPaths(["extra"]);
		await manager.flush();

		const saved = JSON.parse(await readFile(join(projectDir, ".pipi", "settings.json"), "utf-8"));
		expect(saved.skills).toEqual(["extra"]);
		expect(saved.unknownField).toBe("keep");

		const untrusted = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
		expect(() => untrusted.setProjectSkillPaths(["no"])).toThrow("not trusted");
	});

	it("converts settings into a resource snapshot", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeSettings(agentDir, { extensions: ["a"], skills: ["b"], prompts: ["c"] });
		await writeSettings(join(projectDir, ".pipi"), { skills: ["d"] });

		const manager = SettingsManager.create(projectDir, agentDir);
		const snapshot = toResourceSettings(manager);

		expect(snapshot).toMatchObject({
			projectDir: projectDir,
			agentDir,
			projectTrusted: true,
			extensions: { agent: ["a"], project: [] },
			skills: { agent: ["b"], project: ["d"] },
			prompts: { agent: ["c"], project: [] },
		});
	});
});

describe("settings diagnostics", () => {
	it("converts errors into display diagnostics", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeFile(join(agentDir, "settings.json"), "not json");

		const manager = SettingsManager.create(projectDir, agentDir);
		const diagnostics = collectSettingsDiagnostics(manager);

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({ type: "warning" });
		expect(diagnostics[0].message).toContain("Invalid settings file");
	});
});
