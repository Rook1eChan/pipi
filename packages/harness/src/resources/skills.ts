import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { PROJECT_CONFIG_DIR } from "../config.ts";
import { parseFrontmatter } from "../utils/frontmatter.ts";
import { canonicalizePath, isUnderPath, resolvePath } from "../utils/paths.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { addIgnoreRules, createIgnoreMatcher, type IgnoreMatcher, toPosixPath } from "./ignore.ts";
import { createSyntheticSourceInfo, type SourceInfo } from "./source-info.ts";

const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_DESCRIPTION_LENGTH = 1024;

export interface SkillFrontmatter {
	name?: unknown;
	description?: unknown;
	"disable-model-invocation"?: unknown;
	[key: string]: unknown;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: SourceInfo;
	disableModelInvocation: boolean;
}

export interface LoadSkillsResult {
	skills: Skill[];
	diagnostics: ResourceDiagnostic[];
}

/** 校验技能名：小写字母、数字、连字符，长度受限。 */
export function validateSkillName(name: string): string[] {
	const errors: string[] = [];
	if (name.length > MAX_SKILL_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_SKILL_NAME_LENGTH} characters (${name.length})`);
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
	}
	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push("name must not start or end with a hyphen");
	}
	if (name.includes("--")) {
		errors.push("name must not contain consecutive hyphens");
	}
	return errors;
}

/** 校验技能描述：非空且不超过上限。 */
export function validateSkillDescription(description: unknown): string[] {
	if (typeof description !== "string" || description.trim() === "") return ["description is required"];
	if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
		return [`description exceeds ${MAX_SKILL_DESCRIPTION_LENGTH} characters (${description.length})`];
	}
	return [];
}

export interface LoadSkillsFromDirOptions {
	/** 要扫描的目录。 */
	dir: string;
	/** 来源标识：`user`、`project`、`path` 或自定义标记。 */
	source: string;
}

function createSkillSourceInfo(filePath: string, baseDir: string, source: string): SourceInfo {
	switch (source) {
		case "agent":
			return createSyntheticSourceInfo(filePath, { source: "local", scope: "agent", baseDir });
		case "project":
			return createSyntheticSourceInfo(filePath, { source: "local", scope: "project", baseDir });
		case "path":
			return createSyntheticSourceInfo(filePath, { source: "local", baseDir });
		default:
			return createSyntheticSourceInfo(filePath, { source, baseDir });
	}
}

/** 从目录加载技能；目录本身有 SKILL.md 时不再递归。 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	return loadSkillsFromDirInternal(options.dir, options.source, true);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: IgnoreMatcher,
	rootDir?: string,
): LoadSkillsResult {
	const skills: Skill[] = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(dir)) return { skills, diagnostics };

	const root = rootDir ?? dir;
	const matcher = ignoreMatcher ?? createIgnoreMatcher();
	addIgnoreRules(matcher, dir, root);

	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return { skills, diagnostics };
	}

	for (const entry of entries) {
		if (entry.name !== "SKILL.md") continue;

		const fullPath = join(dir, entry.name);
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				isFile = statSync(fullPath).isFile();
			} catch {
				continue;
			}
		}

		const relPath = toPosixPath(relative(root, fullPath));
		if (!isFile || matcher.ignores(relPath)) continue;

		const result = loadSkillFromFile(fullPath, source);
		if (result.skill) skills.push(result.skill);
		diagnostics.push(...result.diagnostics);
		return { skills, diagnostics };
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.name === "node_modules") continue;

		const fullPath = join(dir, entry.name);
		let isDirectory = entry.isDirectory();
		let isFile = entry.isFile();
		if (entry.isSymbolicLink()) {
			try {
				const stats = statSync(fullPath);
				isDirectory = stats.isDirectory();
				isFile = stats.isFile();
			} catch {
				continue;
			}
		}

		const relPath = toPosixPath(relative(root, fullPath));
		const ignorePath = isDirectory ? `${relPath}/` : relPath;
		if (matcher.ignores(ignorePath)) continue;

		if (isDirectory) {
			const subResult = loadSkillsFromDirInternal(fullPath, source, false, matcher, root);
			skills.push(...subResult.skills);
			diagnostics.push(...subResult.diagnostics);
			continue;
		}

		if (!isFile || !includeRootFiles || !entry.name.endsWith(".md")) continue;

		const result = loadSkillFromFile(fullPath, source);
		if (result.skill) skills.push(result.skill);
		diagnostics.push(...result.diagnostics);
	}

	return { skills, diagnostics };
}

function loadSkillFromFile(
	filePath: string,
	source: string,
): { skill: Skill | null; diagnostics: ResourceDiagnostic[] } {
	const diagnostics: ResourceDiagnostic[] = [];
	const isDeclaredSkill = basename(filePath) === "SKILL.md";

	let rawContent: string;
	try {
		rawContent = readFileSync(filePath, "utf-8");
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to read skill file";
		diagnostics.push({ type: "warning", message, path: filePath });
		return { skill: null, diagnostics };
	}

	let frontmatter: SkillFrontmatter;
	try {
		({ frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent));
	} catch (error) {
		if (isDeclaredSkill) {
			const message = error instanceof Error ? error.message : "failed to parse skill file";
			diagnostics.push({ type: "warning", message, path: filePath });
		}
		return { skill: null, diagnostics };
	}

	const description = frontmatter.description;
	const hasDescription = typeof description === "string" && description.trim() !== "";
	if (!isDeclaredSkill && !hasDescription) return { skill: null, diagnostics };

	const skillDir = dirname(filePath);
	const parentDirName = basename(skillDir);

	for (const error of validateSkillDescription(description)) {
		diagnostics.push({ type: "warning", message: error, path: filePath });
	}

	const frontmatterName = typeof frontmatter.name === "string" ? frontmatter.name : undefined;
	const name = frontmatterName || parentDirName;

	for (const error of validateSkillName(name)) {
		diagnostics.push({ type: "warning", message: error, path: filePath });
	}

	// 名称或描述不合法时只记警告，技能仍然可用；仅描述缺失时放弃。
	if (!hasDescription) return { skill: null, diagnostics };

	return {
		skill: {
			name,
			description: description as string,
			filePath,
			baseDir: skillDir,
			sourceInfo: createSkillSourceInfo(filePath, skillDir, source),
			disableModelInvocation: frontmatter["disable-model-invocation"] === true,
		},
		diagnostics,
	};
}

/**
 * 技能索引：只列名称、描述与文件位置，正文由模型按需读取。
 * 声明 disableModelInvocation 的技能不列出。
 */
export function formatSkillsForPrompt(skills: Skill[], fileReadTool: "read" | "bash" = "read"): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
	if (visibleSkills.length === 0) return "";

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		fileReadTool === "read"
			? "Use the read tool to load a skill's file when the task matches its description."
			: "Use bash to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];

	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export interface LoadSkillsOptions {
	/** 项目目录，用于解析相对路径与项目级技能。 */
	projectDir: string;
	/** 用户配置目录。 */
	agentDir: string;
	/** 显式技能路径，文件或目录。 */
	skillPaths: string[];
	/** 是否扫描默认目录。 */
	includeDefaults: boolean;
}

/** 从默认目录与显式路径加载技能；同一文件只加载一次，同名先到先得。 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const resolvedProjectDir = resolvePath(options.projectDir);
	const resolvedAgentDir = resolvePath(options.agentDir);
	const agentSkillsDir = join(resolvedAgentDir, "skills");
	const projectSkillsDir = resolve(resolvedProjectDir, PROJECT_CONFIG_DIR, "skills");

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allDiagnostics: ResourceDiagnostic[] = [];
	const collisionDiagnostics: ResourceDiagnostic[] = [];

	function addSkills(result: LoadSkillsResult): void {
		allDiagnostics.push(...result.diagnostics);
		for (const skill of result.skills) {
			const realPath = canonicalizePath(skill.filePath);
			if (realPathSet.has(realPath)) continue;

			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionDiagnostics.push({
					type: "collision",
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: "skill",
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
						winnerSource: existing.sourceInfo.source,
						loserSource: skill.sourceInfo.source,
					},
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	if (options.includeDefaults) {
		addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "agent", true));
		addSkills(loadSkillsFromDirInternal(projectSkillsDir, "project", true));
	}

	const getSource = (resolvedPath: string): "agent" | "project" | "path" => {
		if (!options.includeDefaults) {
			if (isUnderPath(resolvedPath, agentSkillsDir)) return "agent";
			if (isUnderPath(resolvedPath, projectSkillsDir)) return "project";
		}
		return "path";
	};

	for (const rawPath of options.skillPaths) {
		const resolvedPath = resolvePath(rawPath, resolvedProjectDir, { trim: true });
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: "warning", message: "skill path does not exist", path: resolvedPath });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			const source = getSource(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, source, true));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const result = loadSkillFromFile(resolvedPath, source);
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics });
				} else {
					allDiagnostics.push(...result.diagnostics);
				}
			} else {
				allDiagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: resolvedPath });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allDiagnostics.push({ type: "warning", message, path: resolvedPath });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	};
}
