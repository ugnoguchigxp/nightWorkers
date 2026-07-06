import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { generatePlanViewArtifact } from "./planView-generation.service";
import { generatePlanViewRoute } from "./planView-route-definitions";

export const planViewRouter = createOpenApiRouter().openapi(
	generatePlanViewRoute,
	withOpenApiRouteError(generatePlanViewRoute, async (c) => {
		const result = await generatePlanViewArtifact(
			c.req.param("id"),
			c.req.valid("param").view,
			c.req.valid("json"),
		);
		return c.json(result, 200);
	}),
);
