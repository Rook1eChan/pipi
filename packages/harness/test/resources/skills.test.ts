import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadSkills,
	loadSkillsFromDir,
	validateSkillDescription,
	validateSkillName,
} from "../../src/resources/skills.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-skills-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function skillMarkdown(name: string | null, description: string, extra = ""): string {
	const nameLine = name === null ? "" : `name: ${name}\n`;
	return `---\n${nameLine}description: ${description}\n${extra}---\n\n# Body\n`;
}

async function writeSkill(dir: string, name: string | null, description: string, extra = ""): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), skillMarkdown(name, description, extra));
}

describe("validation", () => {
	it("accepts valid names and rejects malformed ones", () => {
		expect(validateSkillName("pdf-processing")).toEqual([]);
		expect(validateSkillName("Upper")).not.toEqual([]);
		expect(validateSkillName("-lead")).not.toEqual([]);
		expect(validateSkillName("a--b")).not.toEqual([]);
		expect(validateSkillName("a".repeat(65))).not.toEqual([]);
	});

	it("requires a description within the limit", () => {
		expect(validateSkillDescription("ok")).toEqual([]);
		expect(validateSkillDescription("  ")).not.toEqual([]);
		expect(validateSkillDescription("a".repeat(1025))).not.toEqual([]);
	});
});

describe("loadSkillsFromDir", () => {
	it("finds nested skills and skips ignored directories", async () => {
		const root = await tempDir();
		await writeSkill(join(root, "pdf"), "pdf", "Handle PDFs");
		await writeSkill(join(root, "nested", "web"), "web", "Web tasks");
		await writeSkill(join(root, "node_modules", "ignored"), "ignored", "Should not load");
		await writeSkill(join(root, ".hidden", "ignored2"), "ignored2", "Should not load");

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills.map((skill) => skill.name).sort()).toEqual(["pdf", "web"]);
		expect(result.skills.find((skill) => skill.name === "pdf")?.baseDir).toBe(join(root, "pdf"));
	});

	it("loads root-level markdown files as skills", async () => {
		const root = await tempDir();
		await writeFile(join(root, "loose.md"), skillMarkdown("loose", "Root level skill"));

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills.map((skill) => skill.name)).toEqual(["loose"]);
	});

	it("skips root-level markdown without a description", async () => {
		const root = await tempDir();
		await writeFile(join(root, "plain.md"), "# just notes\n");

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills).toEqual([]);
		expect(result.diagnostics).toEqual([]);
	});

	it("keeps skills with invalid names but reports warnings", async () => {
		const root = await tempDir();
		await writeSkill(join(root, "good"), "good", "Valid");
		await writeSkill(join(root, "bad"), "Bad Name", "Invalid name");

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills.map((skill) => skill.name).sort()).toEqual(["Bad Name", "good"]);
		expect(result.diagnostics.some((diagnostic) => diagnostic.type === "warning")).toBe(true);
	});

	it("falls back to the parent directory name", async () => {
		const root = await tempDir();
		await writeSkill(join(root, "pdf"), null, "Uses the directory name");

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills[0].name).toBe("pdf");
	});

	it("respects ignore files", async () => {
		const root = await tempDir();
		await writeSkill(join(root, "keep"), "keep", "Keep me");
		await writeSkill(join(root, "ignored"), "ignored", "Ignore me");
		await writeFile(join(root, ".gitignore"), "ignored/\n");

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills.map((skill) => skill.name)).toEqual(["keep"]);
	});

	it("keeps the disable-model-invocation flag", async () => {
		const root = await tempDir();
		await writeSkill(join(root, "hidden"), "hidden", "Hidden", "disable-model-invocation: true\n");

		const result = loadSkillsFromDir({ dir: root, source: "path" });

		expect(result.skills[0].disableModelInvocation).toBe(true);
	});
});

describe("loadSkills", () => {
	it("lets the first explicit path win name collisions", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const projectSkill = join(projectDir, ".pipi", "skills", "shared");
		const userSkill = join(agentDir, "skills", "shared");
		await writeSkill(projectSkill, "shared", "From project");
		await writeSkill(userSkill, "shared", "From user");

		const result = loadSkills({
			projectDir,
			agentDir,
			skillPaths: [join(projectSkill, "SKILL.md"), join(userSkill, "SKILL.md")],
			includeDefaults: false,
		});

		expect(result.skills).toHaveLength(1);
		expect(result.skills[0].description).toBe("From project");
		expect(result.skills[0].sourceInfo.scope).toBe("project");
		expect(result.diagnostics.some((diagnostic) => diagnostic.type === "collision")).toBe(true);
	});

	it("scans default directories when includeDefaults is true", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await writeSkill(join(agentDir, "skills", "user-skill"), "user-skill", "From user");
		await writeSkill(join(projectDir, ".pipi", "skills", "project-skill"), "project-skill", "From project");

		const result = loadSkills({ projectDir, agentDir, skillPaths: [], includeDefaults: true });

		expect(result.skills.map((skill) => skill.name).sort()).toEqual(["project-skill", "user-skill"]);
	});

	it("loads an explicit SKILL.md path", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const extra = await tempDir();
		await writeSkill(extra, "extra", "Extra skill");

		const result = loadSkills({
			projectDir,
			agentDir,
			skillPaths: [join(extra, "SKILL.md")],
			includeDefaults: false,
		});

		expect(result.skills.map((skill) => skill.name)).toEqual(["extra"]);
	});

	it("warns about missing explicit paths", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();

		const result = loadSkills({
			projectDir,
			agentDir,
			skillPaths: [join(projectDir, "missing")],
			includeDefaults: false,
		});

		expect(result.diagnostics[0]).toMatchObject({ type: "warning", message: "skill path does not exist" });
	});

	it("warns when an explicit path is not markdown", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const file = join(projectDir, "notes.txt");
		await writeFile(file, "body");

		const result = loadSkills({ projectDir, agentDir, skillPaths: [file], includeDefaults: false });

		expect(result.diagnostics[0]).toMatchObject({ type: "warning", message: "skill path is not a markdown file" });
	});
});
