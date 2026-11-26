import type { AgentTool } from "@pipi/agent";
import {
	createShellToolDefinition,
	type ShellToolDetails,
	type ShellToolInput,
	type ShellToolOptions,
} from "./bash.ts";
import { wrapToolDefinition } from "./definition.ts";
import { getPowerShellConfig, type ShellConfig } from "./support/shell.ts";

const powershellConfig = {
	name: "powershell",
	label: "powershell",
	shellName: "PowerShell",
	promptSnippet: "Execute PowerShell commands",
	promptGuidelines: ["You can inspect PI_* environment variables for current model and session details."],
	tempFilePrefix: "pipi-powershell",
	resolveShellConfig: (shellPath?: string): ShellConfig => getPowerShellConfig(shellPath),
};

export type PowerShellToolInput = ShellToolInput;
export type PowerShellToolDetails = ShellToolDetails;
export type PowerShellToolOptions = ShellToolOptions;

export function createPowerShellToolDefinition(cwd: string, options?: PowerShellToolOptions) {
	return createShellToolDefinition(cwd, powershellConfig, options);
}

export function createPowerShellTool(
	cwd: string,
	options?: PowerShellToolOptions,
): AgentTool<Record<string, unknown>, ShellToolDetails> {
	return wrapToolDefinition(createPowerShellToolDefinition(cwd, options));
}
