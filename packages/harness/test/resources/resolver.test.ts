import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResourceResolver } from "../../src/resources/resolver.ts";
import { type CreateResourceSettingsOptions, createResourceSettings } from "../../src/resources/settings.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-resolver-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeSkill(dir: string, name: string): Promise<string> {
	await mkdir(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	await writeFile(file, `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
	return file;
}

async function resolve(
	agentDir: string,
	projectDir: string,
	overrides: Partial<Omit<CreateResourceSettingsOptions, "projectDir" | "agentDir">> = {},
) {
	const settings = createResourceSettings({ projectDir, agentDir, ...overrides });
	return new ResourceResolver(settings).resolve();
}

describe("ResourceResolver", () => {
	it("discovers user and project defaults with metadata", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const userSkill = await writeSkill(join(agentDir, "skills", "user-skill"), "user-skill");
		const projectSkill = await writeSkill(join(projectDir, ".pipi", "skills", "project-skill"), "project-skill");
		await mkdir(join(projectDir, ".pipi", "prompts"), { recursive: true });
		const prompt = join(projectDir, ".pipi", "prompts", "review.md");
		await writeFile(prompt, "body");

		const resolved = await resolve(agentDir, projectDir);

		const skillEntries = resolved.skills.map((entry) => entry.path);
		expect(skillEntries).toEqual([projectSkill, userSkill]);
		expect(resolved.skills[0].metadata).toMatchObject({ source: "auto", scope: "project", origin: "top-level" });
		expect(resolved.skills[1].metadata).toMatchObject({ source: "auto", scope: "agent", origin: "top-level" });
		expect(resolved.prompts.map((entry) => entry.path)).toEqual([prompt]);
	});

	it("resolves explicit settings entries relative to their config dirs", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const userSkill = await writeSkill(join(agentDir, "custom", "u"), "u");
		const projectSkill = await writeSkill(join(projectDir, ".pipi", "extra", "p"), "p");

		const resolved = await resolve(agentDir, projectDir, {
			skills: { agent: ["custom"], project: ["extra"] },
		});

		const entries = new Map(resolved.skills.map((entry) => [entry.path, entry.metadata]));
		expect(entries.get(userSkill)).toMatchObject({ source: "local", scope: "agent", origin: "top-level" });
		expect(entries.get(projectSkill)).toMatchObject({ source: "local", scope: "project", origin: "top-level" });
	});

	it("silently skips missing settings entries", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();

		const resolved = await resolve(agentDir, projectDir, {
			skills: { agent: ["missing"] },
		});

		expect(resolved.skills).toEqual([]);
	});

	it("matches forced include and exclude patterns against skill directories", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeSkill(join(agentDir, "skills", "keep"), "keep");
		await writeSkill(join(agentDir, "skills", "ignored"), "ignored");

		const resolved = await resolve(agentDir, projectDir, {
			skills: { agent: ["!*", "+skills/keep", "-skills/ignored"] },
		});

		const enabled = new Map(resolved.skills.map((entry) => [entry.path, entry.enabled]));
		expect(enabled.get(join(agentDir, "skills", "keep", "SKILL.md"))).toBe(true);
		expect(enabled.get(join(agentDir, "skills", "ignored", "SKILL.md"))).toBe(false);
	});

	it("disables auto-discovered resources with exclusion patterns", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeSkill(join(agentDir, "skills", "keep"), "keep");
		await writeSkill(join(agentDir, "skills", "ignored"), "ignored");

		const resolved = await resolve(agentDir, projectDir, {
			skills: { agent: ["!ignored"] },
		});

		const enabled = new Map(resolved.skills.map((entry) => [entry.path, entry.enabled]));
		expect(enabled.get(join(agentDir, "skills", "ignored", "SKILL.md"))).toBe(false);
		expect(enabled.get(join(agentDir, "skills", "keep", "SKILL.md"))).toBe(true);
	});

	it("puts project resources before user resources and dedupes by real path", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const projectSkill = join(projectDir, ".pipi", "skills", "shared");
		await writeSkill(projectSkill, "shared");
		const userSkill = await writeSkill(join(agentDir, "skills", "shared"), "shared");

		const resolved = await resolve(agentDir, projectDir, {
			skills: { project: [join(projectSkill, "SKILL.md")] },
		});

		expect(resolved.skills.map((entry) => entry.path)).toEqual([join(projectSkill, "SKILL.md"), userSkill]);
		expect(resolved.skills[0].metadata).toMatchObject({ source: "local", scope: "project" });
	});

	it("includes .agents/skills from ancestors", async () => {
		const agentDir = await tempDir();
		const repoRoot = await tempDir();
		const projectDir = join(repoRoot, "pkg", "app");
		await mkdir(join(repoRoot, ".git"), { recursive: true });
		await mkdir(projectDir, { recursive: true });
		const agentsSkill = await writeSkill(join(repoRoot, ".agents", "skills", "shared"), "shared");

		const resolved = await resolve(agentDir, projectDir);

		const entry = resolved.skills.find((candidate) => candidate.path === agentsSkill);
		expect(entry?.metadata).toMatchObject({ source: "auto", scope: "project", baseDir: join(repoRoot, ".agents") });
	});

	it("skips project resources when the project is not trusted", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeSkill(join(projectDir, ".pipi", "skills", "project-skill"), "project-skill");
		await writeSkill(join(agentDir, "skills", "user-skill"), "user-skill");

		const resolved = await resolve(agentDir, projectDir, { projectTrusted: false });

		expect(resolved.skills.map((entry) => entry.path)).toEqual([join(agentDir, "skills", "user-skill", "SKILL.md")]);
	});

	it("discovers only top-level prompt files", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi", "prompts", "nested"), { recursive: true });
		await writeFile(join(projectDir, ".pipi", "prompts", "top.md"), "top");
		await writeFile(join(projectDir, ".pipi", "prompts", "nested", "deep.md"), "deep");

		const resolved = await resolve(agentDir, projectDir);

		expect(resolved.prompts.map((entry) => entry.path)).toEqual([join(projectDir, ".pipi", "prompts", "top.md")]);
	});

	it("reads pipi.extensions from package.json", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const extensionDir = join(projectDir, ".pipi", "extensions", "manifest");
		const entry = join(extensionDir, "entry.ts");
		await mkdir(extensionDir, { recursive: true });
		await writeFile(entry, "export default {}");
		await writeFile(join(extensionDir, "package.json"), JSON.stringify({ pipi: { extensions: ["entry.ts"] } }));

		const resolved = await resolve(agentDir, projectDir);

		expect(resolved.extensions.map((candidate) => candidate.path)).toEqual([entry]);
	});

	it("resolves extension entry points", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const extensionIndex = join(projectDir, ".pipi", "extensions", "demo", "index.ts");
		await mkdir(join(projectDir, ".pipi", "extensions", "demo"), { recursive: true });
		await writeFile(extensionIndex, "export default {}");

		const resolved = await resolve(agentDir, projectDir);

		expect(resolved.extensions.map((entry) => entry.path)).toEqual([extensionIndex]);
	});
});
