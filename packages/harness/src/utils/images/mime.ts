import { open } from "node:fs/promises";

const SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	if (bytes.length < prefix.length) return false;
	return prefix.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
	if (bytes.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index++) {
		if (bytes[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
	return bytes.length >= 16 && readUint32BE(bytes, PNG_SIGNATURE.length) === 13 && asciiAt(bytes, 12, "IHDR");
}

// 动画 PNG 带 acTL 块；以首帧显示会误导用户，直接当作不支持
function isAnimatedPng(bytes: Uint8Array): boolean {
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length = readUint32BE(bytes, offset);
		const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
		if (type === "acTL") return true;
		if (type === "IDAT" || type === "IEND") return false;
		offset += 12 + length;
	}
	return false;
}

function isBmp(bytes: Uint8Array): boolean {
	if (bytes.length < 26 || !asciiAt(bytes, 0, "BM")) return false;
	const declaredSize = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
	return declaredSize === 0 || declaredSize >= 26;
}

/** 按文件头识别支持的图片类型；不支持或不认识的返回 null。 */
export function detectSupportedImageMimeType(buffer: Uint8Array): string | null {
	if (startsWith(buffer, [0xff, 0xd8, 0xff])) return buffer[3] === 0xf7 ? null : "image/jpeg";
	if (startsWith(buffer, PNG_SIGNATURE)) return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : null;
	if (asciiAt(buffer, 0, "GIF")) return "image/gif";
	if (asciiAt(buffer, 0, "RIFF") && asciiAt(buffer, 8, "WEBP")) return "image/webp";
	if (isBmp(buffer)) return "image/bmp";
	return null;
}

/** 从文件读取前 4KB 判断类型。 */
export async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
	const handle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(SNIFF_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
		return detectSupportedImageMimeType(buffer.subarray(0, bytesRead));
	} finally {
		await handle.close();
	}
}
