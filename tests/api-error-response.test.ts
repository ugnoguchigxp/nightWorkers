import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { serializeApiError } from "../api/lib/api-error-response";
import { AppError } from "../api/lib/errors";
import { createOpenApiRouter } from "../api/lib/openapi";
import {
	apiErrorEnvelopeSchema,
	apiErrorOpenApiResponse,
} from "../shared/schemas/api-error.schema";

describe("serializeApiError", () => {
	it("preserves the declared AppError status, code, message, and details", () => {
		const serialized = serializeApiError(
			new AppError(409, "REVISION_CONFLICT", "Revision is stale", {
				expectedRevision: 3,
			}),
		);

		expect(serialized.status).toBe(409);
		expect(apiErrorEnvelopeSchema.parse(serialized.body)).toEqual({
			error: {
				code: "REVISION_CONFLICT",
				message: "Revision is stale",
				details: { expectedRevision: 3 },
			},
		});
	});

	it("maps HTTP and unknown errors without leaking unknown error text", () => {
		expect(
			serializeApiError(new HTTPException(404, { message: "Missing" })),
		).toMatchObject({
			status: 404,
			body: { error: { code: "NOT_FOUND", message: "Missing" } },
		});
		expect(
			serializeApiError(new Error("secret internal path /private/a")),
		).toMatchObject({
			status: 500,
			body: {
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "An unexpected error occurred",
				},
			},
		});
	});

	it("fails closed when an AppError has no usable machine-readable code", () => {
		expect(
			serializeApiError(new AppError(418, "   ", "internal detail")),
		).toMatchObject({
			status: 500,
			body: {
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "An unexpected error occurred",
				},
			},
		});
	});

	it("uses the canonical schema in OpenAPI error responses", () => {
		expect(
			apiErrorOpenApiResponse("Not found").content["application/json"].schema,
		).toBe(apiErrorEnvelopeSchema);
	});

	it("renders the shared envelope in an OpenAPI document", async () => {
		const router = createOpenApiRouter();
		const route = createRoute({
			method: "get",
			path: "/contract-error",
			responses: { 400: apiErrorOpenApiResponse("Invalid request") },
		});
		router.openapi(route, (c) =>
			c.json(
				{ error: { code: "BAD_REQUEST", message: "Invalid request" } },
				400,
			),
		);
		router.doc("/doc", {
			openapi: "3.0.0",
			info: { title: "API contract test", version: "1" },
		});

		const response = await router.request("/doc");
		const document = (await response.json()) as {
			components: { schemas: Record<string, unknown> };
			paths: Record<
				string,
				{ get: { responses: Record<string, { content?: unknown }> } }
			>;
		};

		expect(response.status).toBe(200);
		expect(document.components.schemas.ApiErrorEnvelope).toBeDefined();
		expect(
			document.paths["/contract-error"].get.responses["400"].content,
		).toBeDefined();
	});
});
