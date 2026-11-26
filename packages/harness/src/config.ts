import { homedir } from "node:os";
import { join } from "node:path";

/** 项目内配置目录名。 */
export const PROJECT_CONFIG_DIR = ".pipi";

/** 用户配置根：`~/.pipi`。 */
export function getConfigRoot(): string {
	return join(homedir(), PROJECT_CONFIG_DIR);
}

/** 用户级资源目录：`~/.pipi/agent`，结构与原项目的 `~/.pi/agent` 对应。 */
export function getAgentDir(): string {
	return join(getConfigRoot(), "agent");
}

/** 兼容旧调用名。 */
export function getDefaultAgentDir(): string {
	return getAgentDir();
}

/** 会话目录根：`~/.pipi/agent/sessions`。 */
export function getSessionsRoot(): string {
	return join(getAgentDir(), "sessions");
}

/** 用户 home 目录，用于 `.agents/skills` 等共享位置。 */
export function getHomeDir(): string {
	return homedir();
}
