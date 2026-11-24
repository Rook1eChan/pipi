import { spawn } from "node:child_process";
import type { ShellConfig } from "./shell.ts";

/** 等待子进程结束并返回退出码；被信号杀死时返回 null。 */
export function waitForChildProcess(child: {
	once(event: "close", listener: (code: number | null) => void): unknown;
	once(event: "error", listener: (error: Error) => void): unknown;
}): Promise<number | null> {
	return new Promise<number | null>((resolvePromise, rejectPromise) => {
		let settled = false;
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			rejectPromise(error);
		});
		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			resolvePromise(code);
		});
	});
}

/** 按 shell 配置执行命令：参数传递或写入 stdin。 */
export function spawnCommand(config: ShellConfig, command: string, options: { cwd: string; env: NodeJS.ProcessEnv }) {
	const fromStdin = config.commandTransport === "stdin";
	const child = spawn(config.shell, fromStdin ? config.args : [...config.args, command], {
		cwd: options.cwd,
		// 独立进程组，便于中止时整树杀死
		detached: process.platform !== "win32",
		env: options.env,
		stdio: [fromStdin ? "pipe" : "ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	if (fromStdin) {
		child.stdin?.on("error", () => {});
		child.stdin?.end(command);
	}
	return child;
}
