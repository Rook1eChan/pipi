/** provider 响应体在错误消息里的最大长度。 */
export const MAX_PROVIDER_ERROR_BODY_CHARS = 4000;

/** 截断过长的错误文本，保留开头并标注省略长度。 */
export function truncateErrorText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}... [truncated ${text.length - maxChars} chars]`;
}

/**
 * 从错误响应体里取出可读信息。
 *
 * 兼容常见形状：`{ error: { message, code } }`、`{ error: "..." }`、`{ message }`。
 * 解析失败时返回 undefined，由调用方退回原文。
 */
function extractErrorMessage(body: string): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return undefined;
	}

	if (typeof parsed === "string") return parsed;
	if (typeof parsed !== "object" || parsed === null) return undefined;

	const error = (parsed as { error?: unknown }).error;
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const message = (error as { message?: unknown }).message;
		const code = (error as { code?: unknown }).code;
		if (typeof message === "string") {
			return typeof code === "string" ? `${message} (${code})` : message;
		}
	}

	const message = (parsed as { message?: unknown }).message;
	return typeof message === "string" ? message : undefined;
}

/** 把 HTTP 状态与响应体组合成一行可读的错误信息。 */
export function formatProviderErrorBody(status: number | undefined, bodyText: string): string {
	const detail = extractErrorMessage(bodyText) ?? bodyText.trim();
	const truncated = detail.length > 0 ? truncateErrorText(detail, MAX_PROVIDER_ERROR_BODY_CHARS) : "";
	if (status === undefined) return truncated.length > 0 ? truncated : "Request failed";
	return truncated.length > 0 ? `HTTP ${status}: ${truncated}` : `HTTP ${status}`;
}

/** 携带 HTTP 状态与响应头的请求错误，供重试策略判断。 */
export class ProviderHttpError extends Error {
	/** HTTP 状态码；网络错误或超时为 undefined。 */
	readonly status: number | undefined;
	/** 响应头；网络错误时为 undefined。 */
	readonly headers: Headers | undefined;
	/** 原始响应体，已按需截断。 */
	readonly body: string | undefined;

	constructor(options: { status?: number; headers?: Headers; body?: string; message?: string }) {
		super(options.message ?? formatProviderErrorBody(options.status, options.body ?? ""));
		this.name = "ProviderHttpError";
		this.status = options.status;
		this.headers = options.headers;
		this.body = options.body;
	}
}
