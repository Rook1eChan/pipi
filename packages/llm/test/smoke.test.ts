import * as pkg from "@pipi/llm";
import { describe, expect, it } from "vitest";

describe("@pipi/llm", () => {
	it("loads the package entry", () => {
		expect(pkg).toBeDefined();
	});
});
