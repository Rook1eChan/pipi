import * as pkg from "@pipi/eval";
import { describe, expect, it } from "vitest";

describe("@pipi/eval", () => {
	it("loads the package entry", () => {
		expect(pkg).toBeDefined();
	});
});
