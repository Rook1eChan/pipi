/**
 * 系统提示拼装：只负责把已经加载好的内容拼成一个字符串。
 */

import type { ContextFile } from "../resources/context-files.ts";
import { formatSkillsForPrompt, type Skill } from "../resources/skills.ts";

export interface BuildSystemPromptOptions {
	/** 自定义提示：给出时替换默认说明，但项目上下文与技能仍然追加。 */
	customPrompt?: string;
	/** 当前启用的工具名。默认 read、bash、edit、write。 */
	selectedTools?: string[];
	/** 工具简介，只有提供简介的工具才会出现在提示里。 */
	toolSnippets?: Record<string, string>;
	/** 各工具追加的使用规则。 */
	promptGuidelines?: string[];
	/** 追加在提示末尾的自定义内容。 */
	appendSystemPrompt?: string;
	/** 工作目录，写在提示最后。 */
	projectDir: string;
	/** 已加载的项目规则文件。 */
	contextFiles?: ContextFile[];
	/** 已加载的技能。 */
	skills?: Skill[];
}

function buildDefaultPrompt(options: BuildSystemPromptOptions, tools: string[]): string {
	const visibleTools = tools.filter((name) => Boolean(options.toolSnippets?.[name]));
	const toolsList =
		visibleTools.length > 0
			? visibleTools.map((name) => `- ${name}: ${options.toolSnippets?.[name]}`).join("\n")
			: "(none)";

	const guidelines: string[] = [];
	const seen = new Set<string>();
	const add = (guideline: string) => {
		if (seen.has(guideline)) return;
		seen.add(guideline);
		guidelines.push(guideline);
	};

	// 没有专用搜索工具时，提示模型改用 shell
	const hasBash = tools.includes("bash");
	const hasPowerShell = tools.includes("powershell");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			add("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			add("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			add("Use bash for file operations like ls, rg, find");
		}
	}

	for (const guideline of options.promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) add(normalized);
	}
	add("Be concise in your responses");
	add("Show file paths clearly when working with files");

	return `You are an expert coding assistant operating inside pipi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines.map((guideline) => `- ${guideline}`).join("\n")}`;
}

function buildContextSection(contextFiles: ContextFile[]): string {
	if (contextFiles.length === 0) return "";
	let section = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
	for (const file of contextFiles) {
		section += `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
	}
	return `${section}</project_context>\n`;
}

/** 拼装系统提示。 */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
	let prompt = options.customPrompt ?? buildDefaultPrompt(options, tools);

	if (options.appendSystemPrompt) prompt += `\n\n${options.appendSystemPrompt}`;
	prompt += buildContextSection(options.contextFiles ?? []);

	// 有 read/bash 且有技能时，才把技能索引加入提示
	const readTool = (["read", "bash"] as const).find((name) => tools.includes(name));
	if (readTool && options.skills && options.skills.length > 0) {
		prompt += formatSkillsForPrompt(options.skills, readTool);
	}

	prompt += `\nCurrent working directory: ${options.projectDir.replace(/\\/g, "/")}`;
	return prompt;
}
