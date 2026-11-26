import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContextFileFromDir, loadProjectContextFiles } from "../../src/resources/context-files.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-context-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadContextFileFromDir", () => {
	it("prefers the override file", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "AGENTS.md"), "base");
		await writeFile(join(dir, "AGENTS.override.md"), "override");

		expect(loadContextFileFromDir(dir)).toEqual({ path: join(dir, "AGENTS.override.md"), content: "override" });
	});

	it("falls through to CLAUDE.md and strips the BOM", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "CLAUDE.md"), "\uFEFFrules");

		expect(loadContextFileFromDir(dir)).toEqual({ path: join(dir, "CLAUDE.md"), content: "rules" });
	});

	it("skips a directory named like a context file", async () => {
		const dir = await tempDir();
		await mkdir(join(dir, "AGENTS.md"));
		await writeFile(join(dir, "CLAUDE.md"), "fallback");

		expect(loadContextFileFromDir(dir)?.content).toBe("fallback");
	});

	it("returns null when nothing matches", async () => {
		const dir = await tempDir();
		expect(loadContextFileFromDir(dir)).toBeNull();
	});
});

describe("loadProjectContextFiles", () => {
	it("orders ancestors from far to near", async () => {
		const root = await tempDir();
		const inner = join(root, "a", "b");
		await mkdir(inner, { recursive: true });
		await writeFile(join(root, "a", "AGENTS.md"), "outer");
		await writeFile(join(inner, "AGENTS.md"), "inner");

		const files = loadProjectContextFiles({ projectDir: inner, agentDir: join(root, "no-agent") });

		expect(files.map((file) => file.content)).toEqual(["outer", "inner"]);
	});

	it("puts the global file first and dedupes the same path", async () => {
		const root = await tempDir();
		await writeFile(join(root, "AGENTS.md"), "global");

		const files = loadProjectContextFiles({ projectDir: root, agentDir: root });

		expect(files).toHaveLength(1);
		expect(files[0].content).toBe("global");
	});

	it("returns an empty list when there are no files", async () => {
		const root = await tempDir();
		const files = loadProjectContextFiles({ projectDir: join(root, "x"), agentDir: join(root, "y") });

		expect(files).toEqual([]);
	});
});
