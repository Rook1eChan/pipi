import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResourceLoader } from "../../src/resources/loader.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-loader-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeSkill(dir: string, name: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
}

async function writePrompt(dir: string, name: string, body = "body"): Promise<string> {
	await mkdir(dir, { recursive: true });
	const file = join(dir, `${name}.md`);
	await writeFile(file, body);
	return file;
}

describe("ResourceLoader", () => {
	it("stays empty until reload is called", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeFile(join(agentDir, "AGENTS.md"), "agent rules");
		await writeSkill(join(agentDir, "skills", "pdf"), "pdf");
		await writePrompt(join(agentDir, "prompts"), "review");

		const loader = new ResourceLoader({ projectDir, agentDir });

		expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getPrompts().prompts).toEqual([]);

		await loader.reload();

		expect(loader.getAgentsFiles().agentsFiles.map((file) => file.content)).toContain("agent rules");
		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["pdf"]);
		expect(loader.getPrompts().prompts.map((template) => template.name)).toEqual(["review"]);
	});

	it("lets project resources win name collisions", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeSkill(join(agentDir, "skills", "shared"), "shared");
		await writeFile(
			join(agentDir, "skills", "shared", "SKILL.md"),
			"---\nname: shared\ndescription: from user\n---\n",
		);
		await writeSkill(join(projectDir, ".pipi", "skills", "shared"), "shared");
		await writeFile(
			join(projectDir, ".pipi", "skills", "shared", "SKILL.md"),
			"---\nname: shared\ndescription: from project\n---\n",
		);
		await writePrompt(join(agentDir, "prompts"), "review", "user prompt");
		await writePrompt(join(projectDir, ".pipi", "prompts"), "review", "project prompt");

		const loader = new ResourceLoader({ projectDir, agentDir });
		await loader.reload();

		expect(loader.getSkills().skills).toHaveLength(1);
		expect(loader.getSkills().skills[0].description).toBe("from project");
		expect(loader.getSkills().skills[0].sourceInfo.scope).toBe("project");
		expect(loader.getSkills().diagnostics.some((diagnostic) => diagnostic.type === "collision")).toBe(true);

		expect(loader.getPrompts().prompts).toHaveLength(1);
		expect(loader.getPrompts().prompts[0].content).toBe("project prompt");
		expect(loader.getPrompts().diagnostics.some((diagnostic) => diagnostic.type === "collision")).toBe(true);
	});

	it("keeps additional paths when defaults are disabled", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const extraSkills = await tempDir();
		const extraPrompts = await tempDir();
		await writeSkill(join(extraSkills, "extra"), "extra");
		const promptFile = await writePrompt(extraPrompts, "extra-prompt");
		await writeSkill(join(agentDir, "skills", "default"), "default");
		await writePrompt(join(agentDir, "prompts"), "default-prompt");

		const loader = new ResourceLoader({
			projectDir,
			agentDir,
			noSkills: true,
			noPromptTemplates: true,
			additionalSkillPaths: [extraSkills],
			additionalPromptTemplatePaths: [promptFile],
		});
		await loader.reload();

		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["extra"]);
		expect(loader.getPrompts().prompts.map((template) => template.name)).toEqual(["extra-prompt"]);
	});

	it("honors the no-* switches without additional paths", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeFile(join(agentDir, "AGENTS.md"), "rules");
		await writeSkill(join(agentDir, "skills", "pdf"), "pdf");
		await writePrompt(join(agentDir, "prompts"), "a");

		const loader = new ResourceLoader({
			projectDir,
			agentDir,
			noContextFiles: true,
			noSkills: true,
			noPromptTemplates: true,
		});
		await loader.reload();

		expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getPrompts().prompts).toEqual([]);
	});

	it("reads explicit system prompts and append prompts", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const systemFile = join(projectDir, "system.md");
		const appendFile = join(projectDir, "append.md");
		await writeFile(systemFile, "custom system");
		await writeFile(appendFile, "extra rules");

		const loader = new ResourceLoader({
			projectDir,
			agentDir,
			systemPrompt: systemFile,
			appendSystemPrompt: [appendFile, "inline text"],
		});
		await loader.reload();

		expect(loader.getSystemPrompt()).toBe("custom system");
		expect(loader.getAppendSystemPrompt()).toEqual(["extra rules", "inline text"]);
		expect(loader.getSystemPromptSource()?.path).toBe(systemFile);
		expect(loader.getAppendSystemPromptSources().map((source) => source.path)).toEqual([appendFile]);
	});

	it("discovers SYSTEM.md and APPEND_SYSTEM.md", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi"), { recursive: true });
		await writeFile(join(projectDir, ".pipi", "SYSTEM.md"), "project system");
		await writeFile(join(agentDir, "SYSTEM.md"), "agent system");
		await writeFile(join(agentDir, "APPEND_SYSTEM.md"), "agent append");

		const loader = new ResourceLoader({ projectDir, agentDir });
		await loader.reload();

		expect(loader.getSystemPrompt()).toBe("project system");
		expect(loader.getAppendSystemPrompt()).toEqual(["agent append"]);
	});

	it("skips project SYSTEM.md when the project is not trusted", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(projectDir, ".pipi"), { recursive: true });
		await writeFile(join(projectDir, ".pipi", "SYSTEM.md"), "project system");
		await writeFile(join(agentDir, "SYSTEM.md"), "agent system");

		const loader = new ResourceLoader({ projectDir, agentDir, projectTrusted: false });
		await loader.reload();

		expect(loader.getSystemPrompt()).toBe("agent system");
	});

	it("applies override hooks", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeSkill(join(agentDir, "skills", "pdf"), "pdf");
		await writeFile(join(agentDir, "AGENTS.md"), "rules");

		const loader = new ResourceLoader({
			projectDir,
			agentDir,
			systemPrompt: "base",
			systemPromptOverride: (base) => `${base} + override`,
			skillsOverride: (base) => ({ ...base, skills: [] }),
			agentsFilesOverride: () => ({ agentsFiles: [] }),
		});
		await loader.reload();

		expect(loader.getSystemPrompt()).toBe("base + override");
		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
	});

	it("adds resources at runtime with source metadata", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const extra = await tempDir();
		await writeSkill(join(extra, "extra"), "extra");
		const promptFile = await writePrompt(extra, "extra-prompt");

		const loader = new ResourceLoader({ projectDir, agentDir });
		await loader.reload();
		expect(loader.getSkills().skills).toEqual([]);

		loader.extendResources({
			skillPaths: [{ path: extra, metadata: { source: "cli", scope: "temporary", origin: "top-level" } }],
			promptPaths: [{ path: promptFile, metadata: { source: "cli", scope: "temporary", origin: "top-level" } }],
		});

		expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(["extra"]);
		expect(loader.getSkills().skills[0].sourceInfo.source).toBe("cli");
		expect(loader.getPrompts().prompts.map((template) => template.name)).toEqual(["extra-prompt"]);
		expect(loader.getPrompts().prompts[0].sourceInfo.source).toBe("cli");
	});

	it("reports missing additional paths as errors", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const loader = new ResourceLoader({
			projectDir,
			agentDir,
			additionalSkillPaths: [join(projectDir, "missing-skill")],
			additionalPromptTemplatePaths: [join(projectDir, "missing-prompt")],
		});
		await loader.reload();

		expect(loader.getSkills().diagnostics[0]).toMatchObject({
			type: "warning",
			message: "skill path does not exist",
		});
		expect(loader.getPrompts().diagnostics[0]).toMatchObject({
			type: "error",
			message: "Prompt template path does not exist",
		});
	});

	it("passes extension paths to the loader seam", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const projectExtension = join(projectDir, ".pipi", "extensions", "demo", "index.ts");
		await mkdir(join(projectDir, ".pipi", "extensions", "demo"), { recursive: true });
		await writeFile(projectExtension, "export default {}");
		const extraExtension = join(projectDir, "extra.ts");
		await writeFile(extraExtension, "export default {}");

		const seen: string[][] = [];
		const loader = new ResourceLoader({
			projectDir,
			agentDir,
			additionalExtensionPaths: [extraExtension],
			loadExtensions: (paths) => {
				seen.push(paths);
				return { extensions: [], errors: [], runtime: {} };
			},
		});
		await loader.reload();

		expect(seen[0]).toEqual([extraExtension, projectExtension]);
	});

	it("picks up changes after reload", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const loader = new ResourceLoader({ projectDir, agentDir });
		await loader.reload();
		expect(loader.getPrompts().prompts).toHaveLength(0);

		await writePrompt(join(agentDir, "prompts"), "new");
		await loader.reload();

		expect(loader.getPrompts().prompts.map((template) => template.name)).toEqual(["new"]);
	});
});
