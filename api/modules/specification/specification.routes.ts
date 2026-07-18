import { createOpenApiRouter } from "../../lib/openapi";
import { writePlanModeRoutingForUser } from "../agentsShare";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { createPlanArtifactSourceSelection } from "./plan-artifact-source-selection";
import * as service from "./specification.service";
import {
	generateFeaturePlanRoute,
	getPlanModeWorkspaceRoute,
	updatePlanModeRoutingRoute,
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
		updatePlanModeRoutingRoute,
		withOpenApiRouteError(updatePlanModeRoutingRoute, async (c) => {
			const routing = await writePlanModeRoutingForUser({
				taskId: c.req.param("id"),
				request: c.req.valid("json"),
			});
			return c.json(routing, 200);
		}),
	)
	.openapi(
		generateFeaturePlanRoute,
		withOpenApiRouteError(generateFeaturePlanRoute, async (c) => {
			const body = c.req.valid("json");
			const { sourceBlueprintMessageId, ...generationInput } = body;
			const result = await service.generateFeaturePlanArtifact(
				c.req.param("id"),
				{
					...generationInput,
					sourceSelection: createPlanArtifactSourceSelection({
						policy: "explicit_request",
						blueprintMessageId: sourceBlueprintMessageId,
					}),
				},
			);
			return c.json(result, 200);
		}),
	);
