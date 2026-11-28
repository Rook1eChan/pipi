import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getHomeDir, PROJECT_CONFIG_DIR } from "../config.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";

export type ProjectTrustDecision = boolean | null;

export interface ProjectTrustStoreEntry {
	path: string;
	decision: boolean;
}

export interface ProjectTrustUpdate {
	path: string;
	decision: ProjectTrustDecision;
}

export interface ProjectTrustOption {
	label: string;
	trusted: boolean;
	updates: ProjectTrustUpdate[];
	savedPath?: string;
}

type TrustFile = Record<string, boolean | null | undefined>;

/** 项目里需要信任才能加载的内容。 */
const TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES = [
	"settings.json",
	"extensions",
	"skills",
	"prompts",
	"SYSTEM.md",
	"APPEND_SYSTEM.md",
] as const;

function normalizeProjectDir(projectDir: string): string {
	return canonicalizePath(resolvePath(projectDir));
}

/** 从 trust 记录里找当前目录或最近祖先的结论。 */
function findNearestTrustEntry(data: TrustFile, projectDir: string): ProjectTrustStoreEntry | null {
	let currentDir = normalizeProjectDir(projectDir);
	while (true) {
		const value = data[currentDir];
		if (value === true || value === false) return { path: currentDir, decision: value };

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/** 父目录路径；已经在根目录时返回 undefined。 */
export function getProjectTrustParentPath(projectDir: string): string | undefined {
	const trustPath = normalizeProjectDir(projectDir);
	const parentDir = dirname(trustPath);
	return parentDir === trustPath ? undefined : parentDir;
}

/** 询问界面可选项；顺序与原项目一致。 */
export function getProjectTrustOptions(
	projectDir: string,
	options?: { includeSessionOnly?: boolean },
): ProjectTrustOption[] {
	const trustPath = normalizeProjectDir(projectDir);
	const trustOptions: ProjectTrustOption[] = [
		{ label: "Trust", trusted: true, updates: [{ path: trustPath, decision: true }], savedPath: trustPath },
	];

	const parentPath = getProjectTrustParentPath(projectDir);
	if (parentPath !== undefined) {
		trustOptions.push({
			label: `Trust parent folder (${parentPath})`,
			trusted: true,
			updates: [
				{ path: parentPath, decision: true },
				{ path: trustPath, decision: null },
			],
			savedPath: parentPath,
		});
	}

	if (options?.includeSessionOnly) {
		trustOptions.push({ label: "Trust (this session only)", trusted: true, updates: [] });
	}

	trustOptions.push({
		label: "Do not trust",
		trusted: false,
		updates: [{ path: trustPath, decision: false }],
		savedPath: trustPath,
	});

	if (options?.includeSessionOnly) {
		trustOptions.push({ label: "Do not trust (this session only)", trusted: false, updates: [] });
	}

	return trustOptions;
}

function readTrustFile(path: string): TrustFile {
	if (!existsSync(path)) return {};

	let parsed: unknown;
	try {
		parsed = JSON.parse(stripBom(readFileSync(path, "utf-8")));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read trust store ${path}: ${message}`);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Invalid trust store ${path}: expected an object`);
	}

	const data: TrustFile = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (value !== true && value !== false && value !== null) {
			throw new Error(`Invalid trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`);
		}
		data[key] = value;
	}
	return data;
}

function writeTrustFile(path: string, data: TrustFile): void {
	const sorted: TrustFile = {};
	for (const key of Object.keys(data).sort()) {
		const value = data[key];
		if (value === true || value === false || value === null) sorted[key] = value;
	}
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
}

function acquireTrustLockSync(path: string): () => void {
	const trustDir = dirname(path);
	mkdirSync(trustDir, { recursive: true });
	const maxAttempts = 10;
	const delayMs = 20;
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return lockfile.lockSync(trustDir, { realpath: false, lockfilePath: `${path}.lock` });
		} catch (error) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? String((error as { code?: unknown }).code)
					: undefined;
			if (code !== "ELOCKED" || attempt === maxAttempts) throw error;
			lastError = error;
			const start = Date.now();
			while (Date.now() - start < delayMs) {
				// 同步忙等，避免让调用方改成异步
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error("Failed to acquire trust store lock");
}

function withTrustFileLock<T>(path: string, fn: () => T): T {
	const release = acquireTrustLockSync(path);
	try {
		return fn();
	} finally {
		release();
	}
}

/**
 * 判断目录里是否有需要信任才能加载的项目资源：
 * 项目 `.pipi` 下的 settings、extensions、skills、prompts、SYSTEM.md、APPEND_SYSTEM.md，
 * 以及当前目录到根目录之间（排除用户级 `~/.agents/skills`）的 `.agents/skills`。
 */
export function hasTrustRequiringProjectResources(projectDir: string): boolean {
	const homeDir = canonicalizePath(resolvePath(getHomeDir()));
	const userAgentsSkillsDir = join(homeDir, ".agents", "skills");
	let currentDir = canonicalizePath(resolvePath(projectDir));

	const configDir = join(currentDir, PROJECT_CONFIG_DIR);
	if (TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES.some((entry) => existsSync(join(configDir, entry)))) {
		return true;
	}

	while (true) {
		const agentsSkillsDir = join(currentDir, ".agents", "skills");
		if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) return true;

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) return false;
		currentDir = parentDir;
	}
}

/** trust.json 的读写；记录路径到信任结论的映射。 */
export class ProjectTrustStore {
	private trustPath: string;

	constructor(agentDir: string) {
		this.trustPath = join(resolvePath(agentDir), "trust.json");
	}

	// 输入projectDir，得到trust判断结果。判断标准：trust.json记录的当前目录或最近祖先的结论；没有记录返回 null
	get(projectDir: string): ProjectTrustDecision {
		return this.getEntry(projectDir)?.decision ?? null;
	}

	// 查找trust.json里有没有projectDir或最其祖先的记录
	getEntry(projectDir: string): ProjectTrustStoreEntry | null {
		return withTrustFileLock(this.trustPath, () => findNearestTrustEntry(readTrustFile(this.trustPath), projectDir));
	}

	/** 写入单个目录的结论；null 表示删除记录。 */
	set(projectDir: string, decision: ProjectTrustDecision): void {
		this.setMany([{ path: projectDir, decision }]);
	}

	/** 批量写入；用于“信任父目录并清除当前目录”这类组合操作。 */
	setMany(decisions: ProjectTrustUpdate[]): void {
		withTrustFileLock(this.trustPath, () => {
			const data = readTrustFile(this.trustPath);
			for (const { path, decision } of decisions) {
				const key = normalizeProjectDir(path);
				if (decision === null) delete data[key];
				else data[key] = decision;
			}
			writeTrustFile(this.trustPath, data);
		});
	}
}
