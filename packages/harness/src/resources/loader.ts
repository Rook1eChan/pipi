import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { getDefaultAgentDir, PROJECT_CONFIG_DIR } from "../config.ts";
import { canonicalizePath, isLocalPath, isUnderPath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { type ContextFile, loadProjectContextFiles } from "./context-files.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";
import { loadPromptTemplates, type PromptTemplate } from "./prompt-templates.ts";
import { ResourceResolver } from "./resolver.ts";
import { createResourceSettings, type ResourceSettings } from "./settings.ts";
import { type LoadSkillsResult, loadSkills } from "./skills.ts";
import { createSourceInfo, createSyntheticSourceInfo, type PathMetadata, type SourceInfo } from "./source-info.ts";

/** 运行中追加的资源路径，带来源元数据。 */
export interface ResourceExtensionPath {
	path: string;
	metadata: PathMetadata;
}

export interface ResourceExtensionPaths {
	skillPaths?: ResourceExtensionPath[];
	promptPaths?: ResourceExtensionPath[];
}

/** 扩展装载结果；本课默认返回空，课程 20 提供真实实现。 */
export interface LoadExtensionsResult {
	extensions: unknown[];
	errors: Array<{ path: string; error: string }>;
	runtime: unknown;
}

export type ExtensionsLoader = (paths: string[]) => Promise<LoadExtensionsResult> | LoadExtensionsResult;

export interface PromptsSnapshot {
	prompts: PromptTemplate[];
	diagnostics: ResourceDiagnostic[];
}

export interface AgentsFilesSnapshot {
	agentsFiles: ContextFile[];
}

export interface ResourceLoaderOptions {
	/** 项目目录，用于加载项目级规则、技能与模板。 */
	projectDir: string;
	/** 用户配置目录；省略时用 `~/.pipi/agent`。 */
	agentDir?: string;
	/** 资源设置快照；省略时按目录生成默认值。 */
	settings?: ResourceSettings;
	/** 生成默认设置时使用的信任状态。 */
	projectTrusted?: boolean;
	noExtensions?: boolean;
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	noContextFiles?: boolean;
	additionalExtensionPaths?: string[];
	additionalSkillPaths?: string[];
	additionalPromptTemplatePaths?: string[];
	/** 覆盖系统提示；可传文本或文件路径。 */
	systemPrompt?: string;
	/** 追加到系统提示的内容；每项可以是文本或文件路径。 */
	appendSystemPrompt?: string[];
	// xxxOverride是函数，在各资源的最后一步进行修改
	extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	skillsOverride?: (base: LoadSkillsResult) => LoadSkillsResult;
	promptsOverride?: (base: PromptsSnapshot) => PromptsSnapshot;
	agentsFilesOverride?: (base: AgentsFilesSnapshot) => AgentsFilesSnapshot;
	systemPromptOverride?: (base: string | undefined) => string | undefined;
	appendSystemPromptOverride?: (base: string[]) => string[];
	/** 扩展装载接缝；课程 20 接入真实扩展系统。 */
	loadExtensions?: ExtensionsLoader;
}

interface ResolvedInput {
	text: string;
	sourcePath?: string;
}

function resolveInput(input: string | undefined, description: string): ResolvedInput | undefined {
	if (!input) return undefined;
	if (existsSync(input)) {
		try {
			return { text: stripBom(readFileSync(input, "utf-8")), sourcePath: resolvePath(input) };
		} catch (error) {
			console.error(`Warning: Could not read ${description} file ${input}: ${error}`);
			return { text: input };
		}
	}
	return { text: input };
}

function emptyExtensionsResult(): LoadExtensionsResult {
	return { extensions: [], errors: [], runtime: {} };
}

/**
 * 资源加载器：按 resolver 的结果装载技能、模板、项目规则与系统提示。
 * 构造函数只保存配置，`reload()` 才读取磁盘。
 */
export class ResourceLoader {
	private readonly projectDir: string;
	private readonly agentDir: string;
	private readonly options: ResourceLoaderOptions;
	private readonly settings: ResourceSettings;

	private extensionsResult: LoadExtensionsResult = emptyExtensionsResult();
	private skillsResult: LoadSkillsResult = { skills: [], diagnostics: [] };
	private promptsResult: PromptsSnapshot = { prompts: [], diagnostics: [] };
	private agentsFilesResult: AgentsFilesSnapshot = { agentsFiles: [] };
	private systemPrompt: string | undefined;
	private systemPromptSourcePath: string | undefined;
	private appendSystemPrompt: string[] = [];
	private appendSystemPromptSourcePaths: string[] = [];

	private metadataByPath = new Map<string, PathMetadata>();
	private lastSkillPaths: string[] = [];
	private lastPromptPaths: string[] = [];

	constructor(options: ResourceLoaderOptions) {
		this.projectDir = resolvePath(options.settings?.projectDir ?? options.projectDir);
		this.agentDir = resolvePath(options.settings?.agentDir ?? options.agentDir ?? getDefaultAgentDir());
		this.options = options;
		this.settings =
			options.settings ??
			createResourceSettings({
				projectDir: this.projectDir,
				agentDir: this.agentDir,
				projectTrusted: options.projectTrusted,
			});
	}

	/**
	 * 全量重载。
	 *
	 * 顺序：
	 * 1. resolver 重新计算路径、enabled 与来源
	 * 2. 扩展（本课是接缝，课程 20 接入真实装载）
	 * 3. 技能
	 * 4. 命令模板
	 * 5. 项目规则
	 * 6. 系统提示与追加提示来源
	 *
	 * 每类资源装载后立即套用 override，并写入实例状态。
	 */
	async reload(): Promise<void> {
		// 用ResourceResolver解析一次路径
		const resolved = await new ResourceResolver(this.settings).resolve();

		// 记录所有已解析路径的metadata
		this.metadataByPath = new Map();
		for (const list of [resolved.extensions, resolved.skills, resolved.prompts]) {
			for (const entry of list) {
				if (!this.metadataByPath.has(entry.path)) this.metadataByPath.set(entry.path, entry.metadata);
			}
		}

		// extension
		// resolve得到的enabled的extension
		const enabledExtensions = resolved.extensions.filter((entry) => entry.enabled).map((entry) => entry.path);

		// option里附带的extension，比如--extension启用的
		const additionalExtensions = (this.options.additionalExtensionPaths ?? [])
			.filter(isLocalPath) // 过滤掉非本地路径
			.map((path) => this.resolveResourcePath(path));

		// 汇总扩展的路径
		const extensionPaths = this.options.noExtensions
			? additionalExtensions
			: this.mergePaths(additionalExtensions, enabledExtensions);

		await this.updateExtensionsFromPaths(extensionPaths);

		// skill
		const enabledSkills = resolved.skills.filter((entry) => entry.enabled).map((entry) => entry.path);
		this.lastSkillPaths = this.mergePaths(
			this.options.noSkills ? [] : enabledSkills,
			this.options.additionalSkillPaths ?? [],
		);
		this.updateSkillsFromPaths(this.lastSkillPaths);
		this.skillsResult.diagnostics.push(
			...this.missingAdditionalPathDiagnostics(
				"Skill",
				this.options.additionalSkillPaths,
				this.skillsResult.diagnostics,
			),
		);

		// 命令模板：按名去重后写入 promptDiagnostics
		const enabledPrompts = resolved.prompts.filter((entry) => entry.enabled).map((entry) => entry.path);
		this.lastPromptPaths = this.mergePaths(
			this.options.noPromptTemplates ? [] : enabledPrompts,
			this.options.additionalPromptTemplatePaths ?? [],
		);
		this.updatePromptsFromPaths(this.lastPromptPaths);
		this.promptsResult.diagnostics.push(
			...this.missingAdditionalPathDiagnostics(
				"Prompt template",
				this.options.additionalPromptTemplatePaths,
				this.promptsResult.diagnostics,
			),
		);

		// 项目规则：loader 自己向上查找，resolver 不参与
		this.updateAgentsFiles();

		// 系统提示与追加提示：显式来源优先，否则查找 SYSTEM.md / APPEND_SYSTEM.md
		this.updateSystemPrompts();
	}

	/** 运行中追加技能或命令模板路径；只更新对应资源。 */
	extendResources(paths: ResourceExtensionPaths): void {
		const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);

		for (const entry of skillPaths) {
			if (!this.metadataByPath.has(entry.path)) this.metadataByPath.set(entry.path, entry.metadata);
		}
		for (const entry of promptPaths) {
			if (!this.metadataByPath.has(entry.path)) this.metadataByPath.set(entry.path, entry.metadata);
		}

		if (skillPaths.length > 0) {
			this.lastSkillPaths = this.mergePaths(
				this.lastSkillPaths,
				skillPaths.map((entry) => entry.path),
			);
			this.updateSkillsFromPaths(this.lastSkillPaths);
		}

		if (promptPaths.length > 0) {
			this.lastPromptPaths = this.mergePaths(
				this.lastPromptPaths,
				promptPaths.map((entry) => entry.path),
			);
			this.updatePromptsFromPaths(this.lastPromptPaths);
		}
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	getSkills(): LoadSkillsResult {
		return this.skillsResult;
	}

	getPrompts(): PromptsSnapshot {
		return this.promptsResult;
	}

	getAgentsFiles(): AgentsFilesSnapshot {
		return this.agentsFilesResult;
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	getSystemPromptSource(): { path: string } | undefined {
		return this.systemPromptSourcePath ? { path: this.systemPromptSourcePath } : undefined;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	getAppendSystemPromptSources(): Array<{ path: string }> {
		return this.appendSystemPromptSourcePaths.map((path) => ({ path }));
	}

	private updateAgentsFiles(): void {
		const base: AgentsFilesSnapshot = {
			agentsFiles: this.options.noContextFiles
				? []
				: loadProjectContextFiles({ projectDir: this.projectDir, agentDir: this.agentDir }),
		};
		this.agentsFilesResult = this.options.agentsFilesOverride ? this.options.agentsFilesOverride(base) : base;
	}

	private updateSystemPrompts(): void {
		const systemPromptSource = this.options.systemPrompt ?? this.discoverSystemPromptFile();
		const systemPrompt = resolveInput(systemPromptSource, "system prompt")?.text;
		this.systemPrompt = this.options.systemPromptOverride
			? this.options.systemPromptOverride(systemPrompt)
			: systemPrompt;
		this.systemPromptSourcePath =
			systemPromptSource && existsSync(systemPromptSource) ? resolvePath(systemPromptSource) : undefined;

		let appendSources = this.options.appendSystemPrompt;
		if (!appendSources) {
			const discovered = this.discoverAppendSystemPromptFile();
			appendSources = discovered ? [discovered] : [];
		}
		const appendTexts = appendSources
			.map((source) => resolveInput(source, "append system prompt")?.text)
			.filter((text): text is string => text !== undefined);
		this.appendSystemPrompt = this.options.appendSystemPromptOverride
			? this.options.appendSystemPromptOverride(appendTexts)
			: appendTexts;
		this.appendSystemPromptSourcePaths = appendSources
			.filter((source) => existsSync(source))
			.map((source) => resolvePath(source));
	}

	private async updateExtensionsFromPaths(extensionPaths: string[]): Promise<void> {
		const loaded = await (this.options.loadExtensions ?? emptyExtensionsResult)(extensionPaths);
		for (const path of this.options.additionalExtensionPaths ?? []) {
			if (!isLocalPath(path)) continue;
			const resolvedPath = this.resolveResourcePath(path);
			if (!existsSync(resolvedPath)) {
				loaded.errors.push({ path: resolvedPath, error: `Extension path does not exist: ${resolvedPath}` });
			}
		}
		this.extensionsResult = this.options.extensionsOverride ? this.options.extensionsOverride(loaded) : loaded;
	}

	private updateSkillsFromPaths(skillPaths: string[]): void {
		const result: LoadSkillsResult =
			this.options.noSkills && skillPaths.length === 0
				? { skills: [], diagnostics: [] }
				: loadSkills({
						projectDir: this.projectDir,
						agentDir: this.agentDir,
						skillPaths,
						includeDefaults: false,
					});
		const resolved = this.options.skillsOverride ? this.options.skillsOverride(result) : result;
		this.skillsResult = {
			skills: resolved.skills.map((skill) => ({
				...skill,
				sourceInfo:
					this.findSourceInfoForPath(skill.filePath) ??
					skill.sourceInfo ??
					this.getDefaultSourceInfoForPath(skill.filePath),
			})),
			diagnostics: resolved.diagnostics,
		};
	}

	private updatePromptsFromPaths(promptPaths: string[]): void {
		const result: PromptsSnapshot =
			this.options.noPromptTemplates && promptPaths.length === 0
				? { prompts: [], diagnostics: [] }
				: this.dedupePrompts(
						loadPromptTemplates({
							projectDir: this.projectDir,
							agentDir: this.agentDir,
							promptPaths,
							includeDefaults: false,
						}),
					);
		const resolved = this.options.promptsOverride ? this.options.promptsOverride(result) : result;
		this.promptsResult = {
			prompts: resolved.prompts.map((prompt) => ({
				...prompt,
				sourceInfo:
					this.findSourceInfoForPath(prompt.filePath) ??
					prompt.sourceInfo ??
					this.getDefaultSourceInfoForPath(prompt.filePath),
			})),
			diagnostics: resolved.diagnostics,
		};
	}

	private dedupePrompts(prompts: PromptTemplate[]): PromptsSnapshot {
		const seen = new Map<string, PromptTemplate>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const prompt of prompts) {
			const existing = seen.get(prompt.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "/${prompt.name}" collision`,
					path: prompt.filePath,
					collision: {
						resourceType: "prompt",
						name: prompt.name,
						winnerPath: existing.filePath,
						loserPath: prompt.filePath,
						winnerSource: existing.sourceInfo.source,
						loserSource: prompt.sourceInfo.source,
					},
				});
			} else {
				seen.set(prompt.name, prompt);
			}
		}

		return { prompts: Array.from(seen.values()), diagnostics };
	}

	private findSourceInfoForPath(resourcePath: string): SourceInfo | undefined {
		if (!resourcePath) return undefined;
		if (resourcePath.startsWith("<")) return this.getDefaultSourceInfoForPath(resourcePath);

		const normalizedResourcePath = resolvePath(resourcePath);
		const exact = this.metadataByPath.get(normalizedResourcePath) ?? this.metadataByPath.get(resourcePath);
		if (exact) return createSourceInfo(resourcePath, exact);

		for (const [sourcePath, metadata] of this.metadataByPath.entries()) {
			const normalizedSourcePath = resolvePath(sourcePath);
			if (
				normalizedResourcePath === normalizedSourcePath ||
				normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
			) {
				return createSourceInfo(resourcePath, metadata);
			}
		}

		return undefined;
	}

	private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
		if (filePath.startsWith("<") && filePath.endsWith(">")) {
			return createSyntheticSourceInfo(filePath, {
				source: filePath.slice(1, -1).split(":")[0] || "temporary",
				scope: "temporary",
				origin: "top-level",
			});
		}

		const agentRoots = [
			join(this.agentDir, "skills"),
			join(this.agentDir, "prompts"),
			join(this.agentDir, "extensions"),
		];
		const projectRoots = [
			join(this.projectDir, PROJECT_CONFIG_DIR, "skills"),
			join(this.projectDir, PROJECT_CONFIG_DIR, "prompts"),
			join(this.projectDir, PROJECT_CONFIG_DIR, "extensions"),
		];

		for (const root of agentRoots) {
			if (isUnderPath(filePath, root)) {
				return createSyntheticSourceInfo(filePath, { source: "local", scope: "agent", baseDir: root });
			}
		}
		for (const root of projectRoots) {
			if (isUnderPath(filePath, root)) {
				return createSyntheticSourceInfo(filePath, { source: "local", scope: "project", baseDir: root });
			}
		}

		let isDirectory = false;
		try {
			isDirectory = statSync(filePath).isDirectory();
		} catch {
			// 路径不存在时按文件处理
		}
		return createSyntheticSourceInfo(filePath, {
			source: "local",
			baseDir: isDirectory ? filePath : dirname(filePath),
		});
	}

	private normalizeExtensionPaths(entries: ResourceExtensionPath[]): ResourceExtensionPath[] {
		return entries.map((entry) => ({
			path: this.resolveResourcePath(entry.path),
			metadata: entry.metadata.baseDir
				? { ...entry.metadata, baseDir: this.resolveResourcePath(entry.metadata.baseDir) }
				: entry.metadata,
		}));
	}

	private mergePaths(primary: string[], additional: string[]): string[] {
		const merged: string[] = [];
		const seen = new Set<string>();
		for (const path of [...primary, ...additional]) {
			const resolvedPath = this.resolveResourcePath(path);
			const canonicalPath = canonicalizePath(resolvedPath);
			if (seen.has(canonicalPath)) continue;
			seen.add(canonicalPath);
			merged.push(resolvedPath);
		}
		return merged;
	}

	private resolveResourcePath(path: string): string {
		return resolvePath(path, this.projectDir, { trim: true });
	}

	private missingAdditionalPathDiagnostics(
		label: string,
		paths: string[] | undefined,
		existing: ResourceDiagnostic[],
	): ResourceDiagnostic[] {
		const diagnostics: ResourceDiagnostic[] = [];
		for (const path of paths ?? []) {
			if (!isLocalPath(path)) continue;
			const resolvedPath = this.resolveResourcePath(path);
			if (existsSync(resolvedPath)) continue;
			if (existing.some((diagnostic) => diagnostic.path === resolvedPath)) continue;
			if (diagnostics.some((diagnostic) => diagnostic.path === resolvedPath)) continue;
			diagnostics.push({ type: "error", message: `${label} path does not exist`, path: resolvedPath });
		}
		return diagnostics;
	}

	private discoverSystemPromptFile(): string | undefined {
		const projectPath = join(this.projectDir, PROJECT_CONFIG_DIR, "SYSTEM.md");
		if (this.settings.projectTrusted && existsSync(projectPath)) return projectPath;

		const agentPath = join(this.agentDir, "SYSTEM.md");
		if (existsSync(agentPath)) return agentPath;

		return undefined;
	}

	private discoverAppendSystemPromptFile(): string | undefined {
		const projectPath = join(this.projectDir, PROJECT_CONFIG_DIR, "APPEND_SYSTEM.md");
		if (this.settings.projectTrusted && existsSync(projectPath)) return projectPath;

		const agentPath = join(this.agentDir, "APPEND_SYSTEM.md");
		if (existsSync(agentPath)) return agentPath;

		return undefined;
	}
}
