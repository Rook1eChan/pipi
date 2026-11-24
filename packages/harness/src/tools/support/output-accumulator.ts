import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type TruncationResult, truncateKeepTail } from "./truncate.ts";

export interface OutputAccumulatorOptions {
	maxLines?: number;
	maxBytes?: number;
	tempFilePrefix?: string;
}

export interface OutputSnapshot {
	content: string;
	truncation: TruncationResult;
	/** 输出被截断且已落盘时的完整输出路径。 */
	fullOutputPath?: string;
}

function createTempFilePath(prefix: string): string {
	return join(tmpdir(), `${prefix}-${randomBytes(8).toString("hex")}.log`);
}

/**
 * 边接收边统计的流式输出缓冲。
 *
 * 内存里只保留尾部一段用于展示，同时维护总行数、总字节数；超过上限后把完整输出
 * 写入临时文件，调用方可以据此把文件路径告诉模型。
 */
export class OutputAccumulator {
	private readonly maxLines: number;
	private readonly maxBytes: number;
	private readonly maxRollingBytes: number;
	private readonly tempFilePrefix: string;
	private readonly decoder = new TextDecoder();

	private rawChunks: Buffer[] = [];
	private tailText = "";
	private tailBytes = 0;
	private tailStartsAtLineBoundary = true;
	private totalRawBytes = 0;
	private totalDecodedBytes = 0;
	private completedLines = 0;
	private totalLines = 0;
	private currentLineBytes = 0;
	private hasOpenLine = false;
	private finished = false;

	private tempFilePath: string | undefined;
	private tempFileStream: WriteStream | undefined;

	constructor(options: OutputAccumulatorOptions = {}) {
		this.maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
		this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		// 展示只需要尾部，但截断判断要留出余量，避免频繁裁剪
		this.maxRollingBytes = Math.max(this.maxBytes * 2, 1);
		this.tempFilePrefix = options.tempFilePrefix ?? "pipi-output";
	}

	/** 追加一段原始字节；必须按顺序调用。 */
	append(data: Buffer): void {
		if (this.finished) {
			throw new Error("Cannot append to a finished output accumulator");
		}

		this.totalRawBytes += data.length;
		// stream: true 让跨块的 UTF-8 字符在下一块补齐
		this.appendDecodedText(this.decoder.decode(data, { stream: true }));

		if (this.tempFileStream || this.shouldUseTempFile()) {
			this.ensureTempFile();
			this.tempFileStream?.write(data);
		} else if (data.length > 0) {
			this.rawChunks.push(data);
		}
	}

	/** 结束追加，冲刷解码器里残留的半个字符。 */
	finish(): void {
		if (this.finished) return;
		this.finished = true;
		this.appendDecodedText(this.decoder.decode());
		if (this.shouldUseTempFile()) this.ensureTempFile();
	}

	/** 取当前可展示的尾部内容与截断信息。 */
	snapshot(options: { persistIfTruncated?: boolean } = {}): OutputSnapshot {
		const tail = truncateKeepTail(this.getSnapshotText(), { maxLines: this.maxLines, maxBytes: this.maxBytes });
		const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes;
		const truncatedBy = truncated
			? (tail.truncatedBy ?? (this.totalDecodedBytes > this.maxBytes ? "bytes" : "lines"))
			: null;
		const truncation: TruncationResult = {
			...tail,
			truncated,
			truncatedBy,
			totalLines: this.totalLines,
			totalBytes: this.totalDecodedBytes,
			maxLines: this.maxLines,
			maxBytes: this.maxBytes,
		};

		if (options.persistIfTruncated && truncation.truncated) this.ensureTempFile();

		return { content: truncation.content, truncation, fullOutputPath: this.tempFilePath };
	}

	/** 关闭临时文件写入流；没有临时文件时直接返回。 */
	async closeTempFile(): Promise<void> {
		const stream = this.tempFileStream;
		if (!stream) return;
		this.tempFileStream = undefined;

		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				stream.off("finish", onFinish);
				reject(error);
			};
			const onFinish = () => {
				stream.off("error", onError);
				resolve();
			};
			stream.once("error", onError);
			stream.once("finish", onFinish);
			stream.end();
		});
	}

	/** 当前未结束行的字节数，用于提示“这一行本身有多大”。 */
	getLastLineBytes(): number {
		return this.currentLineBytes;
	}

	private appendDecodedText(text: string): void {
		if (text.length === 0) return;

		const bytes = Buffer.byteLength(text, "utf-8");
		this.totalDecodedBytes += bytes;
		this.tailText += text;
		this.tailBytes += bytes;
		if (this.tailBytes > this.maxRollingBytes * 2) this.trimTail();

		let newlines = 0;
		let lastNewline = -1;
		for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
			newlines++;
			lastNewline = index;
		}

		if (newlines === 0) {
			this.currentLineBytes += bytes;
			this.hasOpenLine = true;
		} else {
			this.completedLines += newlines;
			const tail = text.slice(lastNewline + 1);
			this.currentLineBytes = Buffer.byteLength(tail, "utf-8");
			this.hasOpenLine = tail.length > 0;
		}
		this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
	}

	// 只保留尾部 maxRollingBytes，并向前对齐到 UTF-8 字符边界
	private trimTail(): void {
		const buffer = Buffer.from(this.tailText, "utf-8");
		if (buffer.length <= this.maxRollingBytes) {
			this.tailBytes = buffer.length;
			return;
		}

		let start = buffer.length - this.maxRollingBytes;
		while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;

		this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
		this.tailText = buffer.subarray(start).toString("utf-8");
		this.tailBytes = Buffer.byteLength(this.tailText, "utf-8");
	}

	// 裁掉的起点若落在行中间，丢掉这半行，保证展示从完整行开始
	private getSnapshotText(): string {
		if (this.tailStartsAtLineBoundary) return this.tailText;
		const firstNewline = this.tailText.indexOf("\n");
		return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
	}

	private shouldUseTempFile(): boolean {
		return (
			this.totalRawBytes > this.maxBytes || this.totalDecodedBytes > this.maxBytes || this.totalLines > this.maxLines
		);
	}

	private ensureTempFile(): void {
		if (this.tempFilePath) return;
		this.tempFilePath = createTempFilePath(this.tempFilePrefix);
		this.tempFileStream = createWriteStream(this.tempFilePath);
		for (const chunk of this.rawChunks) this.tempFileStream.write(chunk);
		this.rawChunks = [];
	}
}
