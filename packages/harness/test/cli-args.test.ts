import { describe, expect, it } from "vitest";
import { normalizeSessionName, parseArgs } from "../src/cli/args.ts";

describe("parseArgs", () => {
	it("parses model, provider, thinking and prompt options", () => {
		const args = parseArgs([
			"--provider",
			"deepseek",
			"--model",
			"deepseek-v4-flash",
			"--thinking",
			"high",
			"--system-prompt",
			"custom",
			"--append-system-prompt",
			"one",
			"--append-system-prompt",
			"two",
			"hello",
		]);

		expect(args).toMatchObject({
			provider: "deepseek",
			model: "deepseek-v4-flash",
			thinking: "high",
			systemPrompt: "custom",
			appendSystemPrompt: ["one", "two"],
			messages: ["hello"],
		});
	});

	it("accumulates repeatable resource paths", () => {
		const args = parseArgs([
			"-e",
			"./a.ts",
			"--extension",
			"./b.ts",
			"--skill",
			"./s1",
			"--skill",
			"./s2",
			"--prompt-template",
			"./p.md",
		]);

		expect(args.extensions).toEqual(["./a.ts", "./b.ts"]);
		expect(args.skills).toEqual(["./s1", "./s2"]);
		expect(args.promptTemplates).toEqual(["./p.md"]);
	});

	it("treats everything after -- as positional", () => {
		const args = parseArgs(["--", "--not-a-flag", "@file.txt"]);

		expect(args.messages).toEqual(["--not-a-flag"]);
		expect(args.fileArgs).toEqual(["file.txt"]);
	});

	it("collects unknown long flags for extensions", () => {
		const args = parseArgs(["--my-flag", "value", "--other=1", "--switch"]);

		expect(args.unknownFlags.get("my-flag")).toBe("value");
		expect(args.unknownFlags.get("other")).toBe("1");
		expect(args.unknownFlags.get("switch")).toBe(true);
	});

	it("records diagnostics for invalid input", () => {
		const args = parseArgs(["--thinking", "invalid", "-z"]);

		expect(args.diagnostics).toHaveLength(2);
		expect(args.diagnostics[0]).toMatchObject({ type: "warning" });
		expect(args.diagnostics[1]).toMatchObject({ type: "error", message: "Unknown option: -z" });
	});

	it("parses session and trust options", () => {
		const args = parseArgs([
			"--continue",
			"--session-dir",
			"/tmp/sessions",
			"--approve",
			"--models",
			"a,b",
			"--no-skills",
		]);

		expect(args).toMatchObject({
			continue: true,
			sessionDir: "/tmp/sessions",
			projectTrustOverride: true,
			models: ["a", "b"],
			noSkills: true,
		});
	});

	it("lets --print consume the next message", () => {
		const args = parseArgs(["--print", "hello"]);

		expect(args.print).toBe(true);
		expect(args.messages).toEqual(["hello"]);
	});

	it("normalizes session names", () => {
		expect(normalizeSessionName("  name  ")).toBe("name");
		expect(normalizeSessionName("   ")).toBeUndefined();
	});
});
