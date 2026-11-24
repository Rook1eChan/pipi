import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEditTool, createEditToolDefinition } from "../../src/tools/edit.ts";
import { createLsTool } from "../../src/tools/ls.ts";
import { createReadTool } from "../../src/tools/read.ts";
import { createWriteTool } from "../../src/tools/write.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-tools-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("write tool", () => {
	it("creates parent directories and writes content", async () => {
		const dir = await tempDir();
		const tool = createWriteTool(dir);

		const result = await tool.execute("call-1", { path: "nested/file.txt", content: "hello" });

		expect(await readFile(join(dir, "nested/file.txt"), "utf-8")).toBe("hello");
		expect((result.content[0] as { text: string }).text).toContain("Successfully wrote");
	});
});

describe("edit tool", () => {
	it("replaces a unique block and reports a diff", async () => {
		const dir = await tempDir();
		const path = join(dir, "a.ts");
		await writeFile(path, "const a = 1;\nconst b = 2;\n");
		const tool = createEditTool(dir);

		const result = await tool.execute("call-1", {
			path,
			edits: [{ oldText: "const a = 1;", newText: "const a = 3;" }],
		});

		expect(await readFile(path, "utf-8")).toBe("const a = 3;\nconst b = 2;\n");
		expect(result.details?.diff).toContain("+");
		expect(result.details?.patch).toContain("--- a/");
	});

	it("preserves CRLF line endings and BOM", async () => {
		const dir = await tempDir();
		const path = join(dir, "a.txt");
		await writeFile(path, "\uFEFFa\r\nb\r\n");
		const tool = createEditTool(dir);

		await tool.execute("call-1", { path, edits: [{ oldText: "b", newText: "c" }] });

		expect(await readFile(path, "utf-8")).toBe("\uFEFFa\r\nc\r\n");
	});

	it("accepts the legacy oldText/newText shape through prepareArguments", async () => {
		const dir = await tempDir();
		const path = join(dir, "a.txt");
		await writeFile(path, "old\n");
		const definition = createEditToolDefinition(dir);
		const prepared = definition.prepareArguments?.({ path, oldText: "old", newText: "new" });

		expect(prepared).toMatchObject({ path, edits: [{ oldText: "old", newText: "new" }] });
		await definition.execute("call-1", prepared as { path: string; edits: { oldText: string; newText: string }[] });

		expect(await readFile(path, "utf-8")).toBe("new\n");
	});
});

describe("ls tool", () => {
	it("lists entries with a directory slash", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "b.txt"), "");
		await createWriteTool(dir).execute("call-1", { path: "a-dir/x.txt", content: "" });
		const tool = createLsTool(dir);

		const result = await tool.execute("call-1", { path: dir });
		const text = (result.content[0] as { text: string }).text;

		expect(text).toBe("a-dir/\nb.txt");
	});

	it("rejects a file path", async () => {
		const dir = await tempDir();
		const path = join(dir, "a.txt");
		await writeFile(path, "");
		const tool = createLsTool(dir);

		await expect(tool.execute("call-1", { path })).rejects.toThrowError(/Not a directory/);
	});
});

describe("read after write", () => {
	it("reads back what write stored", async () => {
		const dir = await tempDir();
		await createWriteTool(dir).execute("call-1", { path: "a.txt", content: "alpha\nbeta" });

		const result = await createReadTool(dir).execute("call-1", { path: "a.txt" });

		expect((result.content[0] as { text: string }).text).toBe("alpha\nbeta");
	});
});
