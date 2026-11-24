import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const queues = new Map<string, Promise<void>>();
// 计算 key 需要异步 realpath，注册动作本身要串行，否则同一文件可能拿到两条独立队列
let registrationQueue = Promise.resolve();

function isMissingPathError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

async function getQueueKey(filePath: string): Promise<string> {
	const resolved = resolve(filePath);
	try {
		return await realpath(resolved);
	} catch (error) {
		if (isMissingPathError(error)) return resolved;
		throw error;
	}
}

/**
 * 同一个文件的写操作排队执行，不同文件仍并行。
 * 符号链接会被解析成同一个 key，避免两条路径同时改一个文件。
 */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const registration = registrationQueue.then(async () => {
		const key = await getQueueKey(filePath);
		const current = queues.get(key) ?? Promise.resolve();

		let releaseNext!: () => void;
		const gate = new Promise<void>((resolveGate) => {
			releaseNext = resolveGate;
		});
		const chained = current.then(() => gate);
		queues.set(key, chained);

		return { key, current, chained, releaseNext };
	});
	registrationQueue = registration.then(
		() => undefined,
		() => undefined,
	);

	const { key, current, chained, releaseNext } = await registration;
	await current;
	try {
		return await fn();
	} finally {
		releaseNext();
		if (queues.get(key) === chained) queues.delete(key);
	}
}
