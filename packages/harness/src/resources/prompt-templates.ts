import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PROJECT_CONFIG_DIR } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { isUnderPath, resolvePath } from "../utils/paths.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

/** 从 markdown 文件加载的命令模板。 */
export interface PromptTemplate {
	name: string;
	description: string;
	argumentHint?: string;
	content: string;
	sourceInfo: SourceInfo;
	filePath: string;
}

/** 解析命令参数，支持单引号与双引号。 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (const char of argsString) {
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			inQuote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (current) args.push(current);
	return args;
}

/**
 * 替换模板占位符：
 * `$1` 位置参数、`$@`/`$ARGUMENTS` 全部参数、`${1:-default}` 缺省值、`${@:2:3}` 切片。
 * 只替换模板本身，参数里的 `$1` 不会被再次替换。
 */
export function substituteArgs(content: string, args: string[]): string {
	const allArgs = args.join(" ");
	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
		(_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
			if (defaultTarget) {
				const value =
					defaultTarget === "@" || defaultTarget === "ARGUMENTS" ? allArgs : args[Number(defaultTarget) - 1];
				return value ? value : defaultValue;
			}
			if (sliceStart) {
				let start = Number(sliceStart) - 1;
				if (start < 0) start = 0;
				if (sliceLength) return args.slice(start, start + Number(sliceLength)).join(" ");
				return args.slice(start).join(" ");
			}
			if (simple === "ARGUMENTS" || simple === "@") return allArgs;
			return args[Number(simple) - 1] ?? "";
		},
	);
}

function loadTemplateFromFile(filePath: string, sourceInfo: SourceInfo): PromptTemplate | null {
	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(rawContent);

		const name = basename(filePath).replace(/\.md$/, "");

		let description = frontmatter.description || "";
		if (!description) {
			const firstLine = body.split("\n").find((line) => line.trim());
			if (firstLine) {
				description = firstLine.slice(0, 60);
				if (firstLine.length > 60) description += "...";
			}
		}

		return {
			name,
			description,
			...(frontmatter["argument-hint"] && { argumentHint: frontmatter["argument-hint"] }),
			content: body,
			sourceInfo,
			filePath,
		};
	} catch {
		return null;
	}
}

/** 扫描目录当前层的 `.md` 文件。 */
function loadTemplatesFromDir(dir: string, getSourceInfo: (filePath: string) => SourceInfo): PromptTemplate[] {
	const templates: PromptTemplate[] = [];
	if (!existsSync(dir)) return templates;

	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return templates;
	}

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				isFile = statSync(fullPath).isFile();
			} catch {
				continue;
			}
		}

		if (isFile && entry.name.endsWith(".md")) {
			const template = loadTemplateFromFile(fullPath, getSourceInfo(fullPath));
			if (template) templates.push(template);
		}
	}

	return templates;
}

export interface LoadPromptTemplatesOptions {
	/** 项目目录，用于解析相对路径与项目级模板。 */
	projectDir: string;
	/** 用户配置目录。 */
	agentDir: string;
	/** 显式模板路径，文件或目录。 */
	promptPaths: string[];
	/** 是否扫描默认目录。 */
	includeDefaults: boolean;
}

/** 加载命令模板：全局、项目、显式路径依次追加。 */
export function loadPromptTemplates(options: LoadPromptTemplatesOptions): PromptTemplate[] {
	const resolvedProjectDir = resolvePath(options.projectDir);
	const resolvedAgentDir = resolvePath(options.agentDir);
	const globalPromptsDir = join(resolvedAgentDir, "prompts");
	const projectPromptsDir = resolve(resolvedProjectDir, PROJECT_CONFIG_DIR, "prompts");

	const templates: PromptTemplate[] = [];

	const getSourceInfo = (resolvedPath: string): SourceInfo => {
		if (isUnderPath(resolvedPath, globalPromptsDir)) {
			return createSyntheticSourceInfo(resolvedPath, {
				source: "local",
				scope: "agent",
				baseDir: globalPromptsDir,
			});
		}
		if (isUnderPath(resolvedPath, projectPromptsDir)) {
			return createSyntheticSourceInfo(resolvedPath, {
				source: "local",
				scope: "project",
				baseDir: projectPromptsDir,
			});
		}
		let isDirectory = false;
		try {
			isDirectory = statSync(resolvedPath).isDirectory();
		} catch {
			// 路径不可读时按文件处理
		}
		return createSyntheticSourceInfo(resolvedPath, {
			source: "local",
			baseDir: isDirectory ? resolvedPath : dirname(resolvedPath),
		});
	};

	if (options.includeDefaults) {
		templates.push(...loadTemplatesFromDir(globalPromptsDir, getSourceInfo));
		templates.push(...loadTemplatesFromDir(projectPromptsDir, getSourceInfo));
	}

	for (const rawPath of options.promptPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedProjectDir, { trim: true });
		if (!existsSync(resolvedPath)) continue;

		try {
			const stats = statSync(resolvedPath);
			if (stats.isDirectory()) {
				templates.push(...loadTemplatesFromDir(resolvedPath, getSourceInfo));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const template = loadTemplateFromFile(resolvedPath, getSourceInfo(resolvedPath));
				if (template) templates.push(template);
			}
		} catch {
			// 读取失败时跳过
		}
	}

	return templates;
}

/** 输入以 `/name args` 开头且命中模板时，展开成模板正文。 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;

	const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
	if (!match) return text;

	const template = templates.find((candidate) => candidate.name === match[1]);
	if (!template) return text;

	return substituteArgs(template.content, parseCommandArgs(match[2] ?? ""));
}
