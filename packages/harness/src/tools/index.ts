import type { AgentTool } from "@pipi/agent";
import { createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition } from "./edit.ts";
import { createFindTool, createFindToolDefinition } from "./find.ts";
import { createGrepTool, createGrepToolDefinition } from "./grep.ts";
import { createLsTool, createLsToolDefinition } from "./ls.ts";
import { createPowerShellTool, createPowerShellToolDefinition } from "./powershell.ts";
import { createReadTool, createReadToolDefinition } from "./read.ts";
import type { ToolDefinition } from "./support/definition.ts";
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
export function createReadOnlyTools(cwd: string, options: ToolsOptions = {}): AgentTool[] {
	return [createReadTool(cwd, options.read), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd, options.ls)];
}

/** 编码工具集：能读写文件并执行命令。 */
export function createCodingTools(cwd: string, options: ToolsOptions = {}): AgentTool[] {
	return [
		createReadTool(cwd, options.read),
		createBashTool(cwd, options.bash),
		createEditTool(cwd, options.edit),
		createWriteTool(cwd, options.write),
	];
}

export function createAllTools(cwd: string, options: ToolsOptions = {}): Record<ToolName, AgentTool> {
	return {
		read: createReadTool(cwd, options.read),
		bash: createBashTool(cwd, options.bash),
		powershell: createPowerShellTool(cwd, options.powershell),
		edit: createEditTool(cwd, options.edit),
		write: createWriteTool(cwd, options.write),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd, options.ls),
	};
}

export function createTool(toolName: ToolName, cwd: string, options: ToolsOptions = {}): AgentTool {
	const tools: Record<ToolName, () => AgentTool> = {
		read: () => createReadTool(cwd, options.read),
		bash: () => createBashTool(cwd, options.bash),
		powershell: () => createPowerShellTool(cwd, options.powershell),
		edit: () => createEditTool(cwd, options.edit),
		write: () => createWriteTool(cwd, options.write),
		grep: () => createGrepTool(cwd),
		find: () => createFindTool(cwd),
		ls: () => createLsTool(cwd, options.ls),
	};
	return tools[toolName]();
}

export function createToolDefinitions(cwd: string, options: ToolsOptions = {}): ToolDefinition<unknown, unknown>[] {
	return [
		createReadToolDefinition(cwd, options.read) as ToolDefinition<unknown, unknown>,
		createBashToolDefinition(cwd, options.bash) as ToolDefinition<unknown, unknown>,
		createPowerShellToolDefinition(cwd, options.powershell) as ToolDefinition<unknown, unknown>,
		createEditToolDefinition(cwd, options.edit) as ToolDefinition<unknown, unknown>,
		createWriteToolDefinition(cwd, options.write) as ToolDefinition<unknown, unknown>,
		createGrepToolDefinition(cwd) as ToolDefinition<unknown, unknown>,
		createFindToolDefinition(cwd) as ToolDefinition<unknown, unknown>,
		createLsToolDefinition(cwd, options.ls) as ToolDefinition<unknown, unknown>,
	];
}
