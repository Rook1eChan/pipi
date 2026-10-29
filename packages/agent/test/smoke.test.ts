import * as pkg from "@pipi/agent";
import { describe, expect, it } from "vitest";

describe("@pipi/agent", () => {
	it("loads the package entry", () => {
		expect(pkg).toBeDefined();
	});
});
