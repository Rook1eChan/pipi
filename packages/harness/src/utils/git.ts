import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface GitPaths {
	/** 当前工作树根目录。 */
	repoDir: string;
	/** 与其它工作树共享的 .git 目录。 */
	commonGitDir: string;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** 解析 gitdir 文件里的 `gitdir: <path>`。 */
function readGitdirFile(gitFile: string): string | null {
	try {
		const content = readFileSync(gitFile, "utf-8").trim();
		if (!content.startsWith("gitdir: ")) return null;
		return resolve(dirname(gitFile), content.slice(8).trim());
	} catch {
		return null;
	}
}

/** 逐级向上找 .git，解析出工作树根与共享 git 目录。 */
export function findGitPaths(startDir: string): GitPaths | null {
	let current = resolve(startDir);
	while (true) {
		const dotGit = resolve(current, ".git");
		if (existsSync(dotGit)) {
			if (isDirectory(dotGit)) {
				if (!existsSync(resolve(dotGit, "HEAD"))) return null;
				return { repoDir: current, commonGitDir: dotGit };
			}

			const gitDir = readGitdirFile(dotGit);
			if (gitDir) {
				if (!existsSync(resolve(gitDir, "HEAD"))) return null;
				const commonDirFile = resolve(gitDir, "commondir");
				const commonGitDir = existsSync(commonDirFile)
					? resolve(gitDir, readFileSync(commonDirFile, "utf-8").trim())
					: gitDir;
				return { repoDir: current, commonGitDir };
			}
		}
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}
