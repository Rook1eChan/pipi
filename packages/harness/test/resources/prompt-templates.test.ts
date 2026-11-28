import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	expandPromptTemplate,
	loadPromptTemplates,
	type PromptTemplate,
	parseCommandArgs,
	substituteArgs,
} from "../../src/resources/prompt-templates.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-prompts-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseCommandArgs", () => {
	it("splits on whitespace and keeps quoted text", () => {
		expect(parseCommandArgs('src/a.ts "错误 处理"')).toEqual(["src/a.ts", "错误 处理"]);
		expect(parseCommandArgs("  ")).toEqual([]);
	});
});

describe("substituteArgs", () => {
	it("replaces positional and all-args placeholders", () => {
		expect(substituteArgs("$1 and $2 / $@ / $ARGUMENTS", ["a", "b"])).toBe("a and b / a b / a b");
	});

	it("supports defaults and slices", () => {
		// 占位符按字面量传入，拆开拼接避免 lint 把它当成模板字符串
		const withDefault = "$" + "{2:-fallback}";
		const withSlice = "$" + "{@:2:2}";
		expect(substituteArgs(withDefault, ["only"])).toBe("fallback");
		expect(substituteArgs(withSlice, ["a", "b", "c", "d"])).toBe("b c");
		expect(substituteArgs("$3", ["a"])).toBe("");
	});
});

describe("loadPromptTemplates", () => {
	it("loads agent and project templates with source info", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(agentDir, "prompts"), { recursive: true });
		await writeFile(
			join(agentDir, "prompts", "review.md"),
			"---\ndescription: 审查\nargument-hint: <file>\n---\n审查 $1",
		);
		await mkdir(join(projectDir, ".pipi", "prompts"), { recursive: true });
		await writeFile(join(projectDir, ".pipi", "prompts", "note.md"), "随手记一条\n第二行");

		const prompts = loadPromptTemplates({ projectDir, agentDir, promptPaths: [], includeDefaults: true });
		const review = prompts.find((template) => template.name === "review");
		const note = prompts.find((template) => template.name === "note");

		expect(review).toMatchObject({ description: "审查", argumentHint: "<file>", content: "审查 $1" });
		expect(review?.sourceInfo.scope).toBe("agent");
		expect(note?.description).toBe("随手记一条");
		expect(note?.sourceInfo.scope).toBe("project");
	});

	it("omits an empty argument hint", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		await mkdir(join(agentDir, "prompts"), { recursive: true });
		await writeFile(join(agentDir, "prompts", "a.md"), "---\nargument-hint:\n---\nbody");

		const prompts = loadPromptTemplates({ projectDir, agentDir, promptPaths: [], includeDefaults: true });

		expect(prompts[0].argumentHint).toBeUndefined();
	});

	it("silently skips missing explicit paths", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();

		const prompts = loadPromptTemplates({
			projectDir,
			agentDir,
			promptPaths: [join(projectDir, "missing")],
			includeDefaults: false,
		});

		expect(prompts).toEqual([]);
	});

	it("loads explicit files and directories in order", async () => {
		const agentDir = await tempDir();
		const projectDir = await tempDir();
		const extra = await tempDir();
		await writeFile(join(extra, "one.md"), "first");
		await writeFile(join(extra, "two.md"), "second");

		const prompts = loadPromptTemplates({
			projectDir,
			agentDir,
			promptPaths: [extra],
			includeDefaults: false,
		});

		expect(prompts.map((template) => template.name).sort()).toEqual(["one", "two"]);
		expect(prompts[0].sourceInfo.scope).toBe("temporary");
	});
});

describe("expandPromptTemplate", () => {
	const templates: PromptTemplate[] = [
		{
			name: "review",
			description: "",
			content: "审查 $1",
			filePath: "/t/review.md",
			sourceInfo: { path: "/t/review.md", source: "local", scope: "temporary", origin: "top-level" },
		},
	];

	it("expands a matching command", () => {
		expect(expandPromptTemplate("/review src/a.ts", templates)).toBe("审查 src/a.ts");
	});

	it("leaves unknown or plain text alone", () => {
		expect(expandPromptTemplate("/unknown x", templates)).toBe("/unknown x");
		expect(expandPromptTemplate("plain", templates)).toBe("plain");
	});
});
