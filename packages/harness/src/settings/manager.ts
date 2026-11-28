import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { PROJECT_CONFIG_DIR } from "../config.ts";
import { normalizePath, resolvePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import type { DefaultProjectTrust, Settings, SettingsError, SettingsScope } from "./types.ts";

export interface SettingsManagerCreateOptions {
	/** 项目是否可信；false 时完全不读项目层，默认 true。 */
	projectTrusted?: boolean;
}

/** 读写一个作用域的 settings 文件；回调返回 undefined 表示不写。 */
export interface SettingsStorage {
	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void;
}

/** 两个 settings 文件的路径，仅用于错误提示。 */
type SettingsPaths = Partial<Record<SettingsScope, string>>;

/** 把任意异常包装成带作用域与路径的 SettingsError。 */
function toSettingsError(scope: SettingsScope, error: unknown, path?: string): SettingsError {
	return {
		scope,
		...(path ? { path } : {}),
		error: error instanceof Error ? error : new Error(String(error)),
	};
}

/** 普通对象才递归合并；数组与 null 直接覆盖。 */
function isMergeableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 递归合并对象，overrides 优先；undefined 不覆盖已有值。 */
function deepMergeObjects(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
	const result = { ...base };
	for (const key of Object.keys(overrides)) {
		const overrideValue = overrides[key];
		if (overrideValue === undefined) continue;
		const baseValue = base[key];
		result[key] =
			isMergeableObject(baseValue) && isMergeableObject(overrideValue)
				? deepMergeObjects(baseValue, overrideValue)
				: overrideValue;
	}
	return result;
}

/** settings 的深合并：项目层或 overrides 覆盖 agent 层。 */
function deepMergeSettings(base: Settings, overrides: Settings): Settings {
	return deepMergeObjects(base as Record<string, unknown>, overrides as Record<string, unknown>) as Settings;
}

/** 文件系统存储：agent 级与项目级各一个 settings.json。 */
/**
 * 文件系统存储：agent 级与项目级各一个 settings.json。
 * 读写都走 withLock，保证同进程串行与跨进程互斥。
 */
export class FileSettingsStorage implements SettingsStorage {
	/** `~/.pipi/agent/settings.json`。 */
	private agentSettingsPath: string;
	/** `<projectDir>/.pipi/settings.json`。 */
	private projectSettingsPath: string;

	constructor(projectDir: string, agentDir: string) {
		this.agentSettingsPath = join(resolvePath(agentDir), "settings.json");
		this.projectSettingsPath = join(resolvePath(projectDir), PROJECT_CONFIG_DIR, "settings.json");
	}

	/** 同步获取文件锁；被占用时自旋重试，返回释放函数。 */
	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) throw error;
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// 同步忙等，避免把调用方改成异步
				}
			}
		}

		throw lastError instanceof Error ? lastError : new Error("Failed to acquire settings lock");
	}

	/**
	 * 加锁读写一个作用域：
	 * - 文件存在时先加锁再读
	 * - fn 返回 undefined 表示只读
	 * - 需要写入时再确保锁与目录存在
	 */
	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const path = scope === "agent" ? this.agentSettingsPath : this.projectSettingsPath;
		const dir = dirname(path);
		let release: (() => void) | undefined;

		try {
			const fileExists = existsSync(path);
			if (fileExists) release = this.acquireLockSyncWithRetry(path);
			const current = fileExists ? readFileSync(path, "utf-8") : undefined;
			const next = fn(current);
			if (next !== undefined) {
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				if (!release) release = this.acquireLockSyncWithRetry(path);
				writeFileSync(path, next, "utf-8");
			}
		} finally {
			release?.();
		}
	}
}

/** 内存存储，供测试与 `SettingsManager.inMemory()` 使用。 */
export class InMemorySettingsStorage implements SettingsStorage {
	/** agent 级文件的当前内容。 */
	private agent: string | undefined;
	/** 项目级文件的当前内容。 */
	private project: string | undefined;

	withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
		const current = scope === "agent" ? this.agent : this.project;
		const next = fn(current);
		if (next === undefined) return;
		if (scope === "agent") this.agent = next;
		else this.project = next;
	}
}

/**
 * 配置管理器：加载 agent 与项目两层 settings，深合并后对外提供。
 *
 * - 项目未信任时完全不读项目层
 * - 只把本次修改过的字段写回文件，避免覆盖用户手写内容
 * - 写盘进入串行队列，文件锁处理跨进程并发
 * - 解析失败记录为 SettingsError，启动不中断
 */
export class SettingsManager {
	/** 底层存储后端：文件系统或内存。 */
	private storage: SettingsStorage;
	/** agent 级原始设置（未合并）。 */
	private agentSettings: Settings;
	/** 项目级原始设置（未合并）；未信任时为空。 */
	private projectSettings: Settings;
	/** 对外的合并结果：agent + 项目覆盖。 */
	private settings: Settings;
	/** 项目是否可信，决定项目层是否参与读取与写入。 */
	private projectTrusted: boolean;
	/** 本次运行改过的 agent 级字段。 */
	private modifiedAgentFields = new Set<keyof Settings>();
	/** agent 级嵌套字段的改动子键，例如 `compaction.enabled`。 */
	private modifiedAgentNestedFields = new Map<keyof Settings, Set<string>>();
	/** 本次运行改过的项目级字段。 */
	private modifiedProjectFields = new Set<keyof Settings>();
	/** 项目级嵌套字段的改动子键。 */
	private modifiedProjectNestedFields = new Map<keyof Settings, Set<string>>();
	/** agent 文件解析失败；失败后不再覆盖该文件。 */
	private agentSettingsLoadError: Error | null = null;
	/** 项目文件解析失败；失败后不再覆盖该文件。 */
	private projectSettingsLoadError: Error | null = null;
	/** 串行写队列，避免并发修改互相覆盖。 */
	private writeQueue: Promise<void> = Promise.resolve();
	/** 本次运行收集的读取/写入错误，由 drainErrors 取走。 */
	private errors: SettingsError[];
	/** 两个 settings 文件路径，仅用于错误信息。 */
	private settingsPaths: SettingsPaths;
	/** 当前项目目录。 */
	private projectDir: string;
	/** agent 配置目录。 */
	private agentDir: string;

	/**
	 * 构造函数只组装初始状态，不做磁盘 I/O。
	 * 初始化后立即计算一次合并设置。
	 */
	private constructor(
		storage: SettingsStorage,
		initialAgent: Settings,
		initialProject: Settings,
		projectDir: string,
		agentDir: string,
		agentLoadError: Error | null = null,
		projectLoadError: Error | null = null,
		initialErrors: SettingsError[] = [],
		projectTrusted = true,
		settingsPaths: SettingsPaths = {},
	) {
		this.storage = storage;
		this.agentSettings = initialAgent;
		this.projectSettings = initialProject;
		this.projectDir = resolvePath(projectDir);
		this.agentDir = resolvePath(agentDir);
		this.projectTrusted = projectTrusted;
		this.agentSettingsLoadError = agentLoadError;
		this.projectSettingsLoadError = projectLoadError;
		this.errors = [...initialErrors];
		this.settingsPaths = settingsPaths;
		this.settings = deepMergeSettings(this.agentSettings, this.projectSettings);
	}

	static create(projectDir: string, agentDir: string, options: SettingsManagerCreateOptions = {}): SettingsManager {
		const resolvedProjectDir = resolvePath(projectDir);
		const resolvedAgentDir = resolvePath(agentDir);
		const storage = new FileSettingsStorage(resolvedProjectDir, resolvedAgentDir);
		return SettingsManager.fromStorageWithPaths(storage, resolvedProjectDir, resolvedAgentDir, options, {
			agent: join(resolvedAgentDir, "settings.json"),
			project: join(resolvedProjectDir, PROJECT_CONFIG_DIR, "settings.json"),
		});
	}

	/** 用自定义存储创建，便于测试或替换 I/O。 */
	static fromStorage(
		storage: SettingsStorage,
		projectDir: string,
		agentDir: string,
		options: SettingsManagerCreateOptions = {},
	): SettingsManager {
		return SettingsManager.fromStorageWithPaths(storage, projectDir, agentDir, options);
	}

	/** 创建内存实例；默认把传入内容写进 agent 层。 */
	static inMemory(
		settings: Partial<Settings> = {},
		options: SettingsManagerCreateOptions = {},
		projectDir = process.cwd(),
		agentDir = join(projectDir, ".pipi-agent"),
	): SettingsManager {
		const storage = new InMemorySettingsStorage();
		const initial = structuredClone(settings) as Settings;
		storage.withLock("agent", () => JSON.stringify(initial, null, 2));
		return SettingsManager.fromStorageWithPaths(storage, projectDir, agentDir, options);
	}

	private static fromStorageWithPaths(
		storage: SettingsStorage,
		projectDir: string,
		agentDir: string,
		options: SettingsManagerCreateOptions,
		settingsPaths: SettingsPaths = {},
	): SettingsManager {
		const projectTrusted = options.projectTrusted ?? true;
		const agentLoad = SettingsManager.tryLoadFromStorage(storage, "agent");
		const projectLoad = SettingsManager.tryLoadFromStorage(storage, "project", projectTrusted);
		const initialErrors: SettingsError[] = [];
		if (agentLoad.error) initialErrors.push(toSettingsError("agent", agentLoad.error, settingsPaths.agent));
		if (projectLoad.error) initialErrors.push(toSettingsError("project", projectLoad.error, settingsPaths.project));

		return new SettingsManager(
			storage,
			agentLoad.settings,
			projectLoad.settings,
			projectDir,
			agentDir,
			agentLoad.error,
			projectLoad.error,
			initialErrors,
			projectTrusted,
			settingsPaths,
		);
	}

	/**
	 * 容错读取一个作用域。
	 * 未信任的项目层直接返回空；解析失败返回空设置与错误，由调用方记录。
	 */
	private static tryLoadFromStorage(
		storage: SettingsStorage,
		scope: SettingsScope,
		projectTrusted = true,
	): { settings: Settings; error: Error | null } {
		try {
			if (scope === "project" && !projectTrusted) return { settings: {}, error: null };

			let content: string | undefined;
			storage.withLock(scope, (current) => {
				content = current;
				return undefined;
			});
			if (!content) return { settings: {}, error: null };
			return { settings: JSON.parse(stripBom(content)) as Settings, error: null };
		} catch (error) {
			return { settings: {}, error: error as Error };
		}
	}

	/** 当前项目目录。 */
	getProjectDir(): string {
		return this.projectDir;
	}

	/** agent 配置目录。 */
	getAgentDir(): string {
		return this.agentDir;
	}

	// ---------------------------------------------------------------------
	// 原始层与合并结果
	// ---------------------------------------------------------------------

	/** agent 层原始设置（拷贝，避免外部直接改内部状态）。 */
	getAgentSettings(): Settings {
		return structuredClone(this.agentSettings);
	}

	/** 项目层原始设置；未信任时为空对象。 */
	getProjectSettings(): Settings {
		return structuredClone(this.projectSettings);
	}

	/** 合并后的最终设置：项目覆盖 agent。 */
	getSettings(): Settings {
		return structuredClone(this.settings);
	}

	/** 项目当前是否可信。 */
	isProjectTrusted(): boolean {
		return this.projectTrusted;
	}

	/**
	 * 切换项目信任状态。
	 * 从信任变为不信任时清空项目层；反向切换会重新读取项目文件。
	 */
	setProjectTrusted(trusted: boolean): void {
		if (this.projectTrusted === trusted) return;
		this.projectTrusted = trusted;

		if (!trusted) {
			this.projectSettings = {};
			this.settings = deepMergeSettings(this.agentSettings, this.projectSettings);
			return;
		}

		const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", trusted);
		this.projectSettings = projectLoad.settings;
		if (projectLoad.error) this.recordError("project", projectLoad.error);
		this.settings = deepMergeSettings(this.agentSettings, this.projectSettings);
	}

	/** 等待写队列清空后重新读取两层文件；访问期间的外部修改会在此生效。 */
	async reload(): Promise<void> {
		await this.writeQueue;
		const agentLoad = SettingsManager.tryLoadFromStorage(this.storage, "agent");
		if (!agentLoad.error) {
			this.agentSettings = agentLoad.settings;
			this.agentSettingsLoadError = null;
		} else {
			this.agentSettingsLoadError = agentLoad.error;
			this.recordError("agent", agentLoad.error);
		}

		this.modifiedAgentFields.clear();
		this.modifiedAgentNestedFields.clear();

		const projectLoad = SettingsManager.tryLoadFromStorage(this.storage, "project", this.projectTrusted);
		if (!projectLoad.error) {
			this.projectSettings = projectLoad.settings;
		} else {
			this.recordError("project", projectLoad.error);
		}

		this.settings = deepMergeSettings(this.agentSettings, this.projectSettings);
	}

	/** 仅在内存中叠加临时覆盖，不写回文件。 */
	applyOverrides(overrides: Partial<Settings>): void {
		this.settings = deepMergeSettings(this.settings, overrides as Settings);
	}

	// ---------------------------------------------------------------------
	// 信任与模型
	// ---------------------------------------------------------------------

	/** 默认信任策略只读 agent 层；项目不能决定自己是否被信任。 */
	getDefaultProjectTrust(): DefaultProjectTrust {
		const value = this.agentSettings.defaultProjectTrust;
		return value ?? "ask";
	}

	setDefaultProjectTrust(value: DefaultProjectTrust): void {
		this.agentSettings.defaultProjectTrust = value;
		this.markAgentModified("defaultProjectTrust");
		this.save();
	}

	/** 当前默认模型 ID；项目层可覆盖 agent 层。 */
	getDefaultModel(): string | undefined {
		return this.settings.defaultModel;
	}

	/** 修改默认模型；只写 agent 层。 */
	setDefaultModel(modelId: string): void {
		this.agentSettings.defaultModel = modelId;
		this.markAgentModified("defaultModel");
		this.save();
	}

	/** 修改默认 provider；只写 agent 层。 */
	setDefaultProvider(provider: string): void {
		this.agentSettings.defaultProvider = provider;
		this.markAgentModified("defaultProvider");
		this.save();
	}

	setDefaultModelAndProvider(provider: string, modelId: string): void {
		this.agentSettings.defaultProvider = provider;
		this.agentSettings.defaultModel = modelId;
		this.markAgentModified("defaultProvider");
		this.markAgentModified("defaultModel");
		this.save();
	}

	/** 默认思考档位。 */
	getDefaultThinkingLevel() {
		return this.settings.defaultThinkingLevel;
	}

	setDefaultThinkingLevel(level: NonNullable<Settings["defaultThinkingLevel"]>): void {
		this.agentSettings.defaultThinkingLevel = level;
		this.markAgentModified("defaultThinkingLevel");
		this.save();
	}

	getModelThinkingLevel(provider: string, modelId: string) {
		return this.settings.modelThinkingLevels?.[`${provider}/${modelId}`];
	}

	setModelThinkingLevel(
		provider: string,
		modelId: string,
		level: NonNullable<Settings["defaultThinkingLevel"]>,
	): void {
		if (!this.agentSettings.modelThinkingLevels) this.agentSettings.modelThinkingLevels = {};
		this.agentSettings.modelThinkingLevels[`${provider}/${modelId}`] = level;
		this.markAgentModified("modelThinkingLevels");
		this.save();
	}

	// ---------------------------------------------------------------------
	// 会话与队列
	// ---------------------------------------------------------------------

	/** 当前传输方式，默认 auto。 */
	getTransport(): NonNullable<Settings["transport"]> {
		return this.settings.transport ?? "auto";
	}

	setTransport(transport: NonNullable<Settings["transport"]>): void {
		this.agentSettings.transport = transport;
		this.markAgentModified("transport");
		this.save();
	}

	/** 自定义会话目录；设置了就展开 `~` 并规范化。 */
	getSessionDir(): string | undefined {
		const sessionDir = this.settings.sessionDir;
		return sessionDir ? normalizePath(sessionDir) : sessionDir;
	}

	getSteeringMode(): "all" | "single" {
		return this.settings.steeringMode ?? "single";
	}

	setSteeringMode(mode: "all" | "single"): void {
		this.agentSettings.steeringMode = mode;
		this.markAgentModified("steeringMode");
		this.save();
	}

	getFollowUpMode(): "all" | "single" {
		return this.settings.followUpMode ?? "single";
	}

	setFollowUpMode(mode: "all" | "single"): void {
		this.agentSettings.followUpMode = mode;
		this.markAgentModified("followUpMode");
		this.save();
	}

	getTheme(): string | undefined {
		return typeof this.settings.theme === "string" ? this.settings.theme : undefined;
	}

	setTheme(theme: string): void {
		this.agentSettings.theme = theme;
		this.markAgentModified("theme");
		this.save();
	}

	// ---------------------------------------------------------------------
	// 长会话：压缩、分支摘要、重试
	// ---------------------------------------------------------------------

	/** 是否启用自动压缩，默认 true。 */
	getCompactionEnabled(): boolean {
		return this.settings.compaction?.enabled ?? true;
	}

	setCompactionEnabled(enabled: boolean): void {
		if (!this.agentSettings.compaction) this.agentSettings.compaction = {};
		this.agentSettings.compaction.enabled = enabled;
		this.markAgentModified("compaction", "enabled");
		this.save();
	}

	getCompactionReserveTokens(): number {
		return this.settings.compaction?.reserveTokens ?? 16384;
	}

	getCompactionKeepRecentTokens(): number {
		return this.settings.compaction?.keepRecentTokens ?? 20000;
	}

	/** 压缩设置，已填好默认值。 */
	getCompactionSettings(): { enabled: boolean; reserveTokens: number; keepRecentTokens: number } {
		return {
			enabled: this.getCompactionEnabled(),
			reserveTokens: this.getCompactionReserveTokens(),
			keepRecentTokens: this.getCompactionKeepRecentTokens(),
		};
	}

	/** 分支摘要设置，已填好默认值。 */
	getBranchSummarySettings(): { reserveTokens: number; skipPrompt: boolean } {
		return {
			reserveTokens: this.settings.branchSummary?.reserveTokens ?? 16384,
			skipPrompt: this.settings.branchSummary?.skipPrompt ?? false,
		};
	}

	setRetryEnabled(enabled: boolean): void {
		if (!this.agentSettings.retry) this.agentSettings.retry = {};
		this.agentSettings.retry.enabled = enabled;
		this.markAgentModified("retry", "enabled");
		this.save();
	}

	/** 摘要/模型调用重试设置，已填好默认值。 */
	getRetrySettings(): { enabled: boolean; maxRetries: number; baseDelayMs: number } {
		return {
			enabled: this.settings.retry?.enabled ?? true,
			maxRetries: this.settings.retry?.maxRetries ?? 3,
			baseDelayMs: this.settings.retry?.baseDelayMs ?? 2000,
		};
	}

	/** provider HTTP 层重试设置；未配置的项保持 undefined。 */
	getProviderRetrySettings(): { timeoutMs?: number; maxRetries?: number; maxRetryDelayMs: number } {
		return {
			timeoutMs: this.settings.retry?.provider?.timeoutMs,
			maxRetries: this.settings.retry?.provider?.maxRetries,
			maxRetryDelayMs: this.settings.retry?.provider?.maxRetryDelayMs ?? 60000,
		};
	}

	// ---------------------------------------------------------------------
	// 资源：packages、extensions、skills、prompts
	// ---------------------------------------------------------------------

	/** 配置的包来源列表（拷贝）。 */
	getPackages() {
		return [...(this.settings.packages ?? [])];
	}

	setPackages(packages: NonNullable<Settings["packages"]>): void {
		this.agentSettings.packages = packages;
		this.markAgentModified("packages");
		this.save();
	}

	/** 写项目层的包来源；未信任时抛错。 */
	setProjectPackages(packages: NonNullable<Settings["packages"]>): void {
		this.updateProjectSettings("packages", (settings) => {
			settings.packages = packages;
		});
	}

	/** agent 与项目合并后的扩展路径。 */
	getExtensionPaths(): string[] {
		return [...(this.settings.extensions ?? [])];
	}

	setExtensionPaths(paths: string[]): void {
		this.agentSettings.extensions = paths;
		this.markAgentModified("extensions");
		this.save();
	}

	/** 写项目层的扩展路径；未信任时抛错。 */
	setProjectExtensionPaths(paths: string[]): void {
		this.updateProjectSettings("extensions", (settings) => {
			settings.extensions = paths;
		});
	}

	/** agent 与项目合并后的技能路径。 */
	getSkillPaths(): string[] {
		return [...(this.settings.skills ?? [])];
	}

	setSkillPaths(paths: string[]): void {
		this.agentSettings.skills = paths;
		this.markAgentModified("skills");
		this.save();
	}

	/** 写项目层的技能路径；未信任时抛错。 */
	setProjectSkillPaths(paths: string[]): void {
		this.updateProjectSettings("skills", (settings) => {
			settings.skills = paths;
		});
	}

	/** agent 与项目合并后的命令模板路径。 */
	getPromptTemplatePaths(): string[] {
		return [...(this.settings.prompts ?? [])];
	}

	setPromptTemplatePaths(paths: string[]): void {
		this.agentSettings.prompts = paths;
		this.markAgentModified("prompts");
		this.save();
	}

	/** 写项目层的模板路径；未信任时抛错。 */
	setProjectPromptTemplatePaths(paths: string[]): void {
		this.updateProjectSettings("prompts", (settings) => {
			settings.prompts = paths;
		});
	}

	getEnableSkillCommands(): boolean {
		return this.settings.enableSkillCommands ?? true;
	}

	// ---------------------------------------------------------------------
	// 工具、界面与启动
	// ---------------------------------------------------------------------

	/** 默认启用的工具名；未配置时返回 undefined，由调用方决定默认集合。 */
	getDefaultTools(): string[] | undefined {
		const tools = this.settings.defaultTools;
		return tools ? [...tools] : undefined;
	}

	/** 自定义 shell 路径；设置了就展开 `~`。 */
	getShellPath(): string | undefined {
		const shellPath = this.settings.shellPath;
		return shellPath ? normalizePath(shellPath) : shellPath;
	}

	setShellPath(path: string | undefined): void {
		this.agentSettings.shellPath = path;
		this.markAgentModified("shellPath");
		this.save();
	}

	getShellCommandPrefix(): string | undefined {
		return this.settings.shellCommandPrefix;
	}

	setShellCommandPrefix(prefix: string | undefined): void {
		this.agentSettings.shellCommandPrefix = prefix;
		this.markAgentModified("shellCommandPrefix");
		this.save();
	}

	getNpmCommand(): string[] | undefined {
		return this.settings.npmCommand ? [...this.settings.npmCommand] : undefined;
	}

	getQuietStartup(): boolean {
		return this.settings.quietStartup ?? false;
	}

	setQuietStartup(quiet: boolean): void {
		this.agentSettings.quietStartup = quiet;
		this.markAgentModified("quietStartup");
		this.save();
	}

	/** 模型循环范围；未配置时为 undefined。 */
	getEnabledModels(): string[] | undefined {
		return this.settings.enabledModels;
	}

	setEnabledModels(patterns: string[] | undefined): void {
		this.agentSettings.enabledModels = patterns;
		this.markAgentModified("enabledModels");
		this.save();
	}

	getCollapseChangelog(): boolean {
		return this.settings.collapseChangelog ?? false;
	}

	getThinkingBudgets() {
		return this.settings.thinkingBudgets ? { ...this.settings.thinkingBudgets } : undefined;
	}

	/** 记录项目层某个字段被修改。 */
	private markProjectModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedProjectFields.add(field);
		if (!nestedKey) return;
		if (!this.modifiedProjectNestedFields.has(field)) {
			this.modifiedProjectNestedFields.set(field, new Set());
		}
		this.modifiedProjectNestedFields.get(field)!.add(nestedKey);
	}

	/** 写项目层；未信任或项目文件解析失败时拒绝覆盖。 */
	private saveProjectSettings(settings: Settings): void {
		this.assertProjectTrustedForWrite();
		this.projectSettings = structuredClone(settings);
		this.settings = deepMergeSettings(this.agentSettings, this.projectSettings);
		if (this.projectSettingsLoadError) return;

		const snapshot = structuredClone(this.projectSettings);
		const modifiedFields = new Set(this.modifiedProjectFields);
		const modifiedNestedFields = this.cloneNestedFields(this.modifiedProjectNestedFields);
		this.enqueueWrite("project", () => {
			this.persistScopedSettings("project", snapshot, modifiedFields, modifiedNestedFields);
		});
	}

	/** 修改项目层字段的统一入口：克隆、更新、标记、写盘。 */
	private updateProjectSettings(field: keyof Settings, update: (settings: Settings) => void): void {
		this.assertProjectTrustedForWrite();
		const projectSettings = structuredClone(this.projectSettings);
		update(projectSettings);
		this.markProjectModified(field);
		this.saveProjectSettings(projectSettings);
	}

	/** 记录 agent 层某个字段被修改；嵌套字段再记录子键。 */
	private markAgentModified(field: keyof Settings, nestedKey?: string): void {
		this.modifiedAgentFields.add(field);
		if (!nestedKey) return;
		if (!this.modifiedAgentNestedFields.has(field)) {
			this.modifiedAgentNestedFields.set(field, new Set());
		}
		this.modifiedAgentNestedFields.get(field)!.add(nestedKey);
	}

	/** 项目写入前的信任检查。 */
	private assertProjectTrustedForWrite(): void {
		if (!this.projectTrusted) {
			throw new Error("Project is not trusted; refusing to write project settings");
		}
	}

	/** 记录一次读写错误，交给 drainErrors 上报。 */
	private recordError(scope: SettingsScope, error: unknown): void {
		this.errors.push(toSettingsError(scope, error, this.settingsPaths[scope]));
	}

	/** 某个作用域写盘成功后清空它的修改记录。 */
	private clearModifiedScope(scope: SettingsScope): void {
		if (scope === "agent") {
			this.modifiedAgentFields.clear();
			this.modifiedAgentNestedFields.clear();
			return;
		}
		this.modifiedProjectFields.clear();
		this.modifiedProjectNestedFields.clear();
	}

	/** 把写盘任务追加到串行队列；失败只记诊断，不打断调用方。 */
	private enqueueWrite(scope: SettingsScope, task: () => void): void {
		this.writeQueue = this.writeQueue
			.then(() => {
				if (scope === "project") this.assertProjectTrustedForWrite();
				task();
				this.clearModifiedScope(scope);
			})
			.catch((error) => {
				this.recordError(scope, error);
			});
	}

	/** 复制嵌套修改记录，避免写队列执行时被后续修改覆盖。 */
	private cloneNestedFields(source: Map<keyof Settings, Set<string>>): Map<keyof Settings, Set<string>> {
		const snapshot = new Map<keyof Settings, Set<string>>();
		for (const [key, value] of source.entries()) snapshot.set(key, new Set(value));
		return snapshot;
	}

	/**
	 * 把本次改动的字段合并进现有文件。
	 * 顶层字段整体替换；嵌套字段只替换改过的子键，保留其它键与未知字段。
	 */
	private persistScopedSettings(
		scope: SettingsScope,
		snapshotSettings: Settings,
		modifiedFields: Set<keyof Settings>,
		modifiedNestedFields: Map<keyof Settings, Set<string>>,
	): void {
		this.storage.withLock(scope, (current) => {
			const currentFileSettings = current ? (JSON.parse(stripBom(current)) as Settings) : ({} as Settings);
			const mergedSettings: Settings = { ...currentFileSettings };
			for (const field of modifiedFields) {
				const value = snapshotSettings[field];
				if (modifiedNestedFields.has(field) && typeof value === "object" && value !== null) {
					const nestedModified = modifiedNestedFields.get(field)!;
					const baseNested = (currentFileSettings[field] as Record<string, unknown>) ?? {};
					const inMemoryNested = value as Record<string, unknown>;
					const mergedNested = { ...baseNested };
					for (const nestedKey of nestedModified) {
						mergedNested[nestedKey] = inMemoryNested[nestedKey];
					}
					(mergedSettings as Record<string, unknown>)[field] = mergedNested;
				} else {
					(mergedSettings as Record<string, unknown>)[field] = value;
				}
			}
			return JSON.stringify(mergedSettings, null, 2);
		});
	}

	/** 重新计算合并结果，并把 agent 层的改动排入写队列。 */
	private save(): void {
		this.settings = deepMergeSettings(this.agentSettings, this.projectSettings);
		if (this.agentSettingsLoadError) return;

		const snapshot = structuredClone(this.agentSettings);
		const modifiedFields = new Set(this.modifiedAgentFields);
		const modifiedNestedFields = this.cloneNestedFields(this.modifiedAgentNestedFields);
		this.enqueueWrite("agent", () => {
			this.persistScopedSettings("agent", snapshot, modifiedFields, modifiedNestedFields);
		});
	}

	/** 等待所有写盘任务完成，测试与退出前使用。 */
	async flush(): Promise<void> {
		await this.writeQueue;
	}

	/** 取走并清空本次运行积累的错误。 */
	drainErrors(): SettingsError[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}
}
