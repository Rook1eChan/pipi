import { parse as parsePartial } from "partial-json";

/** JSON 字符串中合法的单字符转义。 */
const VALID_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/** JSON 字符串内部不允许直接出现的控制字符。 */
function isControlCharacter(char: string): boolean {
	const code = char.codePointAt(0);
	return code !== undefined && code <= 0x1f;
}

function escapeControlCharacter(char: string): string {
	switch (char) {
		case "\b":
			return "\\b";
		case "\f":
			return "\\f";
		case "\n":
			return "\\n";
		case "\r":
			return "\\r";
		case "\t":
			return "\\t";
		default: {
			const code = char.codePointAt(0) ?? 0;
			return `\\u${code.toString(16).padStart(4, "0")}`;
		}
	}
}

/**
 * 修复字符串字面量内部的常见错误，不补全结构。
 *
 * 处理三类问题：控制字符直接出现在字符串里、转义字符不合法、结尾残留孤立反斜杠。
 * 未闭合的括号与引号交给部分解析器处理。
 */
export function repairJson(text: string): string {
	let repaired = "";
	let inString = false;

	for (let index = 0; index < text.length; index++) {
		const char = text[index];

		if (!inString) {
			repaired += char;
			if (char === '"') {
				inString = true;
			}
			continue;
		}

		if (char === '"') {
			repaired += char;
			inString = false;
			continue;
		}

		if (char !== "\\") {
			repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
			continue;
		}

		const next = text[index + 1];
		if (next === undefined) {
			repaired += "\\\\";
			continue;
		}

		const unicodeDigits = text.slice(index + 2, index + 6);
		if (next === "u" && /^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
			repaired += `\\u${unicodeDigits}`;
			index += 5;
			continue;
		}

		if (VALID_ESCAPES.has(next)) {
			repaired += `\\${next}`;
			index += 1;
			continue;
		}

		// 非法转义：转义反斜杠本身，后续字符按普通字符继续处理。
		repaired += "\\\\";
	}

	return repaired;
}

/** 先按标准 JSON 解析，失败时修复字符串字面量后重试。 */
export function parseJsonWithRepair<T>(text: string): T {
	try {
		return JSON.parse(text) as T;
	} catch (error) {
		const repaired = repairJson(text);
		if (repaired === text) {
			throw error;
		}
		return JSON.parse(repaired) as T;
	}
}

/**
 * 解析可能不完整的流式 JSON，始终返回对象且不抛异常。
 *
 * 先按标准 JSON 解析；失败时修复字符串字面量后做部分解析，补全缺失的结构。
 * 两种情况都失败时返回空对象，因为流式中间态的解析失败是常态，不能中断整个流。
 */
export function parseStreamingJson<T = Record<string, unknown>>(text: string | undefined): T {
	if (text === undefined || text.trim() === "") {
		return {} as T;
	}

	try {
		return JSON.parse(text) as T;
	} catch {
		// 文本可能尚未闭合，继续尝试容错解析。
	}

	try {
		const partial = parsePartial(repairJson(text)) as unknown;
		return (partial ?? {}) as T;
	} catch {
		// 完全无法解析，返回空对象。
	}

	return {} as T;
}
