import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectTrustStore } from "../src/settings/trust.ts";
import { resolveStartup } from "../src/startup.ts";

const dirs: string[] = [];

async function tempDir(prefix = "pipi-startup-"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveStartup", () => {
	it("trusts an empty project and returns an empty resource snapshot", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		const result = await resolveStartup({ projectDir, agentDir });

		expect(result.projectTrusted).toBe(true);
		expect(result.resourceSettings.skills).toEqual({ agent: [], project: [] });
		expect(result.diagnostics).toEqual([]);
	});

	it("does not load project settings without trust", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		await writeFile(join(projectDir, ".pipi", "settings.json"), JSON.stringify({ defaultModel: "project" }));

		const result = await resolveStartup({ projectDir, agentDir });

		expect(result.projectTrusted).toBe(false);
		expect(result.settingsManager.getSettings().defaultModel).toBeUndefined();
	});

	it("loads project settings when the trust store says yes", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "skills"), { recursive: true });
		await writeFile(join(projectDir, ".pipi", "settings.json"), JSON.stringify({ defaultModel: "project" }));

		new ProjectTrustStore(agentDir).set(projectDir, true);
		const result = await resolveStartup({ projectDir, agentDir });

		expect(result.projectTrusted).toBe(true);
		expect(result.settingsManager.getSettings().defaultModel).toBe("project");
	});

	it("reports settings diagnostics", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		await writeFile(join(agentDir, "settings.json"), "broken");

		const result = await resolveStartup({ projectDir, agentDir });

		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]).toMatchObject({ type: "warning" });
	});

	it("uses --session-dir and parsed args", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		const result = await resolveStartup({
			projectDir,
			agentDir,
			args: ["--session-dir", "/tmp/custom-sessions", "--model", "demo"],
		});

		expect(result.sessionDir).toBe("/tmp/custom-sessions");
		expect(result.args.model).toBe("demo");
	});

	it("passes argument diagnostics through", async () => {
		const projectDir = await tempDir();
		const agentDir = await tempDir();
		const result = await resolveStartup({ projectDir, agentDir, args: ["-z"] });

		expect(result.diagnostics[0]).toMatchObject({ type: "error", message: "Unknown option: -z" });
	});
});
