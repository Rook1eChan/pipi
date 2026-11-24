import { describe, expect, it } from "vitest";
import {
	applyEditsToNormalizedContent,
	detectLineEnding,
	generateDiffString,
	generateUnifiedPatch,
	normalizeToLF,
	restoreLineEndings,
	splitBom,
} from "../../../src/tools/support/edit-diff.ts";

describe("line helpers", () => {
	it("splits and restores BOM", () => {
		const { bom, text } = splitBom("\uFEFFconst a = 1;");
		expect(bom).toBe("\uFEFF");
		expect(text).toBe("const a = 1;");
	});

	it("detects and restores CRLF", () => {
		const content = "a\r\nb\r\n";
		expect(detectLineEnding(content)).toBe("\r\n");
		expect(restoreLineEndings(normalizeToLF(content), "\r\n")).toBe(content);
	});
});

describe("applyEditsToNormalizedContent", () => {
	it("replaces a unique block", () => {
		const result = applyEditsToNormalizedContent(
			"const a = 1;\nconst b = 2;",
			[{ oldText: "const a = 1;", newText: "const a = 3;" }],
			"a.ts",
		);

		expect(result.newContent).toBe("const a = 3;\nconst b = 2;");
	});

	it("rejects an ambiguous match", () => {
		expect(() => applyEditsToNormalizedContent("x\nx", [{ oldText: "x", newText: "y" }], "a.ts")).toThrowError(
			/2 occurrences/,
		);
	});

	it("tolerates trailing whitespace differences", () => {
		const result = applyEditsToNormalizedContent(
			"function a() {   \n\treturn 1;\n}",
			[{ oldText: "function a() {\n\treturn 1;\n}", newText: "function a() {\n\treturn 2;\n}" }],
			"a.ts",
		);

		expect(result.newContent).toContain("return 2;");
	});

	it("reports a missing match", () => {
		expect(() => applyEditsToNormalizedContent("abc", [{ oldText: "zzz", newText: "y" }], "a.ts")).toThrowError(
			/Could not find oldText/,
		);
	});
});

describe("diff output", () => {
	it("reports changed lines and a unified patch", () => {
		const before = "a\nb\nc";
		const after = "a\nB\nc";

		const diff = generateDiffString(before, after);
		expect(diff.firstChangedLine).toBe(2);
		expect(diff.diff).toContain("-     2 b");
		expect(diff.diff).toContain("+     2 B");

		const patch = generateUnifiedPatch("a.ts", before, after);
		expect(patch).toContain("--- a/a.ts");
		expect(patch).toContain("+++ b/a.ts");
		expect(patch).toContain("@@ -1,3 +1,3 @@");
	});
});
