import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import { generatePlanViewArtifact } from "./planView-generation.service";
import { generatePlanViewRoute } from "./planView-route-definitions";

export const planViewRouter = createOpenApiRouter().openapi(
	generatePlanViewRoute,
	withOpenApiRouteError(generatePlanViewRoute, async (c) => {
		const body = c.req.valid("json");
		const {
			featurePlanMessageId,
			sourceBlueprintMessageId,
			sourceDataModelMessageId,
			...generationInput
		} = body;
		const result = await generatePlanViewArtifact(
			c.req.param("id"),
			c.req.valid("param").view,
			{
				...generationInput,
				sourceSelection: createPlanArtifactSourceSelection({
					policy: "explicit_request",
					featurePlanMessageId,
					blueprintMessageId: sourceBlueprintMessageId,
					dataModelMessageId: sourceDataModelMessageId,
					previousTargetMessageId: body.mermaidRenderRepair?.sourceMessageId,
				}),
			},
		);
		return c.json(result, 200);
	}),
);
