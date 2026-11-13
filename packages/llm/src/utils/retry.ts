import { ProviderHttpError } from "./error-body.ts";

const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

/** 请求重试选项。 */
export interface ProviderRetryOptions {
	/** 最大重试次数；首次请求不计入。默认 0。 */
	maxRetries?: number;
	/** 服务端要求的等待上限，单位毫秒；设为 0 关闭上限。默认 60000。 */
	maxRetryDelayMs?: number;
	signal?: AbortSignal;
}

function createAbortError(): Error {
	const error = new Error("Request aborted");
	error.name = "AbortError";
	return error;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(createAbortError());
			return;
		}

		const onAbort = (): void => {
			clearTimeout(timeout);
			reject(createAbortError());
		};
		const timeout = setTimeout(
			() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			},
			Math.max(0, ms),
		);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * 判断错误是否值得重试。
 *
 * 优先级：`x-should-retry` 头 > 状态码。没有状态码视为网络或超时错误，可重试。
 */
function isRetryable(error: ProviderHttpError): boolean {
	const shouldRetry = error.headers?.get("x-should-retry");
	if (shouldRetry === "true") return true;
	if (shouldRetry === "false") return false;

	if (error.status === undefined) return true;
	return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
}

function validateServerRetryDelayMs(delayMs: number, maxRetryDelayMs: number | undefined, message: string): number {
	const maxDelayMs = maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
	if (maxDelayMs > 0 && delayMs > maxDelayMs) {
		throw new Error(
			`Server requested ${Math.ceil(delayMs / 1000)}s retry delay (max: ${Math.ceil(maxDelayMs / 1000)}s). ${message}`,
		);
	}
	return delayMs;
}

/** 依次检查 `retry-after-ms`、`retry-after`，都没有时按指数退避加抖动。 */
function getRetryDelayMs(error: ProviderHttpError, retryIndex: number, maxRetryDelayMs: number | undefined): number {
	const retryAfterMs = error.headers?.get("retry-after-ms");
	if (retryAfterMs) {
		const value = Number.parseFloat(retryAfterMs);
		if (!Number.isNaN(value)) return validateServerRetryDelayMs(value, maxRetryDelayMs, error.message);
	}

	const retryAfter = error.headers?.get("retry-after");
	if (retryAfter) {
		const seconds = Number.parseFloat(retryAfter);
		const delayMs = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
		return validateServerRetryDelayMs(delayMs, maxRetryDelayMs, error.message);
	}

	const exponentialDelay = Math.min(0.5 * 2 ** retryIndex, 8) * 1000;
	return exponentialDelay * (1 - Math.random() * 0.25);
}

/**
 * 带重试地执行一次 provider 请求。
 *
 * 重试条件：有剩余次数 && 属于ProviderHttpError && isretryable
 * 等待过程可被 signal 中断，中断后抛出 AbortError。
 */
export async function providerRequestWithRetry<T>(
	request: () => Promise<T>,
	options: ProviderRetryOptions = {},
): Promise<T> {
	const maxRetries = options.maxRetries ?? 0;
	let retriesRemaining = maxRetries;

	for (;;) {
		try {
			return await request();
		} catch (error) {
			if (options.signal?.aborted) throw createAbortError();
			if (retriesRemaining <= 0 || !(error instanceof ProviderHttpError) || !isRetryable(error)) throw error;
			const retryIndex = maxRetries - retriesRemaining;
			retriesRemaining--;
			// 等待
			await abortableSleep(getRetryDelayMs(error, retryIndex, options.maxRetryDelayMs), options.signal);
		}
	}
}
