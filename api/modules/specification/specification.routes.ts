import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./specification.service";
import {
	generateFeaturePlanRoute,
	getPlanModeWorkspaceRoute,
} from "./specification-route-definitions";

export const specificationRouter = createOpenApiRouter()
	.openapi(
		getPlanModeWorkspaceRoute,
		withOpenApiRouteError(getPlanModeWorkspaceRoute, async (c) => {
			const workspace = await service.getPlanModeWorkspace(c.req.param("id"));
			return c.json(workspace, 200);
		}),
	)
	.openapi(
		generateFeaturePlanRoute,
		withOpenApiRouteError(generateFeaturePlanRoute, async (c) => {
			const result = await service.generateFeaturePlanArtifact(
				c.req.param("id"),
				c.req.valid("json"),
			);
			return c.json(result, 200);
		}),
	);
