import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { findGitPaths } from "../utils/git.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";

/** 一个项目规则文件。 */
export interface ContextFile {
	path: string;
	content: string;
}

/** 同一目录下的优先级：前者存在时不再看后者。 */
const CANDIDATES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

export interface LoadProjectContextFilesOptions {
	/** 项目目录，从这里向上查找规则文件。 */
	projectDir: string;
	/** 全局规则目录，通常是用户配置目录。 */
	agentDir: string;
}

/** 在一个目录里找第一个存在的规则文件。 */
export function loadContextFileFromDir(dir: string): ContextFile | null {
	for (const filename of CANDIDATES) {
		const filePath = join(dir, filename);
		if (!existsSync(filePath)) continue;
		try {
			if (!statSync(filePath).isFile()) continue;
			return { path: filePath, content: stripBom(readFileSync(filePath, "utf-8")) };
		} catch (error) {
			console.error(`Warning: Could not read ${filePath}: ${error}`);
		}
	}
	return null;
}

/**
 * linked worktree 会与主仓库共享同一份逻辑规则作用域：
 * 若工作树自己的规则文件已经存在，主仓库的那份应被跳过，避免同一段规则注入两次。
 */
function findShadowedContextFile(projectDir: string): string | undefined {
	const git = findGitPaths(projectDir);
	if (!git) return undefined;

	const commonGitDir = canonicalizePath(git.commonGitDir);
	const worktreeRoot = canonicalizePath(git.repoDir);
	const mainRepoRoot = dirname(commonGitDir);

	if (!worktreeRoot.startsWith(`${mainRepoRoot}${sep}`)) return undefined;
	if (canonicalizePath(join(mainRepoRoot, ".git")) !== commonGitDir) return undefined;

	const worktreeContext = loadContextFileFromDir(worktreeRoot);
	return worktreeContext ? join(mainRepoRoot, basename(worktreeContext.path)) : undefined;
}

/**
 * 加载项目规则：
 * 1. 全局目录的规则
 * 2. 从项目目录逐级向上，每层取一个候选文件
 * 顺序为“从远到近”，离项目越近越靠后；同一路径只保留一次。
 */
export function loadProjectContextFiles(options: LoadProjectContextFilesOptions): ContextFile[] {
	const resolvedProjectDir = resolvePath(options.projectDir);
	const resolvedAgentDir = resolvePath(options.agentDir);
	const files: ContextFile[] = [];
	const seen = new Set<string>();

	const agentFile = loadContextFileFromDir(resolvedAgentDir);
	if (agentFile) {
		files.push(agentFile);
		seen.add(agentFile.path);
	}

	const shadowed = findShadowedContextFile(resolvedProjectDir);
	const ancestors: ContextFile[] = [];
	let current = resolvedProjectDir;
	while (true) {
		const file = loadContextFileFromDir(current);
		const isShadowed = shadowed !== undefined && canonicalizePath(file?.path ?? "") === shadowed;
		if (file && !isShadowed && !seen.has(file.path)) {
			ancestors.unshift(file);
			seen.add(file.path);
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	files.push(...ancestors);
	return files;
}
