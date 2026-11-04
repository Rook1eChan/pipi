import { describe, expect, it } from "vitest";
import { parseJsonWithRepair, parseStreamingJson, repairJson } from "../src/utils/json-parse.ts";

describe("repairJson", () => {
	it("leaves valid JSON unchanged", () => {
		const text = '{"path":"src/a.ts","count":2}';
		expect(repairJson(text)).toBe(text);
	});

	it("escapes raw control characters inside strings", () => {
		expect(repairJson('{"text":"line1\nline2"}')).toBe('{"text":"line1\\nline2"}');
	});

	it("keeps valid escapes intact", () => {
		const text = '{"text":"a\\"b\\\\c\\u0041"}';
		expect(repairJson(text)).toBe(text);
	});

	it("escapes invalid escape sequences", () => {
		expect(repairJson(String.raw`{"text":"\x"}`)).toBe(String.raw`{"text":"\\x"}`);
	});

	it("escapes a dangling backslash", () => {
		const text = '{"text":"a' + "\\";
		expect(repairJson(text)).toBe('{"text":"a' + "\\\\");
	});

	it("does not touch backslashes outside strings", () => {
		const text = '{"a":1}\\n';
		expect(repairJson(text)).toBe(text);
	});
});

describe("parseJsonWithRepair", () => {
	it("parses valid JSON", () => {
		expect(parseJsonWithRepair('{"a":1}')).toEqual({ a: 1 });
	});

	it("parses JSON containing raw control characters", () => {
		expect(parseJsonWithRepair('{"text":"line1\nline2"}')).toEqual({ text: "line1\nline2" });
	});

	it("throws when the text cannot be repaired", () => {
		expect(() => parseJsonWithRepair("not json")).toThrow();
	});
});

describe("parseStreamingJson", () => {
	it("returns an empty object for empty input", () => {
		expect(parseStreamingJson(undefined)).toEqual({});
		expect(parseStreamingJson("   ")).toEqual({});
	});

	it("completes unclosed structures", () => {
		expect(parseStreamingJson('{"path":"src/a.ts"')).toEqual({ path: "src/a.ts" });
		expect(parseStreamingJson('{"items":[1,2')).toEqual({ items: [1, 2] });
	});

	it("keeps a string cut in the middle", () => {
		expect(parseStreamingJson('{"path":"src/a')).toEqual({ path: "src/a" });
	});

	it("keeps a dangling backslash as literal text", () => {
		const text = '{"path":"src/a' + "\\";
		expect(parseStreamingJson(text)).toEqual({ path: "src/a\\" });
	});

	it("repairs raw control characters", () => {
		expect(parseStreamingJson('{"text":"line1\nline2"}')).toEqual({ text: "line1\nline2" });
	});

	it("recovers a truncated string containing raw control characters", () => {
		expect(parseStreamingJson('{"text":"line1\nline2')).toEqual({ text: "line1\nline2" });
	});

	it("recovers a truncated string containing an invalid escape", () => {
		expect(parseStreamingJson('{"text":"a' + "\\x")).toEqual({ text: "a\\x" });
	});

	it("infers truncated literals", () => {
		expect(parseStreamingJson('{"flag":tru')).toEqual({ flag: true });
	});

	it("returns an empty object for unparseable text", () => {
		expect(parseStreamingJson("not json")).toEqual({});
	});

	it("never throws", () => {
		const inputs = ["{", "[", '"', "\\", '{"a":', '{"a":"x' + "\\", "tru", "not json", "\u0000"];
		for (const input of inputs) {
			expect(() => parseStreamingJson(input)).not.toThrow();
		}
	});
});
