import * as pkg from "@pipi/tui";
import { describe, expect, it } from "vitest";

describe("@pipi/tui", () => {
	it("loads the package entry", () => {
		expect(pkg).toBeDefined();
	});
});
