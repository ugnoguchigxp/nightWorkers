import { describe, expect, it } from "vitest";
import { createStructuredGenerationAppError } from "../api/services/structured-generation/structured-generation-error";
import {
	StructuredLlmResponseError,
	StructuredLlmTimeoutError,
} from "../api/services/structured-llm";

describe("structured generation error mapping", () => {
	it("keeps an invalid structured response as the displayed error text", () => {
		const rawText = "model response that is not valid JSON";
		const error = createStructuredGenerationAppError({
			code: "GENERATION_FAILED",
			fallbackMessage: "Generation failed.",
			error: new StructuredLlmResponseError({
				rawText,
				issues: [
					{
						stage: "parse",
						path: [],
						code: "invalid_json",
						message: "JSON を抽出できませんでした。",
					},
				],
				attempts: [],
			}),
		});

		expect(error.message).toBe(rawText);
		expect(error.details).toMatchObject({
			responseTextOrigin: "llm",
			issues: [expect.objectContaining({ code: "invalid_json" })],
		});
	});

	it("keeps the last model response when later artifact validation fails", () => {
		const rawText = '{"markdown":"```mermaid\\nflowchart TD\\n  A -->\\n```"}';
		const error = createStructuredGenerationAppError({
			code: "GENERATION_FAILED",
			fallbackMessage: "Generation failed.",
			error: new Error("Mermaid parse failed."),
			lastRawText: rawText,
		});

		expect(error.message).toBe(rawText);
		expect(error.details).toEqual({
			responseTextOrigin: "llm",
			diagnostic: "Mermaid parse failed.",
		});
	});

	it("uses an application diagnostic only when no model body exists", () => {
		const error = createStructuredGenerationAppError({
			code: "GENERATION_FAILED",
			fallbackMessage: "Generation failed.",
			error: new Error("Provider connection failed."),
		});

		expect(error.message).toBe("Provider connection failed.");
		expect(error.details).toEqual({
			responseTextOrigin: "application",
			failureKind: "generation_failure",
			retryable: true,
		});
	});

	it("maps an internal timeout to a retryable gateway timeout", () => {
		const error = createStructuredGenerationAppError({
			code: "GENERATION_FAILED",
			fallbackMessage: "Generation failed.",
			error: new StructuredLlmTimeoutError(180_000),
		});

		expect(error).toMatchObject({
			statusCode: 504,
			code: "GENERATION_FAILED_TIMEOUT",
			details: {
				responseTextOrigin: "application",
				failureKind: "provider_timeout",
				retryable: true,
				timeoutMs: 180_000,
			},
		});
	});
});
