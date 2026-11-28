import type { ThinkingLevel, Transport } from "@pipi/llm";

/** 配置作用域：agent 为全局级，project 为项目级。 */
export type SettingsScope = "agent" | "project";

export interface CompactionSettingsFile {
	enabled?: boolean;
	reserveTokens?: number;
	keepRecentTokens?: number;
}

export interface BranchSummarySettings {
	reserveTokens?: number;
	skipPrompt?: boolean;
}

export interface ProviderRetrySettings {
	timeoutMs?: number;
	maxRetries?: number;
	maxRetryDelayMs?: number;
}

export interface RetrySettings {
	enabled?: boolean;
	maxRetries?: number;
	baseDelayMs?: number;
	provider?: ProviderRetrySettings;
}

export type TuiMode = "regular" | "fullscreen";
export type FullscreenExitOutput = "transcript" | "resume-hint";
export type FullscreenScrollbar = "hidden" | "auto" | "always";
export type MermaidRenderingMode = "off" | "final" | "streaming";
export type DefaultProjectTrust = "ask" | "always" | "never";

export interface TerminalSettings {
	showImages?: boolean;
	imageWidthCells?: number;
	clearOnShrink?: boolean;
	showTerminalProgress?: boolean;
	hyperlinks?: boolean | "auto";
	images?: "kitty" | "iterm2" | "auto" | false;
	trueColor?: boolean | "auto";
}

export interface ImageSettings {
	autoResize?: boolean;
	blockImages?: boolean;
}

export interface ThinkingBudgetsSettings {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

export interface MarkdownSettings {
	codeBlockIndent?: string;
	mermaid?: MermaidRenderingMode;
}

export interface WarningSettings {
	anthropicExtraUsage?: boolean;
}

/** npm/git 包来源；对象形式可筛选要加载的资源。 */
export type PackageSource =
	| string
	| {
			source: string;
			autoload?: boolean;
			extensions?: string[];
			skills?: string[];
			prompts?: string[];
	  };

/** 持久化配置。所有字段都可省略，读取时由 getter 提供默认值。 */
export interface Settings {
	lastChangelogVersion?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	modelThinkingLevels?: Record<string, ThinkingLevel>;
	transport?: Transport;
	steeringMode?: "all" | "single";
	followUpMode?: "all" | "single";
	theme?: string;
	compaction?: CompactionSettingsFile;
	branchSummary?: BranchSummarySettings;
	retry?: RetrySettings;
	hideThinkingBlock?: boolean;
	showCacheMissNotices?: boolean;
	externalEditor?: string;
	shellPath?: string;
	quietStartup?: boolean;
	defaultProjectTrust?: DefaultProjectTrust;
	shellCommandPrefix?: string;
	npmCommand?: string[];
	collapseChangelog?: boolean;
	enableInstallTelemetry?: boolean;
	enableAnalytics?: boolean;
	trackingId?: string;
	packages?: PackageSource[];
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	enableSkillCommands?: boolean;
	terminal?: TerminalSettings;
	images?: ImageSettings;
	enabledModels?: string[];
	defaultTools?: string[];
	doubleEscapeAction?: "fork" | "tree" | "none";
	treeFilterMode?: "default" | "no-tools" | "user-only" | "all";
	thinkingBudgets?: ThinkingBudgetsSettings;
	editorPaddingX?: number;
	outputPad?: 0 | 1;
	autocompleteMaxVisible?: number;
	showHardwareCursor?: boolean;
	markdown?: MarkdownSettings;
	warnings?: WarningSettings;
	sessionDir?: string;
	httpProxy?: string;
	httpIdleTimeoutMs?: number;
	websocketConnectTimeoutMs?: number;
	tuiMode?: TuiMode;
	fullscreenExitOutput?: FullscreenExitOutput;
	fullscreenScrollbar?: FullscreenScrollbar;
	fullscreenCopyOnSelect?: boolean;
}

/** 读取或写入 settings 时收集的错误。 */
export interface SettingsError {
	scope: SettingsScope;
	path?: string;
	error: Error;
}
