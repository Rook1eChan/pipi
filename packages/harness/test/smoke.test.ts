import * as pkg from "@pipi/harness";
import { describe, expect, it } from "vitest";

describe("@pipi/harness", () => {
	it("loads the package entry", () => {
		expect(pkg).toBeDefined();
	});
});
