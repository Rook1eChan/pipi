/** 去掉文件开头的 UTF-8 BOM。 */
export function stripBom(text: string): string {
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}
