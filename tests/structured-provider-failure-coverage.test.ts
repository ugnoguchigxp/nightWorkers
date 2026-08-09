import { afterEach, describe, expect, it, vi } from "vitest";
import {
	normalizeStructuredProviderError,
	providerHttpError,
	StructuredProviderError,
	withStructuredProviderAttempt,
} from "../api/services/structured-llm/provider-failure";

describe("structured provider failure coverage", () => {
	afterEach(() => vi.useRealTimers());

	it("classifies every HTTP status family and retry policy", () => {
		const cases = [
			[200, "unknown", false],
			[400, "invalid_request", false],
			[401, "authentication", false],
			[403, "permission", false],
			[408, "timeout", true],
			[409, "invalid_request", false],
			[429, "rate_limit", true],
			[500, "provider_capacity", true],
			[501, "provider_capacity", false],
			[502, "provider_capacity", true],
			[503, "provider_capacity", true],
			[504, "provider_capacity", true],
		] as const;
		for (const [status, kind, retryable] of cases) {
			const error = providerHttpError({
				provider: "test",
				status,
				body: "body",
				retryAfter: null,
			});
			expect(error).toMatchObject({
				kind,
				retryable,
				httpStatus: status,
				code: `HTTP_${status}`,
				retryAfterMs: null,
				attempt: 1,
			});
		}
	});

	it("parses seconds, dates, invalid, past, and absent retry-after values", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-08T00:00:00Z"));
		expect(
			providerHttpError({
				provider: "p",
				status: 429,
				body: "x",
				retryAfter: "1.25",
			}).retryAfterMs,
		).toBe(1250);
		expect(
			providerHttpError({
				provider: "p",
				status: 429,
				body: "x",
				retryAfter: "Sat, 08 Aug 2026 00:00:03 GMT",
			}).retryAfterMs,
		).toBe(3000);
		expect(
			providerHttpError({
				provider: "p",
				status: 429,
				body: "x",
				retryAfter: "Fri, 07 Aug 2026 00:00:00 GMT",
			}).retryAfterMs,
		).toBe(0);
		expect(
			providerHttpError({
				provider: "p",
				status: 429,
				body: "x",
				retryAfter: "-999999999999",
			}).retryAfterMs,
		).toBeNull();
		expect(
			providerHttpError({
				provider: "p",
				status: 429,
				body: "x",
				retryAfter: "invalid",
			}).retryAfterMs,
		).toBeNull();
	});

	it("bounds large ASCII and surrogate-pair provider bodies", () => {
		const ascii = providerHttpError({
			provider: "p",
			status: 500,
			body: "a".repeat(9_000),
			retryAfter: null,
		});
		const unicode = providerHttpError({
			provider: "p",
			status: 500,
			body: `${"a".repeat(8_191)}😀tail`,
			retryAfter: null,
		});
		expect(ascii.message).not.toContain("provider error body truncated");
		expect(ascii.providerBody).toContain("provider error body truncated");
		expect(ascii.providerBody).toContain("bytes=9000");
		expect(unicode.providerBody).toContain("provider error body truncated");
		expect(unicode.providerBody).not.toContain("�");
	});

	it("normalizes existing, HTTP-shaped, timeout, transport, and unknown errors", () => {
		const existing = new StructuredProviderError({
			kind: "permission",
			message: "no",
			retryable: false,
		});
		expect(normalizeStructuredProviderError(existing)).toBe(existing);

		const http = Object.assign(new Error("bad request"), {
			statusCode: 400,
			code: "BAD",
		});
		expect(normalizeStructuredProviderError(http)).toMatchObject({
			kind: "invalid_request",
			code: "BAD",
			httpStatus: 400,
			retryable: false,
		});
		expect(normalizeStructuredProviderError({ httpStatus: 503 })).toMatchObject(
			{
				kind: "provider_capacity",
				httpStatus: 503,
				retryable: true,
				message: "[object Object]",
			},
		);
		expect(
			normalizeStructuredProviderError({ $metadata: { httpStatusCode: 401 } }),
		).toMatchObject({ kind: "authentication", httpStatus: 401 });
		expect(normalizeStructuredProviderError({ $metadata: null })).toMatchObject(
			{ kind: "unknown" },
		);

		for (const value of [
			Object.assign(new Error("timeout"), { name: "TimeoutError" }),
			{ code: "ETIMEDOUT" },
			{ code: "UND_ERR_CONNECT_TIMEOUT" },
		])
			expect(normalizeStructuredProviderError(value)).toMatchObject({
				kind: "timeout",
				retryable: true,
			});
		for (const value of [
			new TypeError("fetch failed"),
			{ code: "ECONNRESET" },
			{ code: "ECONNREFUSED" },
			{ code: "EAI_AGAIN" },
		])
			expect(normalizeStructuredProviderError(value)).toMatchObject({
				kind: "transport",
				retryable: true,
			});
		expect(normalizeStructuredProviderError("plain")).toMatchObject({
			kind: "unknown",
			code: null,
			retryable: false,
			message: "plain",
		});
	});

	it("copies typed failures while changing the attempt", () => {
		const source = new StructuredProviderError({
			kind: "rate_limit",
			message: "slow down",
			code: "RATE",
			httpStatus: 429,
			retryable: true,
			retryAfterMs: 500,
			attempt: 2,
		});
		const copied = withStructuredProviderAttempt(source, 4);
		expect(copied).toMatchObject({
			kind: "rate_limit",
			code: "RATE",
			httpStatus: 429,
			retryable: true,
			retryAfterMs: 500,
			attempt: 4,
		});
		expect(copied.cause).toBe(source);
	});
});
