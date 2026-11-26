import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface ShellConfig {
	shell: string;
	args: string[];
	commandTransport: "args" | "stdin";
}

// 已启动的子进程，进程退出时统一清理，避免留下孤儿
const detachedPids = new Set<number>();

/** bash / zsh 等 POSIX shell 的启动参数。 */
export function getShellConfig(shellPath?: string): ShellConfig {
	if (process.platform === "win32") {
		return {
			shell: shellPath ?? process.env.ComSpec ?? "cmd.exe",
			args: ["/d", "/s", "/c"],
			commandTransport: "args",
		};
	}
	const shell = shellPath ?? process.env.SHELL ?? "/bin/bash";
	return { shell, args: ["-lc"], commandTransport: "args" };
}

/** PowerShell 的启动参数。 */
export function getPowerShellConfig(shellPath?: string): ShellConfig {
	if (process.platform === "win32") {
		return {
			shell: shellPath ?? "powershell.exe",
			args: ["-NoLogo", "-NoProfile", "-Command", "-"],
			commandTransport: "stdin",
		};
	}
	return {
		shell: shellPath ?? "pwsh",
		args: ["-NoLogo", "-NoProfile", "-Command", "-"],
		commandTransport: "stdin",
	};
}

/** 命令执行时的环境变量；去掉可能泄漏的会话变量，由调用方按需注入。 */
export function getShellEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	delete env.PIPI_SESSION_ID;
	delete env.PIPI_SESSION_FILE;
	delete env.PIPI_PROVIDER;
	delete env.PIPI_MODEL;
	delete env.PIPI_REASONING_LEVEL;
	return env;
}

export function trackDetachedChildPid(pid: number): void {
	detachedPids.add(pid);
}

export function untrackDetachedChildPid(pid: number): void {
	detachedPids.delete(pid);
}

/** 杀掉整个进程组，不只是 shell 本身。 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// 进程已退出
		}
		return;
	}
	try {
		// 负号表示向整个进程组发信号
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// 进程已退出
		}
	}
}

process.once("exit", () => {
	for (const pid of detachedPids) killProcessTree(pid);
});

/** 在 PATH 中查找可执行文件。 */
export function commandExists(command: string): boolean {
	const pathValue = process.env.PATH ?? "";
	const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
	for (const dir of pathValue.split(delimiter)) {
		if (!dir) continue;
		for (const extension of extensions) {
			if (existsSync(join(dir, command + extension))) return true;
		}
	}
	return false;
}
