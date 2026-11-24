import { applyExifOrientation } from "./exif-orientation.ts";
import { loadPhoton } from "./photon.ts";

export interface ImageResizeOptions {
	maxWidth?: number;
	maxHeight?: number;
	/** base64 编码后的字节上限，默认 4.5MB，为 provider 的 5MB 限制留余量。 */
	maxBytes?: number;
	jpegQuality?: number;
}

export interface ResizedImage {
	data: string;
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}

const DEFAULTS = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: 4.5 * 1024 * 1024,
	jpegQuality: 80,
};

interface Candidate {
	data: string;
	encodedSize: number;
	mimeType: string;
}

function encodeCandidate(bytes: Uint8Array, mimeType: string): Candidate {
	const data = Buffer.from(bytes).toString("base64");
	return { data, encodedSize: Buffer.byteLength(data, "utf-8"), mimeType };
}

/**
 * 把图片压到尺寸与编码体积限制内。
 * 顺序：先按最大宽高缩放，再在 PNG 与不同质量的 JPEG 里取最小可用的一个；仍超限就按 0.75 递减尺寸。
 * 没有 photon 或最终仍超限时返回 null。
 */
export async function resizeImageInProcess(
	inputBytes: Uint8Array,
	mimeType: string,
	options?: ImageResizeOptions,
): Promise<ResizedImage | null> {
	const opts = { ...DEFAULTS, ...options };
	const inputBase64Size = Math.ceil(inputBytes.byteLength / 3) * 4;

	const photon = loadPhoton();
	if (!photon) return null;

	let image = photon.PhotonImage.new_from_byteslice(inputBytes);
	try {
		const oriented = applyExifOrientation(photon, image, inputBytes);
		if (oriented !== image) image.free();
		image = oriented;

		const originalWidth = image.get_width();
		const originalHeight = image.get_height();

		if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && inputBase64Size < opts.maxBytes) {
			return {
				data: Buffer.from(inputBytes).toString("base64"),
				mimeType,
				originalWidth,
				originalHeight,
				width: originalWidth,
				height: originalHeight,
				wasResized: false,
			};
		}

		let width = originalWidth;
		let height = originalHeight;
		if (width > opts.maxWidth) {
			height = Math.round((height * opts.maxWidth) / width);
			width = opts.maxWidth;
		}
		if (height > opts.maxHeight) {
			width = Math.round((width * opts.maxHeight) / height);
			height = opts.maxHeight;
		}

		const qualities = Array.from(new Set([opts.jpegQuality, 85, 70, 55, 40]));
		while (true) {
			const resized = photon.resize(image, width, height, photon.SamplingFilter.Lanczos3);
			try {
				const candidates = [
					encodeCandidate(resized.get_bytes(), "image/png"),
					...qualities.map((quality) => encodeCandidate(resized.get_bytes_jpeg(quality), "image/jpeg")),
				];
				const accepted = candidates.find((candidate) => candidate.encodedSize < opts.maxBytes);
				if (accepted) {
					return {
						data: accepted.data,
						mimeType: accepted.mimeType,
						originalWidth,
						originalHeight,
						width,
						height,
						wasResized: true,
					};
				}
			} finally {
				resized.free();
			}

			if (width === 1 && height === 1) return null;
			const nextWidth = width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75));
			const nextHeight = height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75));
			if (nextWidth === width && nextHeight === height) return null;
			width = nextWidth;
			height = nextHeight;
		}
	} catch {
		return null;
	} finally {
		image.free();
	}
}

/** 生成“从 originalWidth×originalHeight 缩到 width×height”的提示。 */
export function formatDimensionNote(image: ResizedImage): string | undefined {
	if (!image.wasResized) return undefined;
	return `[Image resized from ${image.originalWidth}x${image.originalHeight} to ${image.width}x${image.height}.]`;
}
