import { describe, expect, it } from "vitest";
import {
	ApiResponseError,
	apiResponseErrorCodes,
	readJsonResponse,
} from "../src/lib/api-error";

function jsonResponse(body: unknown, status: number, requestId?: string) {
	return new Response(JSON.stringify(body), {
		status,
		headers: requestId ? { "X-Request-Id": requestId } : undefined,
	});
}

describe("readJsonResponse", () => {
	it("returns a successful JSON response only when its schema parses", async () => {
		await expect(
			readJsonResponse(jsonResponse({ id: "project-1" }, 200), {
				safeParse(value) {
					return value &&
						typeof value === "object" &&
						"id" in value &&
						typeof value.id === "string"
						? { success: true as const, data: { id: value.id } }
						: { success: false as const, error: "id required" };
				},
			}),
		).resolves.toEqual({ id: "project-1" });

		await expect(
			readJsonResponse(jsonResponse({ id: 1 }, 200), {
				safeParse: () => ({ success: false as const, error: "id required" }),
			}),
		).rejects.toMatchObject({
			code: apiResponseErrorCodes.INVALID_API_ERROR_RESPONSE,
			status: 200,
		});
	});

	it("preserves canonical error details and request id", async () => {
		const response = jsonResponse(
			{
				error: {
					code: "REVISION_CONFLICT",
					message: "Revision is stale",
					details: { expectedRevision: 4 },
				},
			},
			409,
			"request-123",
		);

		await expect(readJsonResponse(response)).rejects.toMatchObject({
			name: "ApiResponseError",
			status: 409,
			code: "REVISION_CONFLICT",
			details: { expectedRevision: 4 },
			requestId: "request-123",
		});
	});

	it("rejects all error responses that do not use the canonical envelope", async () => {
		await expect(
			readJsonResponse(jsonResponse({ error: "Old endpoint" }, 429)),
		).rejects.toMatchObject({
			code: apiResponseErrorCodes.INVALID_API_ERROR_RESPONSE,
			status: 429,
		});
		await expect(
			readJsonResponse(jsonResponse({ message: "not an error envelope" }, 500)),
		).rejects.toMatchObject({
			code: apiResponseErrorCodes.INVALID_API_ERROR_RESPONSE,
		});
		await expect(
			readJsonResponse(jsonResponse({ error: "bad code", code: "   " }, 500)),
		).rejects.toMatchObject({
			code: apiResponseErrorCodes.INVALID_API_ERROR_RESPONSE,
		});
	});

	it("throws a typed error for non-JSON and empty responses", async () => {
		await expect(
			readJsonResponse(new Response("upstream unavailable", { status: 503 })),
		).rejects.toBeInstanceOf(ApiResponseError);
		await expect(
			readJsonResponse(new Response(null, { status: 204 })),
		).rejects.toMatchObject({
			code: apiResponseErrorCodes.INVALID_JSON_RESPONSE,
			status: 204,
		});
	});
});
