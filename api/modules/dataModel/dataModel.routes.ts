import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { createPlanArtifactSourceSelection } from "../specification/plan-artifact-source-selection";
import { generateDataModelArtifact } from "./dataModel-generation.service";
import { generateDataModelRoute } from "./dataModel-route-definitions";

export const dataModelRouter = createOpenApiRouter().openapi(
	generateDataModelRoute,
	withOpenApiRouteError(generateDataModelRoute, async (c) => {
		const body = c.req.valid("json");
		const {
			featurePlanMessageId,
			sourceBlueprintMessageId,
			...generationInput
		} = body;
		const result = await generateDataModelArtifact(c.req.param("id"), {
			...generationInput,
			sourceSelection: createPlanArtifactSourceSelection({
				policy: "explicit_request",
				featurePlanMessageId,
				blueprintMessageId: sourceBlueprintMessageId,
			}),
		});
		return c.json(result, 200);
	}),
);
