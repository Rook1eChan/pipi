import { type Args, parseArgs } from "./cli/args.ts";
import { getAgentDir } from "./config.ts";
import type { ResourceSettings } from "./resources/settings.ts";
import { collectSettingsDiagnostics, deduplicateSettingsDiagnostics } from "./settings/diagnostics.ts";
import { SettingsManager } from "./settings/manager.ts";
import { type ProjectTrustSelect, resolveProjectTrusted } from "./settings/project-trust.ts";
import { toResourceSettings } from "./settings/resource-settings.ts";
import { ProjectTrustStore } from "./settings/trust.ts";

export interface StartupDiagnostic {
	type: "warning" | "error";
	message: string;
}

export interface StartupOptions {
	/** 原始 argv（不含 node 与脚本路径）。 */
	args?: string[];
	/** 项目目录；默认 process.cwd()。 */
	projectDir?: string;
	/** agent 配置目录；默认 getAgentDir()。 */
	agentDir?: string;
	/** 是否有可用界面；决定 ask 策略是否弹窗。 */
	hasUI?: boolean;
	/** 信任选择函数；TUI/CLI 注入。 */
	selectTrust?: ProjectTrustSelect;
	/** 扩展的 project_trust 钩子；课程 20 接入。 */
	extensionDecision?: () => Promise<boolean | undefined>;
}

export interface StartupResult {
	args: Args;
	projectDir: string;
	agentDir: string;
	settingsManager: SettingsManager;
	trustStore: ProjectTrustStore;
	projectTrusted: boolean;
	resourceSettings: ResourceSettings;
	/** `--session-dir` 或 settings 中的会话目录。 */
	sessionDir?: string;
	diagnostics: StartupDiagnostic[];
}

/**
 * 启动配置编排：
 * 1. 解析参数
 * 2. 用未信任的 bootstrap manager 只读 agent 层，取得默认信任策略
 * 3. 查 trust store 或询问用户
 * 4. 用最终信任状态创建 runtime manager
 * 5. 转成资源快照并汇总诊断
 *
 * 不创建会话、不恢复模型、不处理包命令；这些留给后续课程。
 */
export async function resolveStartup(options: StartupOptions = {}): Promise<StartupResult> {
	const args = parseArgs(options.args ?? []);
	const projectDir = options.projectDir ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();

	const bootstrapManager = SettingsManager.create(projectDir, agentDir, { projectTrusted: false });
	const bootstrapDiagnostics = collectSettingsDiagnostics(bootstrapManager);

	const trustStore = new ProjectTrustStore(agentDir);
	const projectTrusted = await resolveProjectTrusted({
		projectDir,
		trustStore,
		trustOverride: args.projectTrustOverride,
		defaultProjectTrust: bootstrapManager.getDefaultProjectTrust(),
		hasUI: options.hasUI ?? false,
		select: options.selectTrust,
		extensionDecision: options.extensionDecision,
	});

	const settingsManager = SettingsManager.create(projectDir, agentDir, { projectTrusted });
	const resourceSettings = toResourceSettings(settingsManager);

	const diagnostics = deduplicateSettingsDiagnostics([
		...args.diagnostics,
		...bootstrapDiagnostics,
		...collectSettingsDiagnostics(settingsManager),
	]);

	return {
		args,
		projectDir,
		agentDir,
		settingsManager,
		trustStore,
		projectTrusted,
		resourceSettings,
		sessionDir: args.sessionDir ?? settingsManager.getSessionDir(),
		diagnostics,
	};
}
