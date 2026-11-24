import { loadPhoton } from "./photon.ts";
import { formatDimensionNote, type ImageResizeOptions, resizeImageInProcess } from "./resize.ts";

export interface ProcessImageOptions {
	autoResizeImages?: boolean;
	resizeOptions?: ImageResizeOptions;
}

export type ProcessImageResult =
	| { ok: true; data: string; mimeType: string; hints: string[] }
	| { ok: false; message: string };

interface NormalizedImage {
	bytes: Uint8Array;
	mimeType: string;
	convertedFrom?: string;
}

function baseMimeType(mimeType: string): string {
	return mimeType.split(";")[0]?.trim().toLowerCase() ?? mimeType.toLowerCase();
}

// provider 能直接接收的格式；其余（如 bmp）需要先转 PNG
function normalizeSupportedMimeType(mimeType: string): string | null {
	switch (baseMimeType(mimeType)) {
		case "image/png":
			return "image/png";
		case "image/jpeg":
		case "image/jpg":
			return "image/jpeg";
		case "image/gif":
			return "image/gif";
		case "image/webp":
			return "image/webp";
		default:
			return null;
	}
}

function convertToPng(bytes: Uint8Array): Uint8Array | null {
	const photon = loadPhoton();
	if (!photon) return null;
	try {
		const image = photon.PhotonImage.new_from_byteslice(bytes);
		try {
			return image.get_bytes();
		} finally {
			image.free();
		}
	} catch {
		return null;
	}
}

function normalizeImage(bytes: Uint8Array, mimeType: string): NormalizedImage | null {
	const supported = normalizeSupportedMimeType(mimeType);
	if (supported) return { bytes, mimeType: supported };

	const pngBytes = convertToPng(bytes);
	if (!pngBytes) return null;
	return { bytes: pngBytes, mimeType: "image/png", convertedFrom: baseMimeType(mimeType) };
}

export async function processImage(
	bytes: Uint8Array,
	mimeType: string,
	options?: ProcessImageOptions,
): Promise<ProcessImageResult> {
	const normalized = normalizeImage(bytes, mimeType);
	if (!normalized) {
		return { ok: false, message: "[Image omitted: could not be converted to a supported inline image format.]" };
	}

	const hints: string[] = [];
	if (normalized.convertedFrom) {
		hints.push(`[Image converted from ${normalized.convertedFrom} to ${normalized.mimeType}.]`);
	}

	if (options?.autoResizeImages ?? true) {
		const resized = await resizeImageInProcess(normalized.bytes, normalized.mimeType, options?.resizeOptions);
		if (!resized) {
			return { ok: false, message: "[Image omitted: could not be resized below the inline image size limit.]" };
		}
		const dimensionNote = formatDimensionNote(resized);
		if (dimensionNote) hints.push(dimensionNote);
		return { ok: true, data: resized.data, mimeType: resized.mimeType, hints };
	}

	return {
		ok: true,
		data: Buffer.from(normalized.bytes).toString("base64"),
		mimeType: normalized.mimeType,
		hints,
	};
}
