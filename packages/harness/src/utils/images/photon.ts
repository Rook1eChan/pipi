import { createRequire } from "node:module";

/** photon 的图片对象，只声明本项目用到的成员。 */
export interface PhotonImage {
	get_width(): number;
	get_height(): number;
	get_bytes(): Uint8Array;
	get_bytes_jpeg(quality: number): Uint8Array;
	get_raw_pixels(): Uint8Array;
	free(): void;
}

/** photon 模块的对外接口。 */
export interface Photon {
	PhotonImage: {
		new_from_byteslice(bytes: Uint8Array): PhotonImage;
		new (rawPixels: Uint8Array, width: number, height: number): PhotonImage;
	};
	resize(image: PhotonImage, width: number, height: number, filter: number): PhotonImage;
	fliph(image: PhotonImage): void;
	flipv(image: PhotonImage): void;
	SamplingFilter: { Lanczos3: number };
}

const require = createRequire(import.meta.url);

let cached: Photon | null | undefined;

/** 懒加载 WASM 图像库；加载失败返回 null，由调用方降级成文字说明。 */
export function loadPhoton(): Photon | null {
	if (cached !== undefined) return cached;
	try {
		cached = require("@silvia-odwyer/photon-node") as Photon;
	} catch {
		cached = null;
	}
	return cached;
}
