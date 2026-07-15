import { createRoute, z } from "@hono/zod-openapi";
import {
	projectSecurityIntelligenceSettingsResponseSchema,
	projectSecurityIntelligenceSettingsSchema,
} from "../../../shared/schemas/ontology.schema";
import { projectExplorationCatalogPilotSettingsSchema } from "../../../shared/schemas/project-exploration-catalog.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import {
	getProjectExplorationCatalogSettings,
	saveProjectExplorationCatalogSettings,
} from "./exploration/project-exploration-settings.service";
import {
	getProjectSecurityIntelligenceSettings,
	saveProjectSecurityIntelligenceSettings,
} from "./ontology-settings.service";

const repositoryParams = z.object({ id: z.string().uuid() });
const getSettingsRoute = createRoute({
	method: "get",
	path: "/repositories/:id/settings/security-intelligence",
	request: { params: repositoryParams },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectSecurityIntelligenceSettingsResponseSchema,
				},
			},
			description: "Project Security Oracle and ontology tool settings",
		},
	},
});
const saveSettingsRoute = createRoute({
	method: "put",
	path: "/repositories/:id/settings/security-intelligence",
	request: {
		params: repositoryParams,
		body: {
			content: {
				"application/json": {
					schema: projectSecurityIntelligenceSettingsSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectSecurityIntelligenceSettingsResponseSchema,
				},
			},
			description: "Project Security Oracle and ontology tool settings saved",
		},
	},
});
const getProjectExplorationSettingsRoute = createRoute({
	method: "get",
	path: "/repositories/:id/settings/project-exploration",
	request: { params: repositoryParams },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectExplorationCatalogPilotSettingsSchema,
				},
			},
			description: "Project Static Intelligence exploration settings",
		},
	},
});
const saveProjectExplorationSettingsRoute = createRoute({
	method: "put",
	path: "/repositories/:id/settings/project-exploration",
	request: {
		params: repositoryParams,
		body: {
			content: {
				"application/json": {
					schema: projectExplorationCatalogPilotSettingsSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectExplorationCatalogPilotSettingsSchema,
				},
			},
			description: "Project Static Intelligence exploration settings saved",
		},
	},
});

export const ontologyRouter = createOpenApiRouter()
	.openapi(
		getSettingsRoute,
		withOpenApiRouteError(getSettingsRoute, async (c) =>
			c.json(
				await getProjectSecurityIntelligenceSettings(c.req.param("id")),
				200,
			),
		),
	)
	.openapi(
		saveSettingsRoute,
		withOpenApiRouteError(saveSettingsRoute, async (c) =>
			c.json(
				await saveProjectSecurityIntelligenceSettings(
					c.req.param("id"),
					c.req.valid("json"),
				),
				200,
			),
		),
	)
	.openapi(
		getProjectExplorationSettingsRoute,
		withOpenApiRouteError(getProjectExplorationSettingsRoute, async (c) =>
			c.json(
				await getProjectExplorationCatalogSettings(c.req.param("id")),
				200,
			),
		),
	)
	.openapi(
		saveProjectExplorationSettingsRoute,
		withOpenApiRouteError(saveProjectExplorationSettingsRoute, async (c) =>
			c.json(
				await saveProjectExplorationCatalogSettings(
					c.req.param("id"),
					c.req.valid("json"),
				),
				200,
			),
		),
	);
