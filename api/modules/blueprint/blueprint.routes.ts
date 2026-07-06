import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import * as service from "./blueprint.service";
import {
	generatePlanModeBlueprintRoute,
	getBlueprintArtifactAdoptionRoute,
	getBlueprintDesignSettingsRoute,
	getBlueprintDesignTokenAdoptionRoute,
	saveBlueprintArtifactAdoptionRoute,
	saveBlueprintDesignSettingsRoute,
	saveBlueprintDesignTokenAdoptionRoute,
} from "./blueprint-route-definitions";

export const blueprintRouter = createOpenApiRouter()
	.openapi(
		getBlueprintDesignSettingsRoute,
		withOpenApiRouteError(getBlueprintDesignSettingsRoute, async (c) => {
			const settings = await service.getBlueprintDesignSettings(
				c.req.param("id"),
			);
			return c.json(settings, 200);
		}),
	)
	.openapi(
		saveBlueprintDesignSettingsRoute,
		withOpenApiRouteError(saveBlueprintDesignSettingsRoute, async (c) => {
			const settings = await service.saveBlueprintDesignSettings(
				c.req.param("id"),
				c.req.valid("json"),
			);
			return c.json(settings, 200);
		}),
	)
	.openapi(
		getBlueprintArtifactAdoptionRoute,
		withOpenApiRouteError(getBlueprintArtifactAdoptionRoute, async (c) => {
			const adoption = await service.getBlueprintArtifactAdoption(
				c.req.param("id"),
				c.req.valid("query").messageId,
			);
			return c.json(adoption, 200);
		}),
	)
	.openapi(
		saveBlueprintArtifactAdoptionRoute,
		withOpenApiRouteError(saveBlueprintArtifactAdoptionRoute, async (c) => {
			const body = c.req.valid("json");
			const adoption = await service.saveBlueprintArtifactAdoption(
				c.req.param("id"),
				body.messageId,
				body.adopted,
			);
			return c.json(adoption, 200);
		}),
	)
	.openapi(
		getBlueprintDesignTokenAdoptionRoute,
		withOpenApiRouteError(getBlueprintDesignTokenAdoptionRoute, async (c) => {
			const adoption = await service.getBlueprintDesignTokenAdoption(
				c.req.param("id"),
				c.req.valid("query").messageId,
			);
			return c.json(adoption, 200);
		}),
	)
	.openapi(
		saveBlueprintDesignTokenAdoptionRoute,
		withOpenApiRouteError(saveBlueprintDesignTokenAdoptionRoute, async (c) => {
			const body = c.req.valid("json");
			const adoption = await service.saveBlueprintDesignTokenAdoption(
				c.req.param("id"),
				body.messageId,
				body.adopted,
			);
			return c.json(adoption, 200);
		}),
	)
	.openapi(
		generatePlanModeBlueprintRoute,
		withOpenApiRouteError(generatePlanModeBlueprintRoute, async (c) => {
			const result = await service.generateBlueprintArtifact(
				c.req.param("id"),
				c.req.valid("json"),
			);
			return c.json(result, 200);
		}),
	);
