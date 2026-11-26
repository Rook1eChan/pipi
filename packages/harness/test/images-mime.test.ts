import { describe, expect, it } from "vitest";
import { detectSupportedImageMimeType } from "../src/utils/images/mime.ts";

const png = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1,
]);

function withAscii(bytes: Buffer, offset: number, text: string): Buffer {
	const copy = Buffer.from(bytes);
	Buffer.from(text, "ascii").copy(copy, offset);
	return copy;
}

describe("detectSupportedImageMimeType", () => {
	it("recognizes jpeg, png, gif, webp and bmp", () => {
		expect(detectSupportedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
		expect(detectSupportedImageMimeType(png)).toBe("image/png");
		expect(detectSupportedImageMimeType(Buffer.from("GIF89a", "ascii"))).toBe("image/gif");
		expect(detectSupportedImageMimeType(withAscii(Buffer.from("RIFF....WEBP"), 8, "WEBP"))).toBe("image/webp");
		expect(detectSupportedImageMimeType(withAscii(Buffer.alloc(32), 0, "BM"))).toBe("image/bmp");
	});

	it("rejects unknown or unsupported data", () => {
		expect(detectSupportedImageMimeType(Buffer.from("plain text"))).toBeNull();
		// JPEG-LS 标记
		expect(detectSupportedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xf7]))).toBeNull();
	});

	it("rejects animated png", () => {
		const chunk = (type: string, data: Buffer): Buffer => {
			const length = Buffer.alloc(4);
			length.writeUInt32BE(data.length);
			return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
		};
		const animated = Buffer.concat([
			png.subarray(0, 8),
			chunk("IHDR", Buffer.alloc(13)),
			chunk("acTL", Buffer.alloc(8)),
		]);
		expect(detectSupportedImageMimeType(animated)).toBeNull();
	});
});
