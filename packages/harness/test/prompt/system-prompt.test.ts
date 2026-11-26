import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/prompt/system-prompt.ts";
import { formatSkillsForPrompt, type Skill } from "../../src/resources/skills.ts";

const baseOptions = {
	cwd: "/work/project",
	selectedTools: ["read", "bash", "edit", "write"],
	toolSnippets: {
		read: "Read file contents",
		bash: "Execute bash commands",
		edit: "Edit files",
		write: "Write files",
	},
};

function skill(name: string, description: string, disableModelInvocation = false): Skill {
	return {
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { path: `/skills/${name}/SKILL.md`, source: "local", scope: "agent", origin: "top-level" },
		disableModelInvocation,
	};
}

describe("buildSystemPrompt", () => {
	it("lists tools that have snippets and always-ending cwd", () => {
		const prompt = buildSystemPrompt(baseOptions);

		expect(prompt).toContain("You are an expert coding assistant");
		expect(prompt).toContain("- read: Read file contents");
		expect(prompt).toContain("- bash: Execute bash commands");
		expect(prompt).toContain("- Be concise in your responses");
		expect(prompt.endsWith("Current working directory: /work/project")).toBe(true);
	});

	it("omits tools without a snippet", () => {
		const prompt = buildSystemPrompt({
			...baseOptions,
			selectedTools: ["read", "grep"],
			toolSnippets: { read: "Read file contents" },
		});

		expect(prompt).toContain("- read: Read file contents");
		expect(prompt).not.toContain("- grep:");
	});

	it("adds a shell guideline when no dedicated search tool is available", () => {
		const prompt = buildSystemPrompt({ ...baseOptions, selectedTools: ["read", "bash"] });

		expect(prompt).toContain("Use bash for file operations like ls, rg, find");
	});

	it("skips the shell guideline when grep is available", () => {
		const prompt = buildSystemPrompt({
			...baseOptions,
			selectedTools: ["read", "bash", "grep"],
			toolSnippets: { ...baseOptions.toolSnippets, grep: "Search file contents" },
		});

		expect(prompt).not.toContain("Use bash for file operations");
	});

	it("omits the pipi documentation section for now", () => {
		const prompt = buildSystemPrompt(baseOptions);

		expect(prompt).not.toContain("pipi documentation");
	});

	it("uses the custom prompt but keeps context, skills and cwd", () => {
		const prompt = buildSystemPrompt({
			...baseOptions,
			customPrompt: "custom instructions",
			contextFiles: [{ path: "/work/project/AGENTS.md", content: "- rule" }],
			skills: [skill("pdf", "Handle PDFs")],
		});

		expect(prompt.startsWith("custom instructions")).toBe(true);
		expect(prompt).not.toContain("Available tools:");
		expect(prompt).toContain('<project_instructions path="/work/project/AGENTS.md">');
		expect(prompt).toContain("<name>pdf</name>");
	});
});

describe("context and append sections", () => {
	it("appends the extra prompt before project context", () => {
		const prompt = buildSystemPrompt({
			...baseOptions,
			appendSystemPrompt: "- extra rule",
			contextFiles: [{ path: "AGENTS.md", content: "project rule" }],
		});

		expect(prompt.indexOf("- extra rule")).toBeLessThan(prompt.indexOf("<project_context>"));
		expect(prompt).toContain("Project-specific instructions and guidelines:");
	});

	it("skips the context section when there are no files", () => {
		expect(buildSystemPrompt(baseOptions)).not.toContain("<project_context>");
	});
});

describe("formatSkillsForPrompt", () => {
	it("lists visible skills with location and escapes xml", () => {
		const text = formatSkillsForPrompt([skill("a&b", "<desc>")]);

		expect(text).toContain("<name>a&amp;b</name>");
		expect(text).toContain("<description>&lt;desc&gt;</description>");
		expect(text).toContain("<location>/skills/a&amp;b/SKILL.md</location>");
	});

	it("hides skills that disable model invocation", () => {
		const text = formatSkillsForPrompt([skill("pdf", "Handle PDFs"), skill("hidden", "Hidden skill", true)]);

		expect(text).toContain("<name>pdf</name>");
		expect(text).not.toContain("hidden");
	});

	it("returns an empty string when nothing is visible", () => {
		expect(formatSkillsForPrompt([skill("hidden", "Hidden skill", true)])).toBe("");
	});

	it("tells bash users to read with bash", () => {
		const prompt = buildSystemPrompt({
			...baseOptions,
			selectedTools: ["bash"],
			skills: [skill("pdf", "Handle PDFs")],
		});

		expect(prompt).toContain("Use bash to load a skill's file");
	});
});
