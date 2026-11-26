import { getDefaultAgentDir } from "../config.ts";

/** 全局（agent）与项目级的资源条目。 */
export interface ResourceEntries {
	agent: string[];
	project: string[];
}

/**
 * 资源解析所需的配置快照。
 * 本课由调用方构造；课程 16 起由 SettingsManager 生成并填入。
 */
export interface ResourceSettings {
	agentDir: string;
	projectDir: string;
	projectTrusted: boolean;
	extensions: ResourceEntries;
	skills: ResourceEntries;
	prompts: ResourceEntries;
}

export interface CreateResourceSettingsOptions {
	projectDir: string;
	agentDir?: string;
	projectTrusted?: boolean;
	extensions?: Partial<ResourceEntries>;
	skills?: Partial<ResourceEntries>;
	prompts?: Partial<ResourceEntries>;
}

function toEntries(entries: Partial<ResourceEntries> | undefined): ResourceEntries {
	return { agent: entries?.agent ?? [], project: entries?.project ?? [] };
}

/** 构造默认配置；信任状态在课程 16 接入前默认允许项目级资源。 */
export function createResourceSettings(options: CreateResourceSettingsOptions): ResourceSettings {
	const agentDir = options.agentDir ?? getDefaultAgentDir();
	return {
		agentDir,
		projectDir: options.projectDir,
		projectTrusted: options.projectTrusted ?? true,
		extensions: toEntries(options.extensions),
		skills: toEntries(options.skills),
		prompts: toEntries(options.prompts),
	};
}
