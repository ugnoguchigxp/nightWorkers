import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { apiErrorOpenApiResponse } from "../../shared/schemas/api-error.schema";
import { serializeApiError } from "../lib/api-error-response";
import { NotFoundError } from "../lib/errors";
import { createOpenApiRouter } from "../lib/openapi";
import { registerFixtureProviderToolTurns } from "../services/structured-llm/fixture-tool-provider";
import { buildImplementationDirectRunFixtureTurns } from "./implementation-direct-run-fixture";

function notFound(message = "Not found") {
	return serializeApiError(new NotFoundError(message)).body;
}

const prepareImplementationScenarioFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/coding-agent-scenario",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						scenario: z.literal("direct-run"),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						scenario: z.literal("direct-run"),
					}),
				},
			},
			description:
				"Prepare a deterministic implementation-provider scenario in isolated E2E.",
		},
		404: apiErrorOpenApiResponse("Route unavailable"),
	},
});

export const implementationProviderFixtureRouter =
	createOpenApiRouter().openapi(
		prepareImplementationScenarioFixtureRoute,
		async (c) => {
			if (
				process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
				c.req.header("x-nightworkers-e2e") !== "1"
			) {
				return c.json(notFound(), 404);
			}
			const input = c.req.valid("json");
			registerFixtureProviderToolTurns(
				input.taskId,
				buildImplementationDirectRunFixtureTurns(),
				"implementation",
			);
			return c.json(input, 201);
		},
	);
