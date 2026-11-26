import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolveNodePath, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

export interface PathInputOptions {
	/** 解析前去掉首尾空白。 */
	trim?: boolean;
	/** 把开头的 `~` 展开成 home 目录，默认 true。 */
	expandTilde?: boolean;
	/** `~` 展开使用的 home 目录。 */
	homeDir?: string;
	/** 去掉开头的 `@`，用于 CLI 的 @file 形式。 */
	stripAtPrefix?: boolean;
	/** 把各种 Unicode 空格规范成普通空格。 */
	normalizeUnicodeSpaces?: boolean;
}

/** 把 Git Bash、MSYS、Cygwin 与 WSL 的盘符路径转成 Windows API 接受的形式。 */
export function normalizeWindowsShellPath(filePath: string): string {
	if (!filePath.startsWith("/") || filePath.startsWith("//") || filePath.includes("\\")) return filePath;
	const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
	if (!match) return filePath;
	const suffix = match[2]?.replaceAll("/", "\\");
	return `${match[1].toUpperCase()}:\\${suffix ?? ""}`;
}

/** 按选项规范化路径字符串，不做绝对化。 */
export function normalizePath(input: string, options: PathInputOptions = {}): string {
	let normalized = options.trim ? input.trim() : input;
	if (options.normalizeUnicodeSpaces) {
		normalized = normalized.replace(UNICODE_SPACES, " ");
	}
	if (options.stripAtPrefix && normalized.startsWith("@")) {
		normalized = normalized.slice(1);
	}
	if (process.platform === "win32") {
		normalized = normalizeWindowsShellPath(normalized);
	}
	if (options.expandTilde ?? true) {
		const home = options.homeDir ?? homedir();
		if (normalized === "~") return home;
		if (normalized.startsWith("~/")) return join(home, normalized.slice(2));
	}
	if (/^file:\/\//.test(normalized)) {
		return fileURLToPath(normalized);
	}
	return normalized;
}

/** 把路径解析成绝对路径，支持 `~` 与相对基准目录。 */
export function resolvePath(input: string, baseDir: string = process.cwd(), options: PathInputOptions = {}): string {
	const normalized = normalizePath(input, options);
	const normalizedBaseDir = normalizePath(baseDir);
	return isAbsolute(normalized) ? resolveNodePath(normalized) : resolveNodePath(normalizedBaseDir, normalized);
}

/** 真实路径；目标不存在时返回原路径。 */
export function canonicalizePath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** target 是否位于 root 之下（含 root 自身）；调用方需传入绝对路径。 */
export function isUnderPath(target: string, root: string): boolean {
	const normalizedRoot = resolveNodePath(root);
	if (target === normalizedRoot) return true;
	const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
	return target.startsWith(prefix);
}

/** 值是否本地路径（而非 npm/git/http 等包来源）。 */
export function isLocalPath(value: string): boolean {
	const trimmed = value.trim();
	return !(
		trimmed.startsWith("npm:") ||
		trimmed.startsWith("git:") ||
		trimmed.startsWith("github:") ||
		trimmed.startsWith("http:") ||
		trimmed.startsWith("https:") ||
		trimmed.startsWith("ssh:")
	);
}
