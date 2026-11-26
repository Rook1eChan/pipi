import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch, homedir, platform } from "node:os";
import { join } from "node:path";
import { commandExists } from "./shell.ts";

/** rg / fd 的安装目录。 */
export const BIN_DIR = join(homedir(), ".pipi", "bin");

interface ToolConfig {
	name: string;
	repo: string;
	binaryName: string;
	systemNames: string[];
	tagPrefix: string;
}

const TOOLS: Record<"rg" | "fd", ToolConfig> = {
	rg: { name: "ripgrep", repo: "BurntSushi/ripgrep", binaryName: "rg", systemNames: ["rg"], tagPrefix: "" },
	fd: { name: "fd", repo: "sharkdp/fd", binaryName: "fd", systemNames: ["fd", "fdfind"], tagPrefix: "v" },
};

const ARCHIVE_SUFFIX: Record<string, Record<string, string>> = {
	linux: { x64: "x86_64-unknown-linux-musl", arm64: "aarch64-unknown-linux-musl" },
	darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
	win32: { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" },
};

function releaseTarget(): string | undefined {
	return ARCHIVE_SUFFIX[platform()]?.[arch()];
}

/** 优先用安装目录里的二进制，其次用系统 PATH 里的。 */
export function getToolPath(tool: "rg" | "fd"): string | null {
	const config = TOOLS[tool];
	const extension = platform() === "win32" ? ".exe" : "";
	const localPath = join(BIN_DIR, config.binaryName + extension);
	if (existsSync(localPath)) return localPath;
	for (const name of config.systemNames) {
		if (commandExists(name)) return name;
	}
	return null;
}

async function latestRelease(repo: string): Promise<string> {
	const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
		headers: { "User-Agent": "pipi-harness" },
	});
	if (!response.ok) throw new Error(`GitHub API ${response.status}`);
	const data = (await response.json()) as { tag_name?: string };
	if (!data.tag_name) throw new Error("release tag missing");
	return data.tag_name;
}

async function downloadBinary(tool: "rg" | "fd"): Promise<string> {
	const config = TOOLS[tool];
	const target = releaseTarget();
	if (!target) throw new Error(`Unsupported platform: ${platform()}/${arch()}`);

	const tag = await latestRelease(config.repo);
	const version = tag.replace(/^v/, "");
	const isWindows = platform() === "win32";
	const archiveBase = tool === "rg" ? `ripgrep-${version}-${target}` : `fd-v${version}-${target}`;
	const archive = `${archiveBase}.${isWindows ? "zip" : "tar.gz"}`;
	const url = `https://github.com/${config.repo}/releases/download/${tag}/${archive}`;

	const response = await fetch(url, { headers: { "User-Agent": "pipi-harness" } });
	if (!response.ok) throw new Error(`download failed: ${response.status}`);

	mkdirSync(BIN_DIR, { recursive: true });
	const workDir = mkdtempSync(join(BIN_DIR, "extract-"));
	try {
		const archivePath = join(workDir, archive);
		writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
		const extractDir = join(workDir, "out");
		mkdirSync(extractDir, { recursive: true });
		const extract = spawnSync(
			isWindows ? "unzip" : "tar",
			isWindows ? ["-q", archivePath, "-d", extractDir] : ["-xzf", archivePath, "-C", extractDir],
		);
		if (extract.status !== 0) throw new Error(`extract failed: ${extract.stderr?.toString() ?? "unknown"}`);

		const binaryName = config.binaryName + (isWindows ? ".exe" : "");
		const found = findFile(extractDir, binaryName);
		if (!found) throw new Error(`binary ${binaryName} not found in archive`);

		const destination = join(BIN_DIR, binaryName);
		renameSync(found, destination);
		if (!isWindows) chmodSync(destination, 0o755);
		return destination;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

function findFile(dir: string, name: string): string | undefined {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = findFile(full, name);
			if (nested) return nested;
		} else if (entry.name === name) {
			return full;
		}
	}
	return undefined;
}

/** 拿到可用的二进制路径；缺失时按需下载，离线模式直接返回 null。 */
export async function ensureTool(tool: "rg" | "fd"): Promise<string | null> {
	const existing = getToolPath(tool);
	if (existing) return existing;

	const offline = process.env.PIPI_OFFLINE;
	if (offline === "1" || offline?.toLowerCase() === "true") return null;

	try {
		return await downloadBinary(tool);
	} catch {
		return null;
	}
}
