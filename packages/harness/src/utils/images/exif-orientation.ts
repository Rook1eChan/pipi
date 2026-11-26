import type { Photon, PhotonImage } from "./photon.ts";

function hasExifHeader(bytes: Uint8Array, offset: number): boolean {
	return (
		bytes[offset] === 0x45 &&
		bytes[offset + 1] === 0x78 &&
		bytes[offset + 2] === 0x69 &&
		bytes[offset + 3] === 0x66 &&
		bytes[offset + 4] === 0x00 &&
		bytes[offset + 5] === 0x00
	);
}

function readOrientationFromTiff(bytes: Uint8Array, tiffStart: number): number {
	if (tiffStart + 8 > bytes.length) return 1;

	const littleEndian = ((bytes[tiffStart] << 8) | bytes[tiffStart + 1]) === 0x4949;
	const read16 = (position: number): number =>
		littleEndian ? bytes[position] | (bytes[position + 1] << 8) : (bytes[position] << 8) | bytes[position + 1];
	const read32 = (position: number): number =>
		littleEndian
			? bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16) | (bytes[position + 3] << 24)
			: ((bytes[position] << 24) |
					(bytes[position + 1] << 16) |
					(bytes[position + 2] << 8) |
					bytes[position + 3]) >>>
				0;

	const ifdStart = tiffStart + read32(tiffStart + 4);
	if (ifdStart + 2 > bytes.length) return 1;

	const entryCount = read16(ifdStart);
	for (let index = 0; index < entryCount; index++) {
		const entry = ifdStart + 2 + index * 12;
		if (entry + 12 > bytes.length) return 1;
		if (read16(entry) === 0x0112) {
			const value = read16(entry + 8);
			return value >= 1 && value <= 8 ? value : 1;
		}
	}
	return 1;
}

function findJpegTiffOffset(bytes: Uint8Array): number {
	let offset = 2;
	while (offset < bytes.length - 1) {
		if (bytes[offset] !== 0xff) return -1;
		const marker = bytes[offset + 1];
		if (marker === 0xff) {
			offset++;
			continue;
		}
		if (marker === 0xe1 && offset + 10 < bytes.length && hasExifHeader(bytes, offset + 4)) {
			return offset + 10;
		}
		if (offset + 4 > bytes.length) return -1;
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
		offset += 2 + length;
	}
	return -1;
}

function findWebpTiffOffset(bytes: Uint8Array): number {
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
		const chunkSize =
			bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
		const dataStart = offset + 8;
		if (chunkId === "EXIF") {
			if (dataStart + chunkSize > bytes.length) return -1;
			return chunkSize >= 6 && hasExifHeader(bytes, dataStart) ? dataStart + 6 : dataStart;
		}
		offset = dataStart + chunkSize + (chunkSize % 2);
	}
	return -1;
}

/** 读取 EXIF 方向标记；没有标记时返回 1。 */
export function getExifOrientation(bytes: Uint8Array): number {
	let tiffOffset = -1;
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		tiffOffset = findJpegTiffOffset(bytes);
	} else if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF") {
		if (String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") tiffOffset = findWebpTiffOffset(bytes);
	}
	if (tiffOffset === -1) return 1;
	return readOrientationFromTiff(bytes, tiffOffset);
}

type DstIndex = (x: number, y: number, width: number, height: number) => number;

function rotate90(photon: Photon, image: PhotonImage, dstIndex: DstIndex): PhotonImage {
	const width = image.get_width();
	const height = image.get_height();
	const source = image.get_raw_pixels();
	const target = new Uint8Array(source.length);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const from = (y * width + x) * 4;
			const to = dstIndex(x, y, width, height) * 4;
			target[to] = source[from];
			target[to + 1] = source[from + 1];
			target[to + 2] = source[from + 2];
			target[to + 3] = source[from + 3];
		}
	}
	return new photon.PhotonImage(target, height, width);
}

// 翻转就地修改；旋转返回新图，调用方负责释放旧图
export function applyExifOrientation(photon: Photon, image: PhotonImage, originalBytes: Uint8Array): PhotonImage {
	switch (getExifOrientation(originalBytes)) {
		case 2:
			photon.fliph(image);
			return image;
		case 3:
			photon.fliph(image);
			photon.flipv(image);
			return image;
		case 4:
			photon.flipv(image);
			return image;
		case 5: {
			const rotated = rotate90(photon, image, (x, y, _width, height) => x * height + (height - 1 - y));
			photon.fliph(rotated);
			return rotated;
		}
		case 6:
			return rotate90(photon, image, (x, y, _width, height) => x * height + (height - 1 - y));
		case 7: {
			const rotated = rotate90(photon, image, (x, y, width, height) => (width - 1 - x) * height + y);
			photon.fliph(rotated);
			return rotated;
		}
		case 8:
			return rotate90(photon, image, (x, y, width, height) => (width - 1 - x) * height + y);
		default:
			return image;
	}
}
