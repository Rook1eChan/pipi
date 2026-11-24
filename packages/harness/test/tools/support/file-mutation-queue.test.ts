import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withFileMutationQueue } from "../../../src/tools/support/file-mutation-queue.ts";

describe("withFileMutationQueue", () => {
	it("serializes operations on the same file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pipi-queue-"));
		const path = join(dir, "file.txt");
		await writeFile(path, "");
		const order: string[] = [];

		try {
			await Promise.all([
				withFileMutationQueue(path, async () => {
					order.push("first-start");
					await new Promise((resolve) => setTimeout(resolve, 20));
					order.push("first-end");
				}),
				withFileMutationQueue(path, async () => {
					order.push("second-start");
					order.push("second-end");
				}),
			]);

			expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("runs operations on different files in parallel", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pipi-queue-"));
		const first = join(dir, "a.txt");
		const second = join(dir, "b.txt");
		await writeFile(first, "");
		await writeFile(second, "");
		let running = 0;
		let maxRunning = 0;

		const track = async () => {
			running++;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((resolve) => setTimeout(resolve, 20));
			running--;
		};

		try {
			await Promise.all([withFileMutationQueue(first, track), withFileMutationQueue(second, track)]);
			expect(maxRunning).toBe(2);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
