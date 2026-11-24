import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { OutputAccumulator, type OutputAccumulatorOptions } from "../../../src/tools/support/output-accumulator.ts";

const tempPaths: string[] = [];

async function cleanup(): Promise<void> {
	await Promise.all(tempPaths.splice(0).map((path) => rm(path, { force: true })));
}

function createAccumulator(options: OutputAccumulatorOptions = {}) {
	return new OutputAccumulator(options);
}

describe("OutputAccumulator", () => {
	it("returns the whole output when it fits", async () => {
		const accumulator = createAccumulator();
		accumulator.append(Buffer.from("a\nb\n"));
		accumulator.finish();

		const snapshot = accumulator.snapshot();
		expect(snapshot.content).toBe("a\nb\n");
		expect(snapshot.truncation.truncated).toBe(false);
		expect(snapshot.truncation.totalLines).toBe(2);
		expect(snapshot.fullOutputPath).toBeUndefined();
		await cleanup();
	});

	it("keeps the last lines when the line limit is hit", async () => {
		const accumulator = createAccumulator({ maxLines: 3 });
		const text = Array.from({ length: 10 }, (_, index) => `line${index + 1}`).join("\n");
		accumulator.append(Buffer.from(text));
		accumulator.finish();

		const snapshot = accumulator.snapshot({ persistIfTruncated: true });
		if (snapshot.fullOutputPath) tempPaths.push(snapshot.fullOutputPath);

		expect(snapshot.content).toBe("line8\nline9\nline10");
		expect(snapshot.truncation.truncated).toBe(true);
		expect(snapshot.truncation.truncatedBy).toBe("lines");
		expect(snapshot.truncation.totalLines).toBe(10);
		expect(snapshot.fullOutputPath).toBeDefined();

		await accumulator.closeTempFile();
		expect(await readFile(snapshot.fullOutputPath as string, "utf-8")).toBe(text);
		await cleanup();
	});

	it("reports byte truncation and keeps the tail", async () => {
		const accumulator = createAccumulator({ maxBytes: 8 });
		accumulator.append(Buffer.from("aaaa\nbbbb\ncccc"));
		accumulator.finish();

		const snapshot = accumulator.snapshot();
		expect(snapshot.content).toBe("cccc");
		expect(snapshot.truncation.truncatedBy).toBe("bytes");
		expect(snapshot.truncation.totalBytes).toBe(14);
		await cleanup();
	});

	it("decodes a character split across chunks", async () => {
		const accumulator = createAccumulator();
		const bytes = Buffer.from("中文", "utf-8");
		// “中”占 3 字节，从中间切开
		accumulator.append(bytes.subarray(0, 2));
		accumulator.append(bytes.subarray(2));
		accumulator.finish();

		expect(accumulator.snapshot().content).toBe("中文");
		await cleanup();
	});

	it("rejects appends after finish", async () => {
		const accumulator = createAccumulator();
		accumulator.finish();

		expect(() => accumulator.append(Buffer.from("x"))).toThrowError(/finished/);
		await cleanup();
	});

	it("tracks the size of the open last line", async () => {
		const accumulator = createAccumulator();
		accumulator.append(Buffer.from("abc\ndefgh"));
		accumulator.finish();

		expect(accumulator.getLastLineBytes()).toBe(5);
		await cleanup();
	});
});
