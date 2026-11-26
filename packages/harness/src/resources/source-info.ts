/** 资源作用范围。 */
export type SourceScope = "agent" | "project" | "temporary"; // 全局级/项目级/临时

/** 资源来源。 */
export type SourceOrigin = "package" | "top-level"; // 由外部npm包提供/代码自带

/** 路径的来源信息，用于 UI 展示与冲突提示。 */
export interface SourceInfo {
	path: string;
	source: string; // `local`、`auto`、`npm:<pkg>`、`cli` 等自由标记
	scope: SourceScope;
	origin: SourceOrigin;
	baseDir?: string;
}

/** path 对应的路径元数据，不包含资源自身路径。 */
export interface PathMetadata {
	source: string;
	scope: SourceScope;
	origin: SourceOrigin;
	baseDir?: string;
}

export function createSourceInfo(path: string, metadata: PathMetadata): SourceInfo {
	return {
		path,
		source: metadata.source,
		scope: metadata.scope,
		origin: metadata.origin,
		baseDir: metadata.baseDir,
	};
}

export function createSyntheticSourceInfo(
	path: string,
	options: {
		source: string;
		scope?: SourceScope;
		origin?: SourceOrigin;
		baseDir?: string;
	},
): SourceInfo {
	return {
		path,
		source: options.source,
		scope: options.scope ?? "temporary",
		origin: options.origin ?? "top-level",
		baseDir: options.baseDir,
	};
}
