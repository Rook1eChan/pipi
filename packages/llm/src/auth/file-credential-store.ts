import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ApiKeyCredential, AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "./types.ts";

const AUTH_FILE_MODE = 0o600;
const AUTH_DIR_MODE = 0o700;

let tempCounter = 0;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析 auth.json；结构不合法时抛错，避免静默覆盖用户数据。 */
function parseAuthData(text: string): Record<string, Credential> {
	const parsed: unknown = JSON.parse(text);
	if (!isPlainObject(parsed)) throw new Error("Invalid auth file: expected an object");

	const data: Record<string, Credential> = {};
	for (const [providerId, value] of Object.entries(parsed)) {
		if (!isPlainObject(value) || value.type !== "api_key") {
			throw new Error(`Invalid credential for provider "${providerId}"`);
		}
		const credential = value as Partial<ApiKeyCredential>;
		data[providerId] = { type: "api_key", key: credential.key, env: credential.env };
	}
	return data;
}

/**
 * 以 JSON 文件保存 credential。
 *
 * 写入串行执行，先写临时文件再 `rename` 替换，避免读到半写内容；文件以
 * `0600` 创建，目录以 `0700` 创建。跨进程锁不在本实现范围内。
 */
export class FileCredentialStore implements CredentialStore {
	/** credential 文件路径，例如 `~/.pi/auth.json`。 */
	readonly path: string;
	/** 串行链，保证同一实例内的写操作按顺序执行。 */
	private chain: Promise<unknown> = Promise.resolve();

	constructor(path: string) {
		this.path = path;
	}

	/** 每次从磁盘读取，避免多实例之间的缓存不一致；I/O 前后都检查中止。 */
	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const data = await this.readAll();
		options?.signal?.throwIfAborted();
		return data[providerId];
	}

	/** 只返回 provider id 与认证类型，不读取密钥内容。 */
	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const data = await this.readAll();
		return Object.entries(data).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	/** 覆盖写入单个 provider，其它 provider 的记录保持不变。 */
	async write(providerId: string, credential: Credential, options?: AuthOperationOptions): Promise<void> {
		await this.mutate(options, (data) => ({ ...data, [providerId]: credential }));
	}

	/** 删除单个 provider；记录不存在也算成功。 */
	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		await this.mutate(options, (data) => {
			const next = { ...data };
			delete next[providerId];
			return next;
		});
	}

	/** 串行执行读改写，保证同一实例内的并发写入不互相覆盖。 */
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		// 前一次失败也要继续执行后一次，否则一次写失败会让后续写入永远挂起
		const run = this.chain.then(operation, operation);
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	private async mutate(
		options: AuthOperationOptions | undefined,
		update: (data: Record<string, Credential>) => Record<string, Credential>,
	): Promise<void> {
		await this.enqueue(async () => {
			// 读取前、提交前、落盘后各检查一次，尽量缩小中止与写入的竞态
			options?.signal?.throwIfAborted();
			const data = await this.readAll();
			const next = update(data);
			options?.signal?.throwIfAborted();
			await this.writeAll(next, options?.signal);
			options?.signal?.throwIfAborted();
		});
	}

	/** 文件不存在或为空视为没有 credential；内容非法则抛错，由上层转成认证错误。 */
	private async readAll(): Promise<Record<string, Credential>> {
		let text: string;
		try {
			text = await readFile(this.path, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
		if (text.trim().length === 0) return {};
		return parseAuthData(text);
	}

	/** 先写临时文件再 rename，读者只会看到旧文件或新文件。 */
	private async writeAll(data: Record<string, Credential>, signal: AbortSignal | undefined): Promise<void> {
		const directory = dirname(this.path);
		// 目录已存在时不会修改权限，避免覆盖管理员设置
		await mkdir(directory, { recursive: true, mode: AUTH_DIR_MODE });

		tempCounter += 1;
		// 临时文件与目标在同一目录，保证 rename 是同一文件系统内的原子操作
		const tempPath = `${this.path}.${process.pid}.${tempCounter}.tmp`;
		const text = `${JSON.stringify(data, null, 2)}\n`;

		try {
			await writeFile(tempPath, text, { encoding: "utf-8", mode: AUTH_FILE_MODE });
			// 中止发生在 rename 之前时，旧文件保持不变
			signal?.throwIfAborted();
			await rename(tempPath, this.path);
		} catch (error) {
			// 写入或 rename 失败时清理临时文件，避免残留半个文件
			await unlink(tempPath).catch(() => undefined);
			throw error;
		}
	}
}
