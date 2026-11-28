import { homedir } from "node:os";
import { join } from "node:path";
import { normalizePath } from "./utils/paths.ts";

/** 项目内配置目录名。 */
export const PROJECT_CONFIG_DIR = ".pipi";

/** 用户配置根：`~/.pipi`。 */
export function getConfigRoot(): string {
	return join(homedir(), PROJECT_CONFIG_DIR);
}

/** 覆盖 agent 目录的环境变量。 */
export const ENV_AGENT_DIR = "PIPI_CODING_AGENT_DIR";

/** 覆盖会话根目录的环境变量。 */
export const ENV_SESSION_DIR = "PIPI_CODING_AGENT_SESSION_DIR";

/** 用户级资源目录：`~/.pipi/agent`；可用 `PIPI_CODING_AGENT_DIR` 覆盖。 */
export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) return normalizePath(envDir);
	return join(getConfigRoot(), "agent");
}

/** 兼容旧调用名。 */
export function getDefaultAgentDir(): string {
	return getAgentDir();
}

/** 会话目录根：`~/.pipi/agent/sessions`；可用 `PIPI_CODING_AGENT_SESSION_DIR` 覆盖。 */
export function getSessionsRoot(): string {
	const envDir = process.env[ENV_SESSION_DIR];
	if (envDir) return normalizePath(envDir);
	return join(getAgentDir(), "sessions");
}

/** agent 级 settings 文件。 */
export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** trust 记录文件。 */
export function getTrustPath(): string {
	return join(getAgentDir(), "trust.json");
}

/** 用户 home 目录，用于 `.agents/skills` 等共享位置。 */
export function getHomeDir(): string {
	return homedir();
}
