import { describe, expect, it } from "vitest";
import {
	allToolNames,
	createAllTools,
	createCodingTools,
	createReadOnlyTools,
	createTool,
} from "../../src/tools/index.ts";

describe("tool registry", () => {
	it("declares the eight tool names", () => {
		expect([...allToolNames].sort()).toEqual(
			["bash", "edit", "find", "grep", "ls", "powershell", "read", "write"].sort(),
		);
	});

	it("assembles the coding and read-only sets", () => {
		expect(createCodingTools(".").map((tool) => tool.name)).toEqual(["read", "bash", "edit", "write"]);
		expect(createReadOnlyTools(".").map((tool) => tool.name)).toEqual(["read", "grep", "find", "ls"]);
	});

	it("builds every tool by name", () => {
		const tools = createAllTools(".");
		expect(Object.keys(tools)).toHaveLength(8);
		expect(createTool("ls", ".").name).toBe("ls");
	});
});
