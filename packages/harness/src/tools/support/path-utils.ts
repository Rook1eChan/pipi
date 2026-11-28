import { constants } from "node:fs";
import { access as fsAccess, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

// macOS 截图文件名里的窄不换行空格，用户通常输入普通空格
const NARROW_NO_BREAK_SPACE = "\u202F";

/** 统一空白字符、去掉 @ 前缀、展开 ~。 */
export function expandPath(filePath: string): string {
	const normalized = filePath.replace(/[\u00A0\u202F\u2007]/g, " ").replace(/^@/, "");
	if (normalized === "~") return homedir();
	if (normalized.startsWith("~/")) return resolve(homedir(), normalized.slice(2));
	return normalized;
}

/** 相对路径按 projectDir 解析，绝对路径原样返回。 */
export function resolveToProjectDir(filePath: string, projectDir: string): string {
	const expanded = expandPath(filePath);
	return isAbsolute(expanded) ? expanded : resolve(projectDir, expanded);
}

export async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fsAccess(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

// 用户手打的路径常与真实文件名差一个不可见字符，逐个变体尝试
function pathVariants(filePath: string): string[] {
	return [
		filePath,
		filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`),
		filePath.normalize("NFD"),
		filePath.replace(/'/g, "\u2019"),
	];
}

/** 读取前解析路径：先按常规解析，不存在时尝试 macOS 常见变体。 */
export async function resolveReadPath(filePath: string, projectDir: string): Promise<string> {
	const resolved = resolveToProjectDir(filePath, projectDir);
	for (const candidate of pathVariants(resolved)) {
		if (await pathExists(candidate)) return candidate;
	}
	return resolved;
}

/** 把路径解析成真实路径；文件不存在时返回解析后的绝对路径。 */
export async function resolveMutationPath(filePath: string, projectDir: string): Promise<string> {
	const resolved = resolveToProjectDir(filePath, projectDir);
	try {
		return await realpath(resolved);
	} catch {
		return resolved;
	}
}
