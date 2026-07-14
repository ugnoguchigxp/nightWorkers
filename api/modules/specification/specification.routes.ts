import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { updatePlanModeRoutingForUser } from "../planMode/plan-mode-routing.service";
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
			const routing = await updatePlanModeRoutingForUser(
				c.req.param("id"),
				c.req.valid("json"),
			);
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
