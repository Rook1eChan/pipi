/**
 * 工具输出的截断规则。
 *
 * 同时受两个上限约束，先到的那个生效：
 * - 行数（默认 2000 行）
 * - 字节数（默认 50KB）
 *
 * 不会把一行截断。除非是单行就超限。
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
/** grep 匹配行的最大字符数，长行会被截断。 */
export const GREP_MAX_LINE_LENGTH = 500;

export interface TruncationResult {
	content: string;
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	totalLines: number;
	totalBytes: number;
	outputLines: number;
	outputBytes: number;
	/** 。 */
	lastLinePartial: boolean; // 保留尾部的截断时，是否为最后一行就超限被截断
	firstLineExceedsLimit: boolean; // 是否为第一行就超限的情况
	maxLines: number;
	maxBytes: number;
}

export interface TruncationOptions {
	maxLines?: number;
	maxBytes?: number;
}

// 按行切分并去掉末尾空行，避免末尾换行被算作一行
function splitLines(content: string): string[] {
	if (content.length === 0) return [];
	const lines = content.split("\n");
	if (content.endsWith("\n")) lines.pop();
	return lines;
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf-8");
}

/** 把字节数格式化成可读单位（B、KB、MB） */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// 从字节序列的末尾取 maxBytes，并向前对齐到 UTF-8 字符边界
function sliceFromEnd(text: string, maxBytes: number): string {
	const buffer = Buffer.from(text, "utf-8");
	if (buffer.length <= maxBytes) return text;

	let start = buffer.length - maxBytes;
	while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
	return buffer.subarray(start).toString("utf-8");
}

// 不需截断时返回的结果
function noTruncation(content: string, maxLines: number, maxBytes: number): TruncationResult {
	const totalBytes = byteLength(content);
	const totalLines = splitLines(content).length;
	return {
		content,
		truncated: false,
		truncatedBy: null,
		totalLines,
		totalBytes,
		outputLines: totalLines,
		outputBytes: totalBytes,
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * 截断，保留头部：用于 read 这类需要先看文件前部的场景。
 * 第一行就超过字节上限时返回空内容，并置 firstLineExceedsLimit。
 */
export function truncateKeepHead(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const totalBytes = byteLength(content);
	const lines = splitLines(content);
	const totalLines = lines.length;

	// 不需要截断
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return noTruncation(content, maxLines, maxBytes);
	}

	// 在保留头部时首行超限，返回空
	if (byteLength(lines[0] ?? "") > maxBytes) {
		return {
			content: "",
			truncated: true,
			truncatedBy: "bytes",
			totalLines,
			totalBytes,
			outputLines: 0,
			outputBytes: 0,
			lastLinePartial: false,
			firstLineExceedsLimit: true,
			maxLines,
			maxBytes,
		};
	}

	const kept: string[] = [];
	let keptBytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	// 遍历lines，行数和比特数哪个到上限了都会结束循环
	for (let index = 0; index < lines.length && index < maxLines; index++) {
		const line = lines[index];
		const lineBytes = byteLength(line) + (index > 0 ? 1 : 0); // 除第一行外，每行都带一个换行符
		if (keptBytes + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			break;
		}
		kept.push(line);
		keptBytes += lineBytes;
	}

	const output = kept.join("\n");
	return {
		content: output,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: kept.length,
		outputBytes: byteLength(output),
		lastLinePartial: false,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/**
 * 保留尾部：用于 bash 这类关心最后结果与报错的场景
 * 最后一行本身超过字节上限时保留它的尾部，并置 lastLinePartial。
 */
export function truncateKeepTail(content: string, options: TruncationOptions = {}): TruncationResult {
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const totalBytes = byteLength(content);
	const lines = splitLines(content);
	const totalLines = lines.length;

	// 不截断
	if (totalLines <= maxLines && totalBytes <= maxBytes) {
		return noTruncation(content, maxLines, maxBytes);
	}

	const kept: string[] = [];
	let keptBytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";
	let lastLinePartial = false;

	for (let index = lines.length - 1; index >= 0 && kept.length < maxLines; index--) {
		const line = lines[index];
		const lineBytes = byteLength(line) + (kept.length > 0 ? 1 : 0);
		if (keptBytes + lineBytes > maxBytes) {
			truncatedBy = "bytes";
			if (kept.length === 0) {
				// 最后一行就超限，进行截取
				const partial = sliceFromEnd(line, maxBytes);
				kept.unshift(partial);
				keptBytes = byteLength(partial);
				lastLinePartial = true;
			}
			break;
		}
		kept.unshift(line); // 往数组开头插入
		keptBytes += lineBytes;
	}

	const output = kept.join("\n");
	return {
		content: output,
		truncated: true,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: kept.length,
		outputBytes: byteLength(output),
		lastLinePartial,
		firstLineExceedsLimit: false,
		maxLines,
		maxBytes,
	};
}

/** 截断单行文本，用于 grep 的匹配行。 */
export function truncateLine(
	line: string,
	maxChars: number = GREP_MAX_LINE_LENGTH,
): { text: string; wasTruncated: boolean } {
	if (line.length <= maxChars) return { text: line, wasTruncated: false };
	return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true };
}
