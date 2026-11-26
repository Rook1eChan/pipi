import { parse } from "yaml";
import { stripBom } from "./text.ts";

export interface ParsedFrontmatter<T extends Record<string, unknown> = Record<string, unknown>> {
	frontmatter: T;
	body: string;
}

/**
 * 解析文件顶部的 `---` YAML 块。
 * 没有 frontmatter 或缺少结束标记时，当作纯正文处理。
 */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> {
	const normalized = stripBom(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) return { frontmatter: {} as T, body: normalized };

	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return { frontmatter: {} as T, body: normalized };

	const parsed = parse(normalized.slice(4, end)) ?? {};
	return {
		frontmatter: parsed as T,
		body: normalized.slice(end + 4).trim(),
	};
}
