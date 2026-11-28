import { PROJECT_CONFIG_DIR } from "../config.ts";
import {
	getProjectTrustOptions,
	hasTrustRequiringProjectResources,
	type ProjectTrustOption,
	type ProjectTrustStore,
} from "./trust.ts";
import type { DefaultProjectTrust } from "./types.ts";

/** 信任询问函数；返回用户选中的 label，取消返回 undefined。 */
export type ProjectTrustSelect = (prompt: string, options: ProjectTrustOption[]) => Promise<string | undefined>;

export interface ResolveProjectTrustedOptions {
	projectDir: string;
	trustStore: ProjectTrustStore;
	trustOverride?: boolean; // 来自cli的--approve（强制信任当前项目）--no-approve（强制不信任当前项目）
	defaultProjectTrust?: DefaultProjectTrust;
	hasUI: boolean;
	select?: ProjectTrustSelect;
	/** 扩展的 project_trust 钩子；课程 20 接入。 */
	extensionDecision?: () => Promise<boolean | undefined>;
}

function formatProjectTrustPrompt(projectDir: string): string {
	return `Trust project folder?\n${projectDir}\n\nThis allows pipi to load ${PROJECT_CONFIG_DIR} settings and resources, install missing project packages, and execute project extensions.`;
}

/**
 * 决定项目是否可信。顺序：
 * 1. cli命令
 * 2. 没有任何需信任资源时直接信任
 * 3. 扩展钩子
 * 4. trust store 的最近祖先记录
 * 5. 默认策略 always / never / ask
 * 6. ask 且有 UI 时询问用户；没有 UI 按不信任处理
 */
export async function resolveProjectTrusted(options: ResolveProjectTrustedOptions): Promise<boolean> {
	// 如果cli指定（approve），直接覆盖
	if (options.trustOverride !== undefined) return options.trustOverride;
	// 检查是否有需要信任的资源
	if (!hasTrustRequiringProjectResources(options.projectDir)) return true;

	// 扩展
	if (options.extensionDecision) {
		const decision = await options.extensionDecision();
		if (decision !== undefined) return decision;
	}

	// 检查trust.json
	const stored = options.trustStore.get(options.projectDir);
	if (stored !== null) return stored;

	// 默认策略
	switch (options.defaultProjectTrust ?? "ask") {
		case "always":
			return true;
		case "never":
			return false;
		case "ask":
			break;
	}

	// 有UI才能问
	if (!options.hasUI || !options.select) return false;

	const asked = getProjectTrustOptions(options.projectDir, { includeSessionOnly: true });
	const selectedLabel = await options.select(formatProjectTrustPrompt(options.projectDir), asked);
	const selected = asked.find((option) => option.label === selectedLabel);
	if (!selected) return false;

	if (selected.updates.length > 0) options.trustStore.setMany(selected.updates);
	return selected.trusted;
}
