import { describe, expect, it } from "vitest";
import { ProviderHttpError } from "../src/utils/error-body.ts";
import { providerRequestWithRetry } from "../src/utils/retry.ts";

function httpError(status: number, headers: Record<string, string> = {}): ProviderHttpError {
	return new ProviderHttpError({
		status,
		headers: new Headers(headers),
		body: "{}",
		message: `HTTP ${status}`,
	});
}

describe("providerRequestWithRetry", () => {
	it("returns the first successful result without retrying", async () => {
		let calls = 0;
		const result = await providerRequestWithRetry(async () => {
			calls++;
			return "ok";
		});
		expect(result).toBe("ok");
		expect(calls).toBe(1);
	});

	it("retries 5xx and then succeeds", async () => {
		let calls = 0;
		const result = await providerRequestWithRetry(
			async () => {
				calls++;
				if (calls === 1) throw httpError(500);
				return "ok";
			},
			{ maxRetries: 1 },
		);
		expect(result).toBe("ok");
		expect(calls).toBe(2);
	});

	it("honors retry-after-ms", async () => {
		let calls = 0;
		await providerRequestWithRetry(
			async () => {
				calls++;
				if (calls === 1) throw httpError(429, { "retry-after-ms": "0" });
				return "ok";
			},
			{ maxRetries: 1 },
		);
		expect(calls).toBe(2);
	});

	it("does not retry 4xx", async () => {
		let calls = 0;
		await expect(
			providerRequestWithRetry(
				async () => {
					calls++;
					throw httpError(400);
				},
				{ maxRetries: 3 },
			),
		).rejects.toThrow("HTTP 400");
		expect(calls).toBe(1);
	});

	it("respects x-should-retry=false", async () => {
		let calls = 0;
		await expect(
			providerRequestWithRetry(
				async () => {
					calls++;
					throw httpError(500, { "x-should-retry": "false" });
				},
				{ maxRetries: 3 },
			),
		).rejects.toThrow("HTTP 500");
		expect(calls).toBe(1);
	});

	it("respects x-should-retry=true", async () => {
		let calls = 0;
		await expect(
			providerRequestWithRetry(
				async () => {
					calls++;
					throw httpError(400, { "x-should-retry": "true" });
				},
				{ maxRetries: 1 },
			),
		).rejects.toThrow("HTTP 400");
		expect(calls).toBe(2);
	});

	it("retries errors without a status", async () => {
		let calls = 0;
		const result = await providerRequestWithRetry(
			async () => {
				calls++;
				if (calls === 1) throw new ProviderHttpError({ message: "Network error: fetch failed" });
				return "ok";
			},
			{ maxRetries: 1 },
		);
		expect(result).toBe("ok");
		expect(calls).toBe(2);
	});

	it("stops after maxRetries", async () => {
		let calls = 0;
		await expect(
			providerRequestWithRetry(
				async () => {
					calls++;
					throw httpError(503);
				},
				{ maxRetries: 2 },
			),
		).rejects.toThrow("HTTP 503");
		expect(calls).toBe(3);
	});

	it("fails fast when the server asks for too long a delay", async () => {
		let calls = 0;
		await expect(
			providerRequestWithRetry(
				async () => {
					calls++;
					throw httpError(429, { "retry-after": "120" });
				},
				{ maxRetries: 3, maxRetryDelayMs: 1000 },
			),
		).rejects.toThrow(/retry delay/);
		expect(calls).toBe(1);
	});

	it("stops when the signal aborts during retry", async () => {
		const controller = new AbortController();
		let calls = 0;
		await expect(
			providerRequestWithRetry(
				async () => {
					calls++;
					controller.abort();
					throw httpError(500);
				},
				{ maxRetries: 3, signal: controller.signal },
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(calls).toBe(1);
	});
});
