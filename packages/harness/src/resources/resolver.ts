import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import { getHomeDir, PROJECT_CONFIG_DIR } from "../config.ts";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import { addIgnoreRules, createIgnoreMatcher, type IgnoreMatcher, toPosixPath } from "./ignore.ts";
import type { ResourceSettings } from "./settings.ts";
import type { PathMetadata } from "./source-info.ts";

export type ResourceType = "extensions" | "skills" | "prompts";

export interface ResolvedResource {
	path: string;
	enabled: boolean;
	metadata: PathMetadata;
}

export interface ResolvedPaths {
	extensions: ResolvedResource[];
	skills: ResolvedResource[];
	prompts: ResolvedResource[];
}

const RESOURCE_TYPES: ResourceType[] = ["extensions", "skills", "prompts"];

const FILE_PATTERNS: Record<ResourceType, RegExp> = {
	extensions: /\.(ts|js)$/,
	skills: /\.md$/,
	prompts: /\.md$/,
};

type SkillDiscoveryMode = "pipi" | "agents";

type ResourceAccumulator = Record<ResourceType, Map<string, { metadata: PathMetadata; enabled: boolean }>>;

function createAccumulator(): ResourceAccumulator {
	return { extensions: new Map(), skills: new Map(), prompts: new Map() };
}

/** 给每个条目打分：project-local(0) > project-auto(1) > user-local(2) > user-auto(3) > package(4) */
function resourcePrecedenceRank(metadata: PathMetadata): number {
	if (metadata.origin === "package") return 4;
	const scopeBase = metadata.scope === "project" ? 0 : 2;
	return scopeBase + (metadata.source === "local" ? 0 : 1);
}

function isPattern(entry: string): boolean {
	return (
		entry.startsWith("!") ||
		entry.startsWith("+") ||
		entry.startsWith("-") ||
		entry.includes("*") ||
		entry.includes("?")
	);
}

function splitPatterns(entries: string[]): { plain: string[]; patterns: string[] } {
	const plain: string[] = [];
	const patterns: string[] = [];
	for (const entry of entries) {
		if (isPattern(entry)) patterns.push(entry);
		else plain.push(entry);
	}
	return { plain, patterns };
}

function getOverridePatterns(entries: string[]): string[] {
	return entries.filter((entry) => entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-"));
}

function matchesAnyPattern(filePath: string, patterns: string[], baseDir: string): boolean {
	const rel = toPosixPath(relative(baseDir, filePath));
	const name = basename(filePath);
	const filePathPosix = toPosixPath(filePath);
	const isSkillFile = name === "SKILL.md";
	const parentDir = isSkillFile ? dirname(filePath) : undefined;
	const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir!)) : undefined;
	const parentName = isSkillFile ? basename(parentDir!) : undefined;
	const parentDirPosix = isSkillFile ? toPosixPath(parentDir!) : undefined;

	return patterns.some((pattern) => {
		const normalizedPattern = toPosixPath(pattern);
		if (
			minimatch(rel, normalizedPattern) ||
			minimatch(name, normalizedPattern) ||
			minimatch(filePathPosix, normalizedPattern)
		) {
			return true;
		}
		if (!isSkillFile) return false;
		return (
			minimatch(parentRel!, normalizedPattern) ||
			minimatch(parentName!, normalizedPattern) ||
			minimatch(parentDirPosix!, normalizedPattern)
		);
	});
}

function normalizeExactPattern(pattern: string): string {
	const normalized = pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
	return toPosixPath(normalized);
}

function matchesAnyExactPattern(filePath: string, patterns: string[], baseDir: string): boolean {
	if (patterns.length === 0) return false;
	const rel = toPosixPath(relative(baseDir, filePath));
	const filePathPosix = toPosixPath(filePath);
	const isSkillFile = basename(filePath) === "SKILL.md";
	const parentDir = isSkillFile ? dirname(filePath) : undefined;
	const parentRel = isSkillFile ? toPosixPath(relative(baseDir, parentDir!)) : undefined;
	const parentDirPosix = isSkillFile ? toPosixPath(parentDir!) : undefined;

	return patterns.some((pattern) => {
		const normalized = normalizeExactPattern(pattern);
		if (normalized === rel || normalized === filePathPosix) return true;
		if (!isSkillFile) return false;
		return normalized === parentRel || normalized === parentDirPosix;
	});
}

/** 计算目录条目里哪些文件被 `!`/`+`/`-` 模式启用。 */
function applyPatterns(allPaths: string[], patterns: string[], baseDir: string): Set<string> {
	const includes: string[] = [];
	const excludes: string[] = [];
	const forceIncludes: string[] = [];
	const forceExcludes: string[] = [];

	for (const pattern of patterns) {
		if (pattern.startsWith("+")) forceIncludes.push(pattern.slice(1));
		else if (pattern.startsWith("-")) forceExcludes.push(pattern.slice(1));
		else if (pattern.startsWith("!")) excludes.push(pattern.slice(1));
		else includes.push(pattern);
	}

	let result =
		includes.length === 0 ? [...allPaths] : allPaths.filter((path) => matchesAnyPattern(path, includes, baseDir));
	if (excludes.length > 0) result = result.filter((path) => !matchesAnyPattern(path, excludes, baseDir));
	if (forceIncludes.length > 0) {
		result = [
			...new Set([...result, ...allPaths.filter((path) => matchesAnyExactPattern(path, forceIncludes, baseDir))]),
		];
	}
	if (forceExcludes.length > 0) {
		result = result.filter((path) => !matchesAnyExactPattern(path, forceExcludes, baseDir));
	}
	return new Set(result);
}

/** 自动发现目录时，判断某个文件是否被 settings 的排除/强制模式关闭。 */
function isEnabledByOverrides(filePath: string, patterns: string[], baseDir: string): boolean {
	const overrides = getOverridePatterns(patterns);
	const excludes = overrides.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
	const forceIncludes = overrides.filter((pattern) => pattern.startsWith("+")).map((pattern) => pattern.slice(1));
	const forceExcludes = overrides.filter((pattern) => pattern.startsWith("-")).map((pattern) => pattern.slice(1));

	let enabled = true;
	if (excludes.length > 0 && matchesAnyPattern(filePath, excludes, baseDir)) enabled = false;
	if (forceIncludes.length > 0 && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) enabled = true;
	if (forceExcludes.length > 0 && matchesAnyExactPattern(filePath, forceExcludes, baseDir)) enabled = false;
	return enabled;
}

function statSyncSafe(path: string) {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

function readDirents(dir: string): Dirent[] | null {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return null;
	}
}

function collectFiles(dir: string, filePattern: RegExp, matcher?: IgnoreMatcher, rootDir?: string): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	const root = rootDir ?? dir;
	const ig = matcher ?? createIgnoreMatcher();
	addIgnoreRules(ig, dir, root);

	const entries = readDirents(dir);
	if (!entries) return files;

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "node_modules") continue;

		const fullPath = join(dir, entry.name);
		let isDirectory = entry.isDirectory();
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			const stats = statSyncSafe(fullPath);
			if (!stats) continue;
			isDirectory = stats.isDirectory();
			isFile = stats.isFile();
		}

		const relPath = toPosixPath(relative(root, fullPath));
		const ignorePath = isDirectory ? `${relPath}/` : relPath;
		if (ig.ignores(ignorePath)) continue;

		if (isDirectory) {
			files.push(...collectFiles(fullPath, filePattern, ig, root));
		} else if (isFile && filePattern.test(entry.name)) {
			files.push(fullPath);
		}
	}

	return files;
}

function collectSkillEntries(
	dir: string,
	mode: SkillDiscoveryMode,
	matcher?: IgnoreMatcher,
	rootDir?: string,
): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	const root = rootDir ?? dir;
	const ig = matcher ?? createIgnoreMatcher();
	addIgnoreRules(ig, dir, root);

	const dirEntries = readDirents(dir);
	if (!dirEntries) return entries;

	for (const entry of dirEntries) {
		if (entry.name !== "SKILL.md") continue;

		const fullPath = join(dir, entry.name);
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			const stats = statSyncSafe(fullPath);
			if (!stats) continue;
			isFile = stats.isFile();
		}

		const relPath = toPosixPath(relative(root, fullPath));
		if (isFile && !ig.ignores(relPath)) {
			entries.push(fullPath);
			return entries;
		}
	}

	for (const entry of dirEntries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "node_modules") continue;

		const fullPath = join(dir, entry.name);
		let isDirectory = entry.isDirectory();
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			const stats = statSyncSafe(fullPath);
			if (!stats) continue;
			isDirectory = stats.isDirectory();
			isFile = stats.isFile();
		}

		const relPath = toPosixPath(relative(root, fullPath));
		const shouldIncludeMarkdownFile =
			isFile &&
			entry.name.endsWith(".md") &&
			!ig.ignores(relPath) &&
			((mode === "pipi" && dir === root) || (mode === "agents" && dir !== root));
		if (shouldIncludeMarkdownFile) {
			entries.push(fullPath);
			continue;
		}

		if (!isDirectory) continue;
		if (ig.ignores(`${relPath}/`)) continue;

		entries.push(...collectSkillEntries(fullPath, mode, ig, root));
	}

	return entries;
}

function collectPromptEntries(dir: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	const ig = createIgnoreMatcher();
	addIgnoreRules(ig, dir, dir);

	const dirEntries = readDirents(dir);
	if (!dirEntries) return entries;

	for (const entry of dirEntries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "node_modules") continue;

		const fullPath = join(dir, entry.name);
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			const stats = statSyncSafe(fullPath);
			if (!stats) continue;
			isFile = stats.isFile();
		}

		const relPath = toPosixPath(relative(dir, fullPath));
		if (ig.ignores(relPath)) continue;
		if (isFile && entry.name.endsWith(".md")) entries.push(fullPath);
	}

	return entries;
}

function readManifestExtensions(dir: string): string[] | null {
	const packageJsonPath = join(dir, "package.json");
	if (!existsSync(packageJsonPath)) return null;

	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { pipi?: { extensions?: unknown } };
		const entries = pkg.pipi?.extensions;
		if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string")) return null;

		const resolved = entries.map((entry: string) => resolve(dir, entry)).filter((entry) => existsSync(entry));
		return resolved.length > 0 ? resolved : null;
	} catch {
		return null;
	}
}

function resolveExtensionEntries(dir: string): string[] | null {
	const manifestEntries = readManifestExtensions(dir);
	if (manifestEntries) return manifestEntries;

	const indexTs = join(dir, "index.ts");
	if (existsSync(indexTs)) return [indexTs];

	const indexJs = join(dir, "index.js");
	if (existsSync(indexJs)) return [indexJs];

	return null;
}

function collectAutoExtensionEntries(dir: string): string[] {
	const entries: string[] = [];
	if (!existsSync(dir)) return entries;

	const rootEntries = resolveExtensionEntries(dir);
	if (rootEntries) return rootEntries;

	const ig = createIgnoreMatcher();
	addIgnoreRules(ig, dir, dir);

	const dirEntries = readDirents(dir);
	if (!dirEntries) return entries;

	for (const entry of dirEntries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "node_modules") continue;

		const fullPath = join(dir, entry.name);
		let isDirectory = entry.isDirectory();
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			const stats = statSyncSafe(fullPath);
			if (!stats) continue;
			isDirectory = stats.isDirectory();
			isFile = stats.isFile();
		}

		const relPath = toPosixPath(relative(dir, fullPath));
		const ignorePath = isDirectory ? `${relPath}/` : relPath;
		if (ig.ignores(ignorePath)) continue;

		if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
			entries.push(fullPath);
		} else if (isDirectory) {
			const resolvedEntries = resolveExtensionEntries(fullPath);
			if (resolvedEntries) entries.push(...resolvedEntries);
		}
	}

	return entries;
}

function collectResourceFiles(dir: string, resourceType: ResourceType): string[] {
	if (resourceType === "skills") return collectSkillEntries(dir, "pipi");
	if (resourceType === "extensions") return collectAutoExtensionEntries(dir);
	return collectFiles(dir, FILE_PATTERNS[resourceType]);
}

function collectFilesFromPaths(paths: string[], resourceType: ResourceType): string[] {
	const files: string[] = [];
	for (const path of paths) {
		if (!existsSync(path)) continue;
		const stats = statSyncSafe(path);
		if (!stats) continue;
		if (stats.isFile()) {
			files.push(path);
		} else if (stats.isDirectory()) {
			files.push(...collectResourceFiles(path, resourceType));
		}
	}
	return files;
}

function findGitRepoRoot(startDir: string): string | null {
	let dir = resolve(startDir);
	while (true) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function collectAncestorAgentsSkillDirs(startDir: string): string[] {
	const skillDirs: string[] = [];
	const resolvedStartDir = resolve(startDir);
	const gitRepoRoot = findGitRepoRoot(resolvedStartDir);

	let dir = resolvedStartDir;
	while (true) {
		skillDirs.push(join(dir, ".agents", "skills"));
		if (gitRepoRoot && dir === gitRepoRoot) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return skillDirs;
}

// 计算所有条目的优先级分数和路径。同一路径保留分数最小的一条
function toResolvedList(entries: Map<string, { metadata: PathMetadata; enabled: boolean }>): ResolvedResource[] {
	const resolved = Array.from(entries.entries()).map(([path, value]) => ({
		path,
		enabled: value.enabled,
		metadata: value.metadata,
	}));
	resolved.sort((a, b) => resourcePrecedenceRank(a.metadata) - resourcePrecedenceRank(b.metadata));

	const seen = new Set<string>();
	return resolved.filter((entry) => {
		const canonicalPath = canonicalizePath(entry.path);
		if (seen.has(canonicalPath)) return false;
		seen.add(canonicalPath);
		return true;
	});
}

/**
 * 资源解析器：只负责把 settings 条目与默认目录展开成路径。
 * 不读取资源内容，也不构造技能、模板或扩展对象。
 */
export class ResourceResolver {
	private readonly settings: ResourceSettings;

	constructor(settings: ResourceSettings) {
		this.settings = settings;
	}

	/**
	 * 解析资源路径。
	 *
	 * 顺序：
	 * 1. settings 条目：先项目级，再全局（agent）级；项目未信任时跳过项目条目。
	 * 2. 默认目录：全局 agent 目录、项目 `.pipi`、`.agents/skills` 与祖先目录。
	 * 3. 每类资源按优先级排序，并按真实路径去重。
	 *
	 * 只产出路径、enabled 与来源元数据，不读取文件内容。
	 */
	async resolve(): Promise<ResolvedPaths> {
		const accumulator = createAccumulator();

		const projectBaseDir = join(this.settings.projectDir, PROJECT_CONFIG_DIR);
		const agentBaseDir = this.settings.agentDir;

		// settings 条目：项目级先写入，保证重名时项目资源胜出
		for (const resourceType of RESOURCE_TYPES) {
			// extension、skill、prompts
			const target = accumulator[resourceType];
			if (this.settings.projectTrusted) {
				this.resolveLocalEntries(
					this.settings[resourceType].project,
					resourceType,
					target,
					{ source: "local", scope: "project", origin: "top-level" },
					projectBaseDir,
				);
			}
			this.resolveLocalEntries(
				this.settings[resourceType].agent,
				resourceType,
				target,
				{ source: "local", scope: "agent", origin: "top-level" },
				agentBaseDir,
			);
		}

		// 固定目录：trust 决定是否扫描项目目录，全局目录始终扫描
		this.addAutoDiscoveredResources(accumulator, projectBaseDir, agentBaseDir);

		// 按 project > agent > package 排序，同一真实路径只保留第一个
		return {
			extensions: toResolvedList(accumulator.extensions),
			skills: toResolvedList(accumulator.skills),
			prompts: toResolvedList(accumulator.prompts),
		};
	}

	private resolveLocalEntries(
		entries: string[],
		resourceType: ResourceType,
		target: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		metadata: PathMetadata,
		baseDir: string,
	): void {
		if (entries.length === 0) return;

		const { plain, patterns } = splitPatterns(entries);
		const resolvedPlain = plain.map((entry) => resolvePath(entry, baseDir, { trim: true }));

		const allFiles = collectFilesFromPaths(resolvedPlain, resourceType);
		const enabledPaths = applyPatterns(allFiles, patterns, baseDir);

		for (const file of allFiles) {
			this.addResource(target, file, metadata, enabledPaths.has(file));
		}
	}

	private addAutoDiscoveredResources(
		accumulator: ResourceAccumulator,
		projectBaseDir: string,
		agentBaseDir: string,
	): void {
		const agentMetadata: PathMetadata = {
			source: "auto",
			scope: "agent",
			origin: "top-level",
			baseDir: agentBaseDir,
		};
		const projectMetadata: PathMetadata = {
			source: "auto",
			scope: "project",
			origin: "top-level",
			baseDir: projectBaseDir,
		};

		const agentDirs = {
			extensions: join(agentBaseDir, "extensions"),
			skills: join(agentBaseDir, "skills"),
			prompts: join(agentBaseDir, "prompts"),
		};
		const projectDirs = {
			extensions: join(projectBaseDir, "extensions"),
			skills: join(projectBaseDir, "skills"),
			prompts: join(projectBaseDir, "prompts"),
		};
		const homeAgentsSkillsDir = join(getHomeDir(), ".agents", "skills");
		const projectAgentsSkillDirs = this.settings.projectTrusted
			? collectAncestorAgentsSkillDirs(this.settings.projectDir).filter(
					(dir) => resolve(dir) !== resolve(homeAgentsSkillsDir),
				)
			: [];

		const add = (
			resourceType: ResourceType,
			paths: string[],
			metadata: PathMetadata,
			overrides: string[],
			baseDir: string,
		): void => {
			const target = accumulator[resourceType];
			for (const path of paths) {
				this.addResource(target, path, metadata, isEnabledByOverrides(path, overrides, baseDir));
			}
		};

		if (this.settings.projectTrusted) {
			add(
				"extensions",
				collectAutoExtensionEntries(projectDirs.extensions),
				projectMetadata,
				this.settings.extensions.project,
				projectBaseDir,
			);
			add(
				"skills",
				collectSkillEntries(projectDirs.skills, "pipi"),
				projectMetadata,
				this.settings.skills.project,
				projectBaseDir,
			);
		}

		for (const agentsSkillsDir of projectAgentsSkillDirs) {
			const agentsBaseDir = dirname(agentsSkillsDir);
			add(
				"skills",
				collectSkillEntries(agentsSkillsDir, "agents"),
				{ ...projectMetadata, baseDir: agentsBaseDir },
				this.settings.skills.project,
				agentsBaseDir,
			);
		}

		if (this.settings.projectTrusted) {
			add(
				"prompts",
				collectPromptEntries(projectDirs.prompts),
				projectMetadata,
				this.settings.prompts.project,
				projectBaseDir,
			);
		}

		add(
			"extensions",
			collectAutoExtensionEntries(agentDirs.extensions),
			agentMetadata,
			this.settings.extensions.agent,
			agentBaseDir,
		);
		add(
			"skills",
			collectSkillEntries(agentDirs.skills, "pipi"),
			agentMetadata,
			this.settings.skills.agent,
			agentBaseDir,
		);
		add(
			"skills",
			collectSkillEntries(homeAgentsSkillsDir, "agents"),
			{ ...agentMetadata, baseDir: dirname(homeAgentsSkillsDir) },
			this.settings.skills.agent,
			dirname(homeAgentsSkillsDir),
		);
		add("prompts", collectPromptEntries(agentDirs.prompts), agentMetadata, this.settings.prompts.agent, agentBaseDir);
	}

	private addResource(
		map: Map<string, { metadata: PathMetadata; enabled: boolean }>,
		path: string,
		metadata: PathMetadata,
		enabled: boolean,
	): void {
		if (!path) return;
		if (!map.has(path)) map.set(path, { metadata, enabled });
	}
}
