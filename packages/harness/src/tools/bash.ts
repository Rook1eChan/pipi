import type { AgentTool } from "@pipi/agent";
import { Type } from "typebox";
import { type ToolDefinition, wrapToolDefinition } from "./definition.ts";
import { spawnCommand, waitForChildProcess } from "./support/child-process.ts";
import { OutputAccumulator } from "./support/output-accumulator.ts";
import {
	getPowerShellConfig,
	getShellConfig,
	getShellEnv,
	killProcessTree,
	type ShellConfig,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "./support/shell.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./support/truncate.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const UPDATE_THROTTLE_MS = 100;

/** 工具执行时可见的会话信息，用于注入 `PI_*` 环境变量。 */
export interface ToolRuntimeContext {
	sessionId?: string;
	sessionFile?: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
}

const shellSchema = Type.Object({
	command: Type.String({ description: "Shell command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export type ShellToolInput = { command: string; timeout?: number };

export interface ShellToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

export interface ShellToolConfig {
	name: string;
	label: string;
	shellName: string;
	promptSnippet: string;
	promptGuidelines: readonly string[];
	tempFilePrefix: string;
	resolveShellConfig: (shellPath?: string) => ShellConfig;
}

export interface ShellToolOptions {
	shellPath?: string;
	/** 每个命令前执行的准备语句，例如激活环境。 */
	commandPrefix?: string;
	/** 是否注入 `PI_*` 环境变量。默认 true。 */
	exposeSessionEnvironment?: boolean;
	/** 执行时读取当前会话信息。 */
	getContext?: () => ToolRuntimeContext | undefined;
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}
	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_MS / 1000} seconds`);
	}
	return timeoutMs;
}

function buildEnv(options: ShellToolOptions): NodeJS.ProcessEnv {
	const env = getShellEnv();
	if (!(options.exposeSessionEnvironment ?? true)) return env;
	const context = options.getContext?.();
	if (!context) return env;

	if (context.sessionId) env.PIPI_SESSION_ID = context.sessionId;
	if (context.sessionFile) env.PIPI_SESSION_FILE = context.sessionFile;
	if (context.model) {
		env.PIPI_PROVIDER = context.model.provider;
		env.PIPI_MODEL = context.model.id;
	}
	if (context.thinkingLevel) env.PIPI_REASONING_LEVEL = context.thinkingLevel;
	return env;
}

export function createShellToolDefinition(
	projectDir: string,
	config: ShellToolConfig,
	options: ShellToolOptions = {},
): ToolDefinition<ShellToolInput, ShellToolDetails> {
	return {
		name: config.name,
		label: config.label,
		description: `Execute a ${config.shellName} command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		promptSnippet: config.promptSnippet,
		promptGuidelines: config.promptGuidelines,
		parameters: shellSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		execute: async (_toolCallId, input, signal, onUpdate) => {
			if (signal?.aborted) throw new Error("Operation aborted");
			const timeoutMs = resolveTimeoutMs(input.timeout);
			const command = options.commandPrefix ? `${options.commandPrefix}\n${input.command}` : input.command;
			const accumulator = new OutputAccumulator({ tempFilePrefix: config.tempFilePrefix });

			let acceptingOutput = true;
			let timedOut = false;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = accumulator.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};
			const clearUpdateTimer = () => {
				if (!updateTimer) return;
				clearTimeout(updateTimer);
				updateTimer = undefined;
			};
			const scheduleUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitUpdate();
				}, delay);
			};

			const child = spawnCommand(config.resolveShellConfig(options.shellPath), command, {
				projectDir,
				env: buildEnv(options),
			});
			if (child.pid) trackDetachedChildPid(child.pid);
			child.stdout?.on("data", (data: Buffer) => {
				if (!acceptingOutput) return;
				accumulator.append(data);
				scheduleUpdate();
			});
			child.stderr?.on("data", (data: Buffer) => {
				if (!acceptingOutput) return;
				accumulator.append(data);
				scheduleUpdate();
			});

			const kill = () => {
				if (child.pid) killProcessTree(child.pid);
			};
			const onAbort = () => kill();
			if (signal?.aborted) kill();
			signal?.addEventListener("abort", onAbort, { once: true });

			let timeoutHandle: NodeJS.Timeout | undefined;
			if (timeoutMs !== undefined) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					kill();
				}, timeoutMs);
			}

			const finishOutput = async () => {
				acceptingOutput = false;
				accumulator.finish();
				clearUpdateTimer();
				emitUpdate();
				const snapshot = accumulator.snapshot({ persistIfTruncated: true });
				await accumulator.closeTempFile();
				return snapshot;
			};

			const formatOutput = (
				snapshot: Awaited<ReturnType<typeof finishOutput>>,
				emptyText = "(no output)",
			): { text: string; details: ShellToolDetails | undefined } => {
				let text = snapshot.content || emptyText;
				const truncation = snapshot.truncation;
				if (!truncation.truncated) return { text, details: undefined };

				const details: ShellToolDetails = { truncation, fullOutputPath: snapshot.fullOutputPath };
				const startLine = truncation.totalLines - truncation.outputLines + 1;
				const endLine = truncation.totalLines;
				if (truncation.lastLinePartial) {
					const lineSize = formatSize(accumulator.getLastLineBytes());
					text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lineSize}). Full output: ${snapshot.fullOutputPath}]`;
				} else if (truncation.truncatedBy === "lines") {
					text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
				} else {
					text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
				}
				return { text, details };
			};

			const withStatus = (text: string, status: string) => (text ? `${text}\n\n${status}` : status);

			try {
				const exitCode = await waitForChildProcess(child);
				const snapshot = await finishOutput();
				const { text, details } = formatOutput(snapshot);

				if (signal?.aborted) throw new Error(withStatus(text, "Command aborted"));
				if (timedOut) throw new Error(withStatus(text, `Command timed out after ${input.timeout} seconds`));
				if (exitCode !== null && exitCode !== 0) {
					throw new Error(withStatus(text, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text }], details };
			} finally {
				acceptingOutput = false;
				clearUpdateTimer();
				if (timeoutHandle) clearTimeout(timeoutHandle);
				signal?.removeEventListener("abort", onAbort);
				if (child.pid) untrackDetachedChildPid(child.pid);
			}
		},
	};
}

export const bashConfig: ShellToolConfig = {
	name: "bash",
	label: "bash",
	shellName: "bash",
	promptSnippet: "Execute bash commands (ls, grep, find, etc.)",
	promptGuidelines: ["You can inspect PI_* environment variables for current model and session details."],
	tempFilePrefix: "pipi-bash",
	resolveShellConfig: (shellPath) => getShellConfig(shellPath),
};

export function createBashToolDefinition(
	projectDir: string,
	options?: ShellToolOptions,
): ToolDefinition<ShellToolInput, ShellToolDetails> {
	return createShellToolDefinition(projectDir, bashConfig, options);
}

export function createBashTool(
	projectDir: string,
	options?: ShellToolOptions,
): AgentTool<Record<string, unknown>, ShellToolDetails> {
	return wrapToolDefinition(createBashToolDefinition(projectDir, options));
}

export { getPowerShellConfig };
