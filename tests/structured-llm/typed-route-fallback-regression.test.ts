import { describe, expect, it } from "vitest";
import { StructuredProviderError } from "../../api/services/structured-llm/provider-failure";
import { shouldTryStructuredLlmRouteFallback } from "../../api/services/structured-llm/route-fallback";

describe("typed structured LLM route fallback", () => {
	it("uses only typed retryability and not error message keywords", () => {
		expect(
			shouldTryStructuredLlmRouteFallback(
				new StructuredProviderError({
					kind: "transport",
					message: "connection failed",
					retryable: true,
				}),
			),
		).toBe(true);
		expect(
			shouldTryStructuredLlmRouteFallback(
				new StructuredProviderError({
					kind: "authentication",
					message: "HTTP 503 ECONNREFUSED",
					retryable: false,
				}),
			),
		).toBe(false);
		expect(
			shouldTryStructuredLlmRouteFallback(
				new Error("fetch failed ECONNREFUSED status 503"),
			),
		).toBe(false);
	});
});
