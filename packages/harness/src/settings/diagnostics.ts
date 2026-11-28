import type { SettingsManager } from "./manager.ts";

/** 启动或运行时展示的配置诊断。 */
export interface SettingsDiagnostic {
	type: "warning" | "error";
	message: string;
}

/** 取出并清空 settings 错误，转成可展示的诊断。 */
export function collectSettingsDiagnostics(manager: SettingsManager): SettingsDiagnostic[] {
	return manager.drainErrors().map(({ scope, path, error }) => ({
		type: "warning" as const,
		message: path ? `Invalid settings file ${path}: ${error.message}` : `Invalid ${scope} settings: ${error.message}`,
	}));
}

/** 去掉重复的 type + message，保留第一次出现。 */
export function deduplicateSettingsDiagnostics(diagnostics: readonly SettingsDiagnostic[]): SettingsDiagnostic[] {
	const seen = new Set<string>();
	return diagnostics.filter((diagnostic) => {
		const key = `${diagnostic.type}\0${diagnostic.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
