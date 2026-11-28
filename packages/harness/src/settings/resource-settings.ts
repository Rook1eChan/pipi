import { createResourceSettings, type ResourceSettings } from "../resources/settings.ts";
import type { SettingsManager } from "./manager.ts";

/** 把 settings 管理器转成资源解析所需的快照。 */
export function toResourceSettings(manager: SettingsManager): ResourceSettings {
	const agentSettings = manager.getAgentSettings();
	const projectSettings = manager.getProjectSettings();

	return createResourceSettings({
		projectDir: manager.getProjectDir(),
		agentDir: manager.getAgentDir(),
		projectTrusted: manager.isProjectTrusted(),
		extensions: {
			agent: agentSettings.extensions ?? [],
			project: projectSettings.extensions ?? [],
		},
		skills: {
			agent: agentSettings.skills ?? [],
			project: projectSettings.skills ?? [],
		},
		prompts: {
			agent: agentSettings.prompts ?? [],
			project: projectSettings.prompts ?? [],
		},
	});
}
