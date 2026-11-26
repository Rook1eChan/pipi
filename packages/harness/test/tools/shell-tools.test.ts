import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBashTool } from "../../src/tools/bash.ts";
import { createFindTool } from "../../src/tools/find.ts";
import { createGrepTool } from "../../src/tools/grep.ts";

const dirs: string[] = [];
const tempFiles: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-shell-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	await Promise.all(tempFiles.splice(0).map((path) => rm(path, { force: true })));
});

describe("bash tool", () => {
	it("returns stdout", async () => {
		const dir = await tempDir();
		const result = await createBashTool(dir).execute("call-1", { command: "echo hi" });

		expect((result.content[0] as { text: string }).text).toBe("hi\n");
	});

	it("turns a non-zero exit code into an error result", async () => {
		const dir = await tempDir();

		await expect(createBashTool(dir).execute("call-1", { command: "exit 3" })).rejects.toThrowError(
			/Command exited with code 3/,
		);
	});

	it("injects PI_* environment variables from the runtime context", async () => {
		const dir = await tempDir();
		const tool = createBashTool(dir, {
			getContext: () => ({ model: { provider: "faux", id: "m1" }, sessionId: "s1" }),
		});

		const result = await tool.execute("call-1", { command: "echo $PIPI_PROVIDER-$PIPI_MODEL-$PIPI_SESSION_ID" });

		expect((result.content[0] as { text: string }).text).toBe("faux-m1-s1\n");
	});

	it("spills oversized output to a temp file and shows the tail", async () => {
		const dir = await tempDir();
		const result = await createBashTool(dir).execute("call-1", {
			command: "head -c 60000 /dev/zero | tr '\\0' x",
		});

		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("[Showing last");
		if (result.details?.fullOutputPath) {
			tempFiles.push(result.details.fullOutputPath);
			expect((await readFile(result.details.fullOutputPath, "utf-8")).length).toBe(60000);
		}
	});

	it("aborts a running command", async () => {
		const dir = await tempDir();
		const controller = new AbortController();
		const promise = createBashTool(dir).execute("call-1", { command: "sleep 5" }, controller.signal);
		setTimeout(() => controller.abort(), 100);

		await expect(promise).rejects.toThrowError(/aborted/);
	});
});

describe("grep tool", () => {
	it("finds matches with file and line", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "a.ts"), "const needle = 1;\n");
		await writeFile(join(dir, "b.md"), "nothing here\n");
		const result = await createGrepTool(dir).execute("call-1", { pattern: "needle" });

		const text = (result.content[0] as { text: string }).text;
		expect(text).toBe("a.ts:1: const needle = 1;");
	});

	it("reports no matches", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "a.ts"), "abc\n");
		const result = await createGrepTool(dir).execute("call-1", { pattern: "zzz" });

		expect((result.content[0] as { text: string }).text).toBe("No matches found");
	});
});

describe("find tool", () => {
	it("finds files by glob", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "a.ts"), "");
		await writeFile(join(dir, "b.md"), "");
		const result = await createFindTool(dir).execute("call-1", { pattern: "*.ts" });

		expect((result.content[0] as { text: string }).text).toBe("a.ts");
	});

	it("reports a missing search path", async () => {
		const dir = await tempDir();

		await expect(
			createFindTool(dir).execute("call-1", { pattern: "*", path: join(dir, "missing") }),
		).rejects.toThrowError(/Path not found/);
	});
});
