export interface Edit {
	oldText: string;
	newText: string;
}

export interface EditResult {
	baseContent: string;
	newContent: string;
}

/** 拆掉 UTF-8 BOM，写回时再补上。 */
export function splitBom(raw: string): { bom: string; text: string } {
	return raw.startsWith("\uFEFF") ? { bom: "\uFEFF", text: raw.slice(1) } : { bom: "", text: raw };
}

export function detectLineEnding(text: string): "\r\n" | "\n" {
	return text.includes("\r\n") ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\n" ? text : text.replace(/\n/g, ending);
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, index + needle.length)) {
		count++;
	}
	return count;
}

function replaceUnique(content: string, edit: Edit, path: string): string {
	const count = countOccurrences(content, edit.oldText);
	if (count === 1) return content.replace(edit.oldText, () => edit.newText);
	if (count > 1) {
		throw new Error(
			`Found ${count} occurrences of oldText in ${path}. Include more surrounding context so the match is unique or merge the changes.`,
		);
	}

	// 空白差异容忍：逐行去掉行尾空白后按整行匹配
	const contentLines = content.split("\n");
	const oldLines = trimBlankEdges(
		edit.oldText
			.replace(/\r\n/g, "\n")
			.split("\n")
			.map((line) => line.trimEnd()),
	);
	if (oldLines.length === 0) throw new Error(`oldText is empty for ${path}.`);

	const normalizedContent = contentLines.map((line) => line.trimEnd());
	const starts: number[] = [];
	for (let index = 0; index + oldLines.length <= normalizedContent.length; index++) {
		if (oldLines.every((line, offset) => normalizedContent[index + offset] === line)) starts.push(index);
	}

	if (starts.length === 0) {
		throw new Error(`Could not find oldText in ${path}. Read the file again and copy the exact text.`);
	}
	if (starts.length > 1) {
		throw new Error(
			`Found ${starts.length} matches of oldText in ${path}. Include more surrounding context so the match is unique.`,
		);
	}

	const start = starts[0];
	const newLines = edit.newText
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.trimEnd());
	return [...contentLines.slice(0, start), ...newLines, ...contentLines.slice(start + oldLines.length)].join("\n");
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start] === "") start++;
	while (end > start && lines[end - 1] === "") end--;
	return lines.slice(start, end);
}

/** 依次应用所有替换；每处都必须在当前内容里唯一匹配。 */
export function applyEditsToNormalizedContent(content: string, edits: Edit[], path: string): EditResult {
	if (edits.length === 0) throw new Error(`No edits provided for ${path}.`);
	let current = content;
	for (const edit of edits) {
		if (edit.oldText === edit.newText) continue;
		current = replaceUnique(current, edit, path);
	}
	return { baseContent: content, newContent: current };
}

interface DiffLine {
	type: " " | "-" | "+";
	text: string;
}

// 先剥掉公共前后缀，再对中间部分做 LCS，避免大文件上的 O(n²) 全表
function diffLines(before: string[], after: string[]): DiffLine[] {
	let prefix = 0;
	while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	) {
		suffix++;
	}

	const head = before.slice(0, prefix).map((text): DiffLine => ({ type: " ", text }));
	const tail = before.slice(before.length - suffix).map((text): DiffLine => ({ type: " ", text }));
	const left = before.slice(prefix, before.length - suffix);
	const right = after.slice(prefix, after.length - suffix);

	const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
	for (let i = left.length - 1; i >= 0; i--) {
		for (let j = right.length - 1; j >= 0; j--) {
			table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}

	const middle: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < left.length && j < right.length) {
		if (left[i] === right[j]) {
			middle.push({ type: " ", text: left[i] });
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			middle.push({ type: "-", text: left[i] });
			i++;
		} else {
			middle.push({ type: "+", text: right[j] });
			j++;
		}
	}
	while (i < left.length) middle.push({ type: "-", text: left[i++] });
	while (j < right.length) middle.push({ type: "+", text: right[j++] });

	return [...head, ...middle, ...tail];
}

interface NumberedLine extends DiffLine {
	oldLine: number;
	newLine: number;
}

function numberDiff(diff: DiffLine[]): NumberedLine[] {
	let oldLine = 1;
	let newLine = 1;
	return diff.map((line) => {
		const numbered = { ...line, oldLine, newLine };
		if (line.type === " ") {
			oldLine++;
			newLine++;
		} else if (line.type === "-") {
			oldLine++;
		} else {
			newLine++;
		}
		return numbered;
	});
}

/** 生成带行号的变更摘要，供界面展示。 */
export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
	const entries = numberDiff(diffLines(oldContent.split("\n"), newContent.split("\n")));
	const changedIndexes = entries.flatMap((entry, index) => (entry.type === " " ? [] : [index]));

	const output: string[] = [];
	for (let index = 0; index < entries.length; index++) {
		if (entries[index].type === " ") {
			const nearby = changedIndexes.some((changedIndex) => Math.abs(changedIndex - index) <= contextLines);
			if (!nearby) continue;
		}
		const entry = entries[index];
		const marker = entry.type === "+" ? "+" : entry.type === "-" ? "-" : " ";
		const lineNumber = entry.type === "+" ? entry.newLine : entry.oldLine;
		output.push(`${marker}${String(lineNumber).padStart(6)} ${entry.text}`);
	}

	return { diff: output.join("\n"), firstChangedLine: entries[changedIndexes[0]]?.oldLine };
}

/** 生成标准 unified patch，便于用户审阅或交给 git apply。 */
export function generateUnifiedPatch(path: string, oldContent: string, newContent: string, contextLines = 3): string {
	const entries = numberDiff(diffLines(oldContent.split("\n"), newContent.split("\n")));
	const changedIndexes = entries.flatMap((entry, index) => (entry.type === " " ? [] : [index]));
	if (changedIndexes.length === 0) return "";

	const hunks: string[] = [];
	let groupStart = 0;
	while (groupStart < changedIndexes.length) {
		let groupEnd = groupStart;
		while (
			groupEnd + 1 < changedIndexes.length &&
			changedIndexes[groupEnd + 1] - changedIndexes[groupEnd] <= contextLines * 2 + 1
		) {
			groupEnd++;
		}

		const from = Math.max(0, changedIndexes[groupStart] - contextLines);
		const to = Math.min(entries.length, changedIndexes[groupEnd] + contextLines + 1);
		const slice = entries.slice(from, to);
		const oldStart = slice[0].oldLine;
		const newStart = slice[0].newLine;
		const oldCount = slice.filter((entry) => entry.type !== "+").length;
		const newCount = slice.filter((entry) => entry.type !== "-").length;

		hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
		hunks.push(...slice.map((entry) => `${entry.type}${entry.text}`));
		groupStart = groupEnd + 1;
	}

	return [`--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");
}
