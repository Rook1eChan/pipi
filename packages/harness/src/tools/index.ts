import type { AgentTool } from "@pipi/agent";
import { createBashTool, createBashToolDefinition } from "./bash.ts";
import type { ToolDefinition } from "./definition.ts";
import { createEditTool, createEditToolDefinition } from "./edit.ts";
import { createFindTool, createFindToolDefinition } from "./find.ts";
import { createGrepTool, createGrepToolDefinition } from "./grep.ts";
import { createLsTool, createLsToolDefinition } from "./ls.ts";
import { createPowerShellTool, createPowerShellToolDefinition } from "./powershell.ts";
import { createReadTool, createReadToolDefinition } from "./read.ts";
import { createWriteTool, createWriteToolDefinition } from "./write.ts";

export type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";

export const allToolNames: ReadonlySet<ToolName> = new Set<ToolName>([
	"read",
	"bash",
	"powershell",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
]);

export interface ToolsOptions {
	read?: Parameters<typeof createReadTool>[1];
	bash?: Parameters<typeof createBashTool>[1];
	powershell?: Parameters<typeof createPowerShellTool>[1];
	write?: Parameters<typeof createWriteTool>[1];
	edit?: Parameters<typeof createEditTool>[1];
	ls?: Parameters<typeof createLsTool>[1];
}

/** 只读工具集：用于审查、问答等不允许改文件的场景。 */
export function createReadOnlyTools(projectDir: string, options: ToolsOptions = {}): AgentTool[] {
	return [
		createReadTool(projectDir, options.read),
		createGrepTool(projectDir),
		createFindTool(projectDir),
		createLsTool(projectDir, options.ls),
	];
}

/** 编码工具集：能读写文件并执行命令。 */
export function createCodingTools(projectDir: string, options: ToolsOptions = {}): AgentTool[] {
	return [
		createReadTool(projectDir, options.read),
		createBashTool(projectDir, options.bash),
		createEditTool(projectDir, options.edit),
		createWriteTool(projectDir, options.write),
	];
}

export function createAllTools(projectDir: string, options: ToolsOptions = {}): Record<ToolName, AgentTool> {
	return {
		read: createReadTool(projectDir, options.read),
		bash: createBashTool(projectDir, options.bash),
		powershell: createPowerShellTool(projectDir, options.powershell),
		edit: createEditTool(projectDir, options.edit),
		write: createWriteTool(projectDir, options.write),
		grep: createGrepTool(projectDir),
		find: createFindTool(projectDir),
		ls: createLsTool(projectDir, options.ls),
	};
}

export function createTool(toolName: ToolName, projectDir: string, options: ToolsOptions = {}): AgentTool {
	const tools: Record<ToolName, () => AgentTool> = {
		read: () => createReadTool(projectDir, options.read),
		bash: () => createBashTool(projectDir, options.bash),
		powershell: () => createPowerShellTool(projectDir, options.powershell),
		edit: () => createEditTool(projectDir, options.edit),
		write: () => createWriteTool(projectDir, options.write),
		grep: () => createGrepTool(projectDir),
		find: () => createFindTool(projectDir),
		ls: () => createLsTool(projectDir, options.ls),
	};
	return tools[toolName]();
}

export function createToolDefinitions(
	projectDir: string,
	options: ToolsOptions = {},
): ToolDefinition<unknown, unknown>[] {
	return [
		createReadToolDefinition(projectDir, options.read) as ToolDefinition<unknown, unknown>,
		createBashToolDefinition(projectDir, options.bash) as ToolDefinition<unknown, unknown>,
		createPowerShellToolDefinition(projectDir, options.powershell) as ToolDefinition<unknown, unknown>,
		createEditToolDefinition(projectDir, options.edit) as ToolDefinition<unknown, unknown>,
		createWriteToolDefinition(projectDir, options.write) as ToolDefinition<unknown, unknown>,
		createGrepToolDefinition(projectDir) as ToolDefinition<unknown, unknown>,
		createFindToolDefinition(projectDir) as ToolDefinition<unknown, unknown>,
		createLsToolDefinition(projectDir, options.ls) as ToolDefinition<unknown, unknown>,
	];
}
