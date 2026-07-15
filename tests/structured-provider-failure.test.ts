import { describe, expect, it } from "vitest";
import { retryMissionPilotProviderCall } from "../api/modules/missionPilot/agent/mission-pilot-provider.port";
import {
	normalizeStructuredProviderError,
	providerHttpError,
} from "../api/services/structured-llm/provider-failure";

describe("structured provider failures", () => {
	it.each([
		[401, "authentication", false],
		[403, "permission", false],
		[408, "timeout", true],
		[429, "rate_limit", true],
		[503, "provider_capacity", true],
		[501, "provider_capacity", false],
		[400, "invalid_request", false],
	] as const)("maps HTTP %s without message classification", (status, kind, retryable) => {
		const error = providerHttpError({
			provider: "test",
			status,
			body: "original provider body",
			retryAfter: status === 429 ? "2" : null,
		});
		expect(error).toMatchObject({ kind, retryable, httpStatus: status });
		if (status === 429) expect(error.retryAfterMs).toBe(2000);
	});

	it("keeps transport and timeout failures distinct by typed fields", () => {
		expect(
			normalizeStructuredProviderError(
				Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
			),
		).toMatchObject({ kind: "transport", retryable: true });
		expect(
			normalizeStructuredProviderError(
				Object.assign(new Error("deadline"), { code: "ETIMEDOUT" }),
			),
		).toMatchObject({ kind: "timeout", retryable: true });
	});

	it("bounds oversized HTTP error bodies while preserving an audit digest", () => {
		const body = "障".repeat(10_000);
		const error = providerHttpError({
			provider: "test",
			status: 503,
			body,
			retryAfter: null,
		});
		expect(Buffer.byteLength(error.message, "utf8")).toBeLessThan(8_500);
		expect(error.message).toContain("provider error body truncated");
		expect(error.message).toMatch(/sha256=[a-f0-9]{64}/);
		expect(error.message).not.toContain("�");
	});

	it("does not make another provider call after stop during retry", async () => {
		const controller = new AbortController();
		let calls = 0;
		await expect(
			retryMissionPilotProviderCall(async () => {
				calls++;
				controller.abort();
				throw Object.assign(new Error("socket closed"), {
					code: "ECONNRESET",
				});
			}, controller.signal),
		).rejects.toMatchObject({ kind: "transport", attempt: 1 });
		expect(calls).toBe(1);
	});

	it("retries transient failures with immutable attempt metadata", async () => {
		const controller = new AbortController();
		let calls = 0;
		const result = await retryMissionPilotProviderCall(async () => {
			calls++;
			if (calls < 3)
				throw Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
			return "ok";
		}, controller.signal);
		expect(result).toBe("ok");
		expect(calls).toBe(3);
	});

	it("does not retry a non-retryable provider failure", async () => {
		const controller = new AbortController();
		let calls = 0;
		await expect(
			retryMissionPilotProviderCall(async () => {
				calls++;
				throw providerHttpError({
					provider: "test",
					status: 400,
					body: "invalid request",
				});
			}, controller.signal),
		).rejects.toMatchObject({ kind: "invalid_request", attempt: 1 });
		expect(calls).toBe(1);
	});
});
