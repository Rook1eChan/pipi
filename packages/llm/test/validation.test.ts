import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { Tool, ToolCall } from "../src/types.ts";
import { validateToolArguments, validateToolCall } from "../src/utils/validation.ts";

function createTool(parameters: Tool["parameters"]): Tool {
	return { name: "echo", description: "Echo tool", parameters };
}

function createToolCall(name: string, args: Record<string, unknown>): ToolCall {
	return { type: "toolCall", id: "call-1", name, arguments: args };
}

describe("validateToolArguments", () => {
	it("coerces values to the declared types", () => {
		const tool = createTool(
			Type.Object({
				count: Type.Number(),
				enabled: Type.Boolean(),
				tags: Type.Array(Type.String()),
			}),
		);
		const args = { count: "42", enabled: "true", tags: "solo" };

		expect(validateToolArguments(tool, createToolCall("echo", args))).toEqual({
			count: 42,
			enabled: true,
			tags: ["solo"],
		});
	});

	it("treats null on optional properties as omitted", () => {
		const tool = createTool(
			Type.Object({
				path: Type.String(),
				offset: Type.Optional(Type.Number()),
				metadata: Type.Object({ enabled: Type.Optional(Type.Boolean()) }),
			}),
		);

		expect(
			validateToolArguments(
				tool,
				createToolCall("echo", { path: "a.ts", offset: null, metadata: { enabled: null } }),
			),
		).toEqual({ path: "a.ts", metadata: {} });
	});

	it("keeps null for optional properties that accept null", () => {
		const tool = createTool(
			Type.Object({
				value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			}),
		);

		expect(validateToolArguments(tool, createToolCall("echo", { value: null }))).toEqual({ value: null });
	});

	it("leaves the original arguments untouched", () => {
		const tool = createTool(Type.Object({ offset: Type.Optional(Type.Number()) }));
		const toolCall = createToolCall("echo", { offset: null });

		const result = validateToolArguments(tool, toolCall);

		expect(result).not.toBe(toolCall.arguments);
		expect(toolCall.arguments).toEqual({ offset: null });
	});

	it("passes valid arguments through unchanged", () => {
		const tool = createTool(Type.Object({ path: Type.String(), line: Type.Number() }));

		expect(validateToolArguments(tool, createToolCall("echo", { path: "a.ts", line: 3 }))).toEqual({
			path: "a.ts",
			line: 3,
		});
	});

	it("reports the missing property and the received arguments", () => {
		const tool = createTool(Type.Object({ path: Type.String(), line: Type.Number() }));

		expect(() => validateToolArguments(tool, createToolCall("echo", { path: "a.ts" }))).toThrowError(
			/Validation failed for tool "echo":\n {2}- line: /,
		);
		expect(() => validateToolArguments(tool, createToolCall("echo", { path: "a.ts" }))).toThrowError(
			/Received arguments:\n\{\n {2}"path": "a\.ts"\n\}/,
		);
	});

	it("reports nested paths with dots", () => {
		const tool = createTool(
			Type.Object({
				path: Type.String(),
				options: Type.Object({ deep: Type.Boolean() }),
			}),
		);

		expect(() => validateToolArguments(tool, createToolCall("echo", { path: "a.ts", options: {} }))).toThrowError(
			/- options\.deep: /,
		);
	});

	it("rejects values that cannot be coerced", () => {
		const tool = createTool(Type.Object({ line: Type.Number() }));

		expect(() => validateToolArguments(tool, createToolCall("echo", { line: "ten" }))).toThrowError(
			/Validation failed for tool "echo":/,
		);
	});
});

describe("validateToolCall", () => {
	it("validates arguments against the tool with the matching name", () => {
		const tools = [
			createTool(Type.Object({ line: Type.Number() })),
			{ ...createTool(Type.Object({ path: Type.String() })), name: "read" },
		];

		expect(validateToolCall(tools, createToolCall("read", { path: "a.ts" }))).toEqual({ path: "a.ts" });
	});

	it("throws when no tool matches the name", () => {
		expect(() => validateToolCall([], createToolCall("missing", {}))).toThrowError('Tool "missing" not found');
	});
});

describe("validator cache", () => {
	it("reuses one compiled validator across calls", () => {
		const tool = createTool(Type.Object({ line: Type.Number() }));

		expect(validateToolArguments(tool, createToolCall("echo", { line: "1" }))).toEqual({ line: 1 });
		expect(validateToolArguments(tool, createToolCall("echo", { line: 2 }))).toEqual({ line: 2 });
		expect(() => validateToolArguments(tool, createToolCall("echo", { line: "x" }))).toThrowError(
			/Validation failed for tool "echo":/,
		);
	});
});
