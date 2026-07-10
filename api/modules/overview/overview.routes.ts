import { createRoute, z } from "@hono/zod-openapi";
import { overviewDashboardSchema } from "../../../shared/schemas/overview.schema";
import { createOpenApiRouter } from "../../lib/openapi";
import { validateTimezone } from "../../services/settings/general-settings";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { getOverviewDashboard } from "./overview.service";

const getOverviewDashboardRoute = createRoute({
	method: "get",
	path: "/overview",
	request: {
		query: z.object({
			range: z.enum(["24h", "7d", "30d", "all"]).optional(),
			repositoryId: z.string().uuid().optional(),
			timezone: z
				.string()
				.refine(validateTimezone, "Invalid timezone")
				.optional(),
			currency: z.enum(["JPY", "USD", "EUR"]).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: overviewDashboardSchema },
			},
			description: "NightWorkers overview dashboard",
		},
		404: { description: "Repository not found" },
	},
});

export const overviewRouter = createOpenApiRouter().openapi(
	getOverviewDashboardRoute,
	withOpenApiRouteError(getOverviewDashboardRoute, async (c) =>
		c.json(await getOverviewDashboard(c.req.valid("query")), 200),
	),
);
