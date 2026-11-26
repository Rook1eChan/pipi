import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReadTool, createReadToolDefinition } from "../../src/tools/read.ts";
import { loadPhoton } from "../../src/utils/images/photon.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pipi-read-"));
	dirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeTempFile(content: string | Buffer, name = "file.txt"): Promise<{ dir: string; path: string }> {
	const dir = await tempDir();
	const path = join(dir, name);
	await writeFile(path, content);
	return { dir, path };
}

describe("read tool definition", () => {
	it("exposes the prompt snippet and guidelines", () => {
		const definition = createReadToolDefinition(process.cwd());

		expect(definition.promptSnippet).toBe("Read file contents");
		expect(definition.promptGuidelines).toEqual(["Use read to examine files instead of cat or sed."]);
	});
});

describe("read tool", () => {
	it("reads a text file", async () => {
		const { dir, path } = await writeTempFile("line1\nline2\nline3");
		const tool = createReadTool(dir);

		const result = await tool.execute("call-1", { path });

		expect(result.content).toEqual([{ type: "text", text: "line1\nline2\nline3" }]);
	});

	it("applies offset and limit with a continuation hint", async () => {
		const { dir, path } = await writeTempFile("a\nb\nc\nd\ne");
		const tool = createReadTool(dir);

		const result = await tool.execute("call-1", { path, offset: 2, limit: 2 });

		expect(result.content[0]).toMatchObject({ text: "b\nc\n\n[2 more lines in file. Use offset=4 to continue.]" });
	});

	it("truncates long files and tells where to continue", async () => {
		const { dir, path } = await writeTempFile(
			Array.from({ length: 2100 }, (_, index) => `line${index + 1}`).join("\n"),
		);
		const tool = createReadTool(dir);

		const result = await tool.execute("call-1", { path });
		const text = (result.content[0] as { text: string }).text;

		expect(text.startsWith("line1\nline2\n")).toBe(true);
		expect(text).toContain("[Showing lines 1-2000 of 2100. Use offset=2001 to continue.]");
	});

	it("suggests sed when the first line exceeds the byte limit", async () => {
		const { dir, path } = await writeTempFile("x".repeat(60 * 1024));
		const tool = createReadTool(dir);

		const result = await tool.execute("call-1", { path });
		const text = (result.content[0] as { text: string }).text;

		expect(text).toContain("exceeds 50.0KB limit");
		expect(text).toContain("sed -n '1p'");
	});

	it("reports an offset beyond the end of the file", async () => {
		const { dir, path } = await writeTempFile("only");
		const tool = createReadTool(dir);

		await expect(tool.execute("call-1", { path, offset: 5 })).rejects.toThrow(/beyond end of file/);
	});

	it("fails when the file is missing", async () => {
		const dir = await tempDir();
		const tool = createReadTool(dir);

		await expect(tool.execute("call-1", { path: join(dir, "missing.txt") })).rejects.toThrow();
	});

	it("returns an image block for a png file", async () => {
		const photon = loadPhoton();
		if (!photon) throw new Error("photon is required for this test");
		const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
		const png = new photon.PhotonImage(pixels, 2, 2).get_bytes();
		const { dir, path } = await writeTempFile(Buffer.from(png), "image.png");
		const tool = createReadTool(dir);

		const result = await tool.execute("call-1", { path });

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("Read image file [image/png]"),
		});
		expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
	});

	it("notes that the current model cannot see images", async () => {
		const photon = loadPhoton();
		if (!photon) throw new Error("photon is required for this test");
		const pixels = new Uint8Array([255, 0, 0, 255]);
		const png = new photon.PhotonImage(pixels, 1, 1).get_bytes();
		const { dir, path } = await writeTempFile(Buffer.from(png), "image.png");
		const tool = createReadTool(dir, { modelSupportsImages: false });

		const result = await tool.execute("call-1", { path });
		const text = (result.content[0] as { text: string }).text;

		expect(text).toContain("[Current model does not support images.");
	});
});
