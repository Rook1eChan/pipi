import { describe, expect, it } from "vitest";
import { formatSize, truncateKeepHead, truncateKeepTail, truncateLine } from "../../../src/tools/support/truncate.ts";

const lines = (count: number, prefix = "line"): string =>
	Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join("\n");

describe("truncateKeepHead", () => {
	it("returns the content unchanged when within both limits", () => {
		const content = "a\nb\nc";
		const result = truncateKeepHead(content);

		expect(result.content).toBe(content);
		expect(result.truncated).toBe(false);
		expect(result.truncatedBy).toBeNull();
		expect(result.totalLines).toBe(3);
		expect(result.outputLines).toBe(3);
	});

	it("keeps the first lines when the line limit is hit", () => {
		const result = truncateKeepHead(lines(10), { maxLines: 3 });

		expect(result.content).toBe("line1\nline2\nline3");
		expect(result.truncated).toBe(true);
		expect(result.truncatedBy).toBe("lines");
		expect(result.totalLines).toBe(10);
		expect(result.outputLines).toBe(3);
	});

	it("keeps only the lines that fit in the byte limit", () => {
		const result = truncateKeepHead("aaaa\nbbbb\ncccc", { maxBytes: 9 });

		expect(result.content).toBe("aaaa\nbbbb");
		expect(result.truncatedBy).toBe("bytes");
		expect(result.outputLines).toBe(2);
	});

	it("reports a first line that exceeds the byte limit", () => {
		const result = truncateKeepHead("x".repeat(50), { maxBytes: 10 });

		expect(result.content).toBe("");
		expect(result.firstLineExceedsLimit).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
		expect(result.outputLines).toBe(0);
	});

	it("does not count a trailing newline as an extra line", () => {
		expect(truncateKeepHead("a\nb\n").totalLines).toBe(2);
	});
});

describe("truncateKeepTail", () => {
	it("keeps the last lines when the line limit is hit", () => {
		const result = truncateKeepTail(lines(10), { maxLines: 3 });

		expect(result.content).toBe("line8\nline9\nline10");
		expect(result.truncatedBy).toBe("lines");
		expect(result.totalLines).toBe(10);
	});

	it("keeps only the trailing bytes that fit", () => {
		const result = truncateKeepTail("aaaa\nbbbb\ncccc", { maxBytes: 9 });

		expect(result.content).toBe("bbbb\ncccc");
		expect(result.truncatedBy).toBe("bytes");
	});

	it("keeps the end of a single oversized line", () => {
		const result = truncateKeepTail("x".repeat(100), { maxBytes: 10 });

		expect(result.content).toBe("x".repeat(10));
		expect(result.lastLinePartial).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
	});

	it("reports byte truncation when the kept line is partial", () => {
		// 单行超字节且 maxLines=1：截断由字节上限触发，标签不能写成 lines
		const result = truncateKeepTail("x".repeat(100), { maxLines: 1, maxBytes: 10 });

		expect(result.lastLinePartial).toBe(true);
		expect(result.truncatedBy).toBe("bytes");
	});

	it("cuts on a UTF-8 boundary", () => {
		const result = truncateKeepTail("中文内容", { maxBytes: 3 });

		expect(result.lastLinePartial).toBe(true);
		expect(result.content).toBe("容");
		expect(result.content).not.toContain("\uFFFD");
	});
});

describe("truncateLine", () => {
	it("keeps short lines untouched", () => {
		expect(truncateLine("short")).toEqual({ text: "short", wasTruncated: false });
	});

	it("adds a truncation suffix to long lines", () => {
		const result = truncateLine("abcdef", 3);

		expect(result.text).toBe("abc... [truncated]");
		expect(result.wasTruncated).toBe(true);
	});
});

describe("formatSize", () => {
	it("formats bytes, kilobytes and megabytes", () => {
		expect(formatSize(512)).toBe("512B");
		expect(formatSize(1536)).toBe("1.5KB");
		expect(formatSize(2 * 1024 * 1024)).toBe("2.0MB");
	});
});
